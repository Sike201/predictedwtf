/**
 * pm-AMM on-chain activity: order-book rows + USDC notional volume (6 dp collateral).
 * GAMM uses YES/NO 9dp parity; pmAMM outcomes are 6dp — never mix parsers.
 */
import bs58 from "bs58";
import { Connection, PublicKey } from "@solana/web3.js";
import type { ParsedTransactionWithMeta } from "@solana/web3.js";

import { requirePmammProgramId } from "@/lib/solana/pmamm-config";
import type {
  OnchainPoolActivityEntry,
  ParsedTradeVolumeUsd,
  PoolTotalSwapVolumeStats,
} from "@/lib/solana/fetch-pool-onchain-activity";

const PMAMM_SWAP_IX = Buffer.from([
  248, 198, 158, 145, 225, 117, 135, 200,
]);
const PMAMM_DEPOSIT_IX = Buffer.from([245, 99, 59, 25, 151, 71, 233, 249]);
const PMAMM_WITHDRAW_IX = Buffer.from([
  149, 158, 33, 185, 47, 243, 253, 31,
]);

const SWAP_DIR_USDC_TO_YES = 0;
const SWAP_DIR_USDC_TO_NO = 1;
const SWAP_DIR_YES_TO_USDC = 2;
const SWAP_DIR_NO_TO_USDC = 3;
const SWAP_DIR_YES_TO_NO = 4;
const SWAP_DIR_NO_TO_YES = 5;

const DUST_MICROS = 10n;
const PARSE_CONCURRENCY = 2;

function readU64LE(buf: Buffer, offset: number): bigint {
  return buf.readBigUInt64LE(offset);
}

function decodeIxData(dataBs58: string): Buffer | null {
  try {
    return Buffer.from(bs58.decode(dataBs58));
  } catch {
    return null;
  }
}

type RawIx = {
  programId: PublicKey;
  accounts: PublicKey[];
  data: string;
};

function toPublicKeyArray(accounts: unknown): PublicKey[] | null {
  if (!Array.isArray(accounts) || accounts.length === 0) return null;
  const out: PublicKey[] = [];
  for (const a of accounts) {
    try {
      out.push(a instanceof PublicKey ? a : new PublicKey(a as string));
    } catch {
      return null;
    }
  }
  return out;
}

function collectRawInstructions(tx: ParsedTransactionWithMeta): RawIx[] {
  const out: RawIx[] = [];
  const push = (ix: {
    programId?: PublicKey;
    accounts?: PublicKey[];
    data?: unknown;
  }) => {
    const pid = ix.programId;
    const accounts = toPublicKeyArray((ix as { accounts?: unknown }).accounts);
    const data = (ix as { data?: unknown }).data;
    if (!pid || !accounts || typeof data !== "string") return;
    out.push({ programId: pid, accounts, data });
  };

  const msg = tx.transaction.message as unknown as {
    instructions?: unknown[];
  };
  for (const ix of msg.instructions ?? []) {
    push(ix as { programId?: PublicKey; accounts?: PublicKey[]; data?: unknown });
  }
  for (const group of tx.meta?.innerInstructions ?? []) {
    for (const ix of group.instructions) {
      push(ix as { programId?: PublicKey; accounts?: PublicKey[]; data?: unknown });
    }
  }
  return out;
}

function firstSignerPubkey(tx: ParsedTransactionWithMeta): PublicKey | null {
  try {
    const msg = tx.transaction.message as unknown as {
      getAccountKeys?: () => { staticAccountKeys: PublicKey[] };
      staticAccountKeys?: PublicKey[];
      accountKeys?: PublicKey[];
    };
    if (typeof msg.getAccountKeys === "function") {
      const keys = msg.getAccountKeys().staticAccountKeys;
      const k = keys[0];
      if (k) return k instanceof PublicKey ? k : new PublicKey(k);
    }
    const raw = msg.staticAccountKeys?.[0] ?? msg.accountKeys?.[0];
    if (!raw) return null;
    return raw instanceof PublicKey ? raw : new PublicKey(raw as string);
  } catch {
    return null;
  }
}

function tokenBalanceAtoms(
  tb: { uiTokenAmount?: { amount?: string } } | undefined,
): bigint {
  try {
    const a = tb?.uiTokenAmount?.amount;
    if (a == null || a === "") return 0n;
    return BigInt(a);
  } catch {
    return 0n;
  }
}

/** Net collateral micros received by `owner` (USDC 6dp for pmAMM). */
function inferCollateralNetToOwnerMicros(
  tx: ParsedTransactionWithMeta,
  owner: PublicKey,
  collateralMint: PublicKey,
): bigint {
  const ownerStr = owner.toBase58();
  const mintStr = collateralMint.toBase58();
  const pre = tx.meta?.preTokenBalances ?? [];
  const post = tx.meta?.postTokenBalances ?? [];
  const indices = new Set<number>();
  for (const t of [...pre, ...post]) {
    if (t.mint === mintStr && t.owner === ownerStr) indices.add(t.accountIndex);
  }
  let maxNet = 0n;
  for (const idx of indices) {
    const p0 = tokenBalanceAtoms(
      pre.find((x) => x.accountIndex === idx && x.mint === mintStr),
    );
    const p1 = tokenBalanceAtoms(
      post.find((x) => x.accountIndex === idx && x.mint === mintStr),
    );
    const d = p1 - p0;
    if (d > maxNet) maxNet = d;
  }
  return maxNet > 0n ? maxNet : 0n;
}

function formatUsdFromCollateralMicros(micros: bigint): string {
  if (micros <= 0n) return "$0.00";
  const n = Number(micros) / 1_000_000;
  if (!Number.isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

function formatOutcomeSharesHuman(atoms: bigint, decimals: number): string {
  if (decimals <= 0) return atoms.toString();
  const base = 10n ** BigInt(decimals);
  const whole = atoms / base;
  const frac = atoms % base;
  const fracStr = frac
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  const s = fracStr.length > 0 ? `${whole}.${fracStr}` : `${whole}`;
  return `${s} sh`;
}

function parsePmammSwapIx(
  ix: RawIx,
  pmammId: PublicKey,
): { direction: number; amountIn: bigint } | null {
  if (!ix.programId.equals(pmammId)) return null;
  const payload = decodeIxData(ix.data);
  if (!payload || payload.length < 8 + 1 + 8) return null;
  if (!payload.subarray(0, 8).equals(PMAMM_SWAP_IX)) return null;
  const direction = payload.readUInt8(8);
  const amountIn = readU64LE(payload, 9);
  return { direction, amountIn };
}

function parsePmammDepositIx(
  ix: RawIx,
  pmammId: PublicKey,
): bigint | null {
  if (!ix.programId.equals(pmammId)) return null;
  const payload = decodeIxData(ix.data);
  if (!payload || payload.length < 8 + 8) return null;
  if (!payload.subarray(0, 8).equals(PMAMM_DEPOSIT_IX)) return null;
  return readU64LE(payload, 8);
}

function parsePmammWithdrawIx(ix: RawIx, pmammId: PublicKey): boolean {
  if (!ix.programId.equals(pmammId)) return false;
  const payload = decodeIxData(ix.data);
  if (!payload || payload.length < 8) return false;
  return payload.subarray(0, 8).equals(PMAMM_WITHDRAW_IX);
}

function swapLabelAndSummaryPmamm(params: {
  direction: number;
  amountIn: bigint;
  tx: ParsedTransactionWithMeta;
  collateralMint: PublicKey;
}): { label: string; summary: string } {
  const { direction, amountIn, tx, collateralMint } = params;
  const payer = firstSignerPubkey(tx);

  switch (direction) {
    case SWAP_DIR_USDC_TO_YES:
      return {
        label: "BUY YES",
        summary: formatUsdFromCollateralMicros(amountIn),
      };
    case SWAP_DIR_USDC_TO_NO:
      return {
        label: "BUY NO",
        summary: formatUsdFromCollateralMicros(amountIn),
      };
    case SWAP_DIR_YES_TO_USDC: {
      const recv =
        payer != null
          ? inferCollateralNetToOwnerMicros(tx, payer, collateralMint)
          : 0n;
      const micros = recv > DUST_MICROS ? recv : 0n;
      return {
        label: "SELL YES",
        summary:
          micros > 0n
            ? formatUsdFromCollateralMicros(micros)
            : "—",
      };
    }
    case SWAP_DIR_NO_TO_USDC: {
      const recv =
        payer != null
          ? inferCollateralNetToOwnerMicros(tx, payer, collateralMint)
          : 0n;
      const micros = recv > DUST_MICROS ? recv : 0n;
      return {
        label: "SELL NO",
        summary:
          micros > 0n
            ? formatUsdFromCollateralMicros(micros)
            : "—",
      };
    }
    case SWAP_DIR_YES_TO_NO:
      return {
        label: "Swap YES→NO",
        summary: formatOutcomeSharesHuman(amountIn, 6),
      };
    case SWAP_DIR_NO_TO_YES:
      return {
        label: "Swap NO→YES",
        summary: formatOutcomeSharesHuman(amountIn, 6),
      };
    default:
      return { label: "Swap", summary: "—" };
  }
}

/**
 * Classify a parsed tx for order-book display (USDC notional in `summary` for USDC legs).
 */
export function classifyPmammMarketTx(
  tx: ParsedTransactionWithMeta,
  params: {
    pmammProgramId: PublicKey;
    collateralMint: PublicKey;
    yesMint: PublicKey;
    noMint: PublicKey;
  },
): { label: string; summary: string } {
  const { pmammProgramId, collateralMint, yesMint, noMint } = params;
  const rawIxs = collectRawInstructions(tx);

  for (const ix of rawIxs) {
    const swap = parsePmammSwapIx(ix, pmammProgramId);
    if (swap && swap.amountIn > 0n) {
      return swapLabelAndSummaryPmamm({
        direction: swap.direction,
        amountIn: swap.amountIn,
        tx,
        collateralMint,
      });
    }
  }

  for (const ix of rawIxs) {
    const dep = parsePmammDepositIx(ix, pmammProgramId);
    if (dep != null && dep > 0n) {
      return {
        label: "Add LP",
        summary: formatUsdFromCollateralMicros(dep),
      };
    }
  }

  for (const ix of rawIxs) {
    if (parsePmammWithdrawIx(ix, pmammProgramId)) {
      return { label: "Remove LP", summary: "—" };
    }
  }

  const sawPmamm = rawIxs.some((ix) => ix.programId.equals(pmammProgramId));
  if (sawPmamm) {
    return { label: "Pool", summary: "—" };
  }

  return { label: "Tx", summary: "—" };
}

/** USDC micros (6 dp) attributed to this trade for volume cache. */
export function parsePmammTradeVolumeUsdMicrosFromParsedTx(
  tx: ParsedTransactionWithMeta,
  params: {
    pmammProgramId: PublicKey;
    collateralMint: PublicKey;
    yesMint: PublicKey;
    noMint: PublicKey;
  },
): ParsedTradeVolumeUsd {
  void params.yesMint;
  void params.noMint;
  const { pmammProgramId, collateralMint } = params;
  const payer = firstSignerPubkey(tx);
  const rawIxs = collectRawInstructions(tx);

  let sawLiquidityOnly = false;
  let sawSwap = false;

  for (const ix of rawIxs) {
    if (!ix.programId.equals(pmammProgramId)) continue;
    const payload = decodeIxData(ix.data);
    if (!payload || payload.length < 8) continue;
    const head = payload.subarray(0, 8);
    if (head.equals(PMAMM_SWAP_IX)) {
      sawSwap = true;
      const swap = parsePmammSwapIx(ix, pmammProgramId);
      if (!swap || swap.amountIn <= 0n) continue;
      const { direction, amountIn } = swap;
      if (direction === SWAP_DIR_USDC_TO_YES || direction === SWAP_DIR_USDC_TO_NO) {
        return { micros: amountIn, source: "pmamm_swap_usdc_in" };
      }
      if (
        direction === SWAP_DIR_YES_TO_USDC ||
        direction === SWAP_DIR_NO_TO_USDC
      ) {
        if (payer) {
          const recv = inferCollateralNetToOwnerMicros(
            tx,
            payer,
            collateralMint,
          );
          if (recv > DUST_MICROS) {
            return { micros: recv, source: "pmamm_swap_usdc_out" };
          }
        }
        return { micros: 0n, source: "pmamm_swap_usdc_out_unparsed" };
      }
      return { micros: 0n, source: "pmamm_swap_outcome_only" };
    }
    if (head.equals(PMAMM_DEPOSIT_IX) || head.equals(PMAMM_WITHDRAW_IX)) {
      sawLiquidityOnly = true;
    }
  }

  if (sawLiquidityOnly && !sawSwap) {
    return { micros: 0n, source: "pmamm_liquidity_only" };
  }

  return { micros: 0n, source: "pmamm_none" };
}

async function fetchParsedTxsOneByOne(
  connection: Connection,
  signatures: string[],
): Promise<(ParsedTransactionWithMeta | null)[]> {
  const out: (ParsedTransactionWithMeta | null)[] = new Array(
    signatures.length,
  );
  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor++;
      if (i >= signatures.length) return;
      const sig = signatures[i]!;
      const tx = await connection.getParsedTransaction(sig, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      out[i] = tx;
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(PARSE_CONCURRENCY, signatures.length) }, () =>
      worker(),
    ),
  );
  return out;
}

const DEFAULT_VOLUME_SIG_CAP = 5000;

export async function fetchPmammMarketTotalSwapVolumeUsdWithStats(
  connection: Connection,
  params: {
    marketPda: PublicKey;
    collateralMint: PublicKey;
    yesMint: PublicKey;
    noMint: PublicKey;
    maxSignatures?: number;
  },
): Promise<PoolTotalSwapVolumeStats> {
  const programId = requirePmammProgramId();
  const cap = Math.min(params.maxSignatures ?? DEFAULT_VOLUME_SIG_CAP, 50_000);
  const pageSize = 1000;
  let totalMicros = 0n;
  let swapsParsed = 0;
  let before: string | undefined;
  let fetched = 0;

  while (fetched < cap) {
    const pageLimit = Math.min(pageSize, cap - fetched);
    const sigInfos = await connection.getSignaturesForAddress(
      params.marketPda,
      { limit: pageLimit, before },
      "confirmed",
    );
    if (sigInfos.length === 0) break;

    const signatures = sigInfos.filter((s) => !s.err).map((s) => s.signature);
    const txs = await fetchParsedTxsOneByOne(connection, signatures);

    for (let i = 0; i < txs.length; i++) {
      const tx = txs[i];
      if (!tx) continue;
      const { micros } = parsePmammTradeVolumeUsdMicrosFromParsedTx(tx, {
        pmammProgramId: programId,
        collateralMint: params.collateralMint,
        yesMint: params.yesMint,
        noMint: params.noMint,
      });
      if (micros > 0n) swapsParsed += 1;
      totalMicros += micros;
    }

    fetched += sigInfos.length;
    const lastSig = sigInfos[sigInfos.length - 1]?.signature;
    if (!lastSig || sigInfos.length < pageLimit) break;
    before = lastSig;
  }

  const volumeUsd = Number(totalMicros) / 1_000_000;
  return {
    volumeUsd: Number.isFinite(volumeUsd) ? volumeUsd : 0,
    signaturesScanned: fetched,
    swapsParsed,
  };
}

const DEFAULT_24H_SIG_CAP = 20_000;

export async function fetchPmammMarketSwapVolumeUsd24hWithStats(
  connection: Connection,
  params: {
    marketPda: PublicKey;
    collateralMint: PublicKey;
    yesMint: PublicKey;
    noMint: PublicKey;
    maxSignatures?: number;
  },
): Promise<PoolTotalSwapVolumeStats> {
  const programId = requirePmammProgramId();
  const cap = Math.min(params.maxSignatures ?? DEFAULT_24H_SIG_CAP, 50_000);
  const minBlockTimeSec = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
  const pageSize = 1000;
  let totalMicros = 0n;
  let swapsParsed = 0;
  let before: string | undefined;
  let fetched = 0;
  let done = false;

  while (fetched < cap && !done) {
    const pageLimit = Math.min(pageSize, cap - fetched);
    const sigInfos = await connection.getSignaturesForAddress(
      params.marketPda,
      { limit: pageLimit, before },
      "confirmed",
    );
    if (sigInfos.length === 0) break;

    const inWindow: typeof sigInfos = [];
    for (const s of sigInfos) {
      if (s.err) continue;
      if (s.blockTime != null && s.blockTime < minBlockTimeSec) {
        done = true;
        break;
      }
      inWindow.push(s);
    }

    const signatures = inWindow.map((s) => s.signature);
    const txs = await fetchParsedTxsOneByOne(connection, signatures);

    for (let i = 0; i < txs.length; i++) {
      const tx = txs[i];
      if (!tx) continue;
      const { micros } = parsePmammTradeVolumeUsdMicrosFromParsedTx(tx, {
        pmammProgramId: programId,
        collateralMint: params.collateralMint,
        yesMint: params.yesMint,
        noMint: params.noMint,
      });
      if (micros > 0n) swapsParsed += 1;
      totalMicros += micros;
    }

    fetched += sigInfos.length;
    const lastSig = sigInfos[sigInfos.length - 1]?.signature;
    if (!lastSig || sigInfos.length < pageLimit) break;
    before = lastSig;
  }

  const volumeUsd = Number(totalMicros) / 1_000_000;
  return {
    volumeUsd: Number.isFinite(volumeUsd) ? volumeUsd : 0,
    signaturesScanned: fetched,
    swapsParsed,
  };
}

export async function fetchPmammMarketOnchainActivity(
  connection: Connection,
  params: {
    marketPda: PublicKey;
    collateralMint: PublicKey;
    yesMint: PublicKey;
    noMint: PublicKey;
    limit?: number;
  },
): Promise<OnchainPoolActivityEntry[]> {
  const programId = requirePmammProgramId();
  const cap = Math.min(Math.max(1, params.limit ?? 24), 100);

  const sigInfos = await connection.getSignaturesForAddress(
    params.marketPda,
    { limit: cap },
    "confirmed",
  );

  const signatures = sigInfos
    .filter((s) => !s.err)
    .map((s) => s.signature);
  if (signatures.length === 0) return [];

  const txs = await fetchParsedTxsOneByOne(connection, signatures);

  const entries: OnchainPoolActivityEntry[] = [];
  for (let i = 0; i < txs.length; i++) {
    const tx = txs[i];
    const sig = signatures[i];
    if (!tx || !sig) continue;
    const blockTimeMs =
      tx.blockTime != null ? tx.blockTime * 1000 : Date.now();
    const { label, summary } = classifyPmammMarketTx(tx, {
      pmammProgramId: programId,
      collateralMint: params.collateralMint,
      yesMint: params.yesMint,
      noMint: params.noMint,
    });
    entries.push({
      signature: sig,
      blockTimeMs,
      label,
      summary,
    });
  }
  return entries;
}

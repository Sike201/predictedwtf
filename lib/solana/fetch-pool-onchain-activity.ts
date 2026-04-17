/**
 * Recent **on-chain** activity for an Omnipair pair by scanning transactions that reference the pair account.
 */
import bs58 from "bs58";
import { Connection, PublicKey } from "@solana/web3.js";
import type { ParsedTransactionWithMeta } from "@solana/web3.js";

import { anchorDiscriminator } from "@/lib/solana/anchor-util";
import { getOmnipairProgramId } from "@/lib/solana/omnipair-program";
import { outcomeBaseUnitsToUsdcBaseUnits } from "@/lib/solana/mint-market-positions";

export type OnchainPoolActivityEntry = {
  signature: string;
  blockTimeMs: number;
  /** e.g. BUY YES, SELL YES, Bootstrap */
  label: string;
  /** USDC-notional (mint parity), e.g. "$12.40", or "—" */
  summary: string;
};

const SWAP_D = anchorDiscriminator("swap");
const INIT_D = anchorDiscriminator("initialize");

/** `buildOmnipairSwapInstruction` account order: tokenInMint = index 7, tokenOutMint = 8. */
const OMNIPAIR_SWAP_TOKEN_IN_MINT_INDEX = 7;
const OMNIPAIR_SWAP_TOKEN_OUT_MINT_INDEX = 8;

function readU64LE(buf: Buffer, offset: number): bigint {
  return buf.readBigUInt64LE(offset);
}

function formatUsdFromOutcomeAtomsSold(atoms: bigint): string {
  if (atoms <= 0n) return "$0.00";
  const usdcMicro = outcomeBaseUnitsToUsdcBaseUnits(atoms);
  const n = Number(usdcMicro) / 1_000_000;
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
  const push = (ix: { programId?: PublicKey; accounts?: PublicKey[]; data?: unknown }) => {
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

function decodeSwapPayload(dataBs58: string): Buffer | null {
  try {
    return Buffer.from(bs58.decode(dataBs58));
  } catch {
    return null;
  }
}

/**
 * Omnipair is YES↔NO only. Notional $ uses custody mint parity on the **amount in** leg.
 * - YES→NO: SELL YES (dispose YES to receive NO) / equivalent BUY NO wording — show SELL YES.
 * - NO→YES: BUY YES (pay NO to receive YES) / equivalent SELL NO — show BUY YES.
 */
function swapLabelAndUsd(
  amountIn: bigint,
  tokenInMint: PublicKey,
  tokenOutMint: PublicKey,
  yesMint: PublicKey,
  noMint: PublicKey,
): { label: string; summary: string } {
  const usd = formatUsdFromOutcomeAtomsSold(amountIn);

  const sellsYes =
    tokenInMint.equals(yesMint) && tokenOutMint.equals(noMint);
  const buysYes =
    tokenInMint.equals(noMint) && tokenOutMint.equals(yesMint);

  if (sellsYes) return { label: "SELL YES", summary: usd };
  if (buysYes) return { label: "BUY YES", summary: usd };

  return { label: "Swap", summary: usd };
}

const DUST_ATOMS = 10n;

/** Instruction / raw-data classification only (no token-balance fallback). */
function classifyTxFromInstructionsOnly(
  tx: ParsedTransactionWithMeta,
  omnipairId: PublicKey,
  yesMint: PublicKey,
  noMint: PublicKey,
): { label: string; summary: string } {
  const rawIxs = collectRawInstructions(tx);

  for (const ix of rawIxs) {
    if (!ix.programId.equals(omnipairId)) continue;
    const payload = decodeSwapPayload(ix.data);
    if (!payload || payload.length < 8 + 8) continue;
    const head = payload.subarray(0, 8);
    if (!head.equals(SWAP_D)) continue;

    if (
      ix.accounts.length <= OMNIPAIR_SWAP_TOKEN_OUT_MINT_INDEX
    ) {
      continue;
    }

    const amountIn = readU64LE(payload, 8);
    const tokenInMint = ix.accounts[OMNIPAIR_SWAP_TOKEN_IN_MINT_INDEX]!;
    const tokenOutMint = ix.accounts[OMNIPAIR_SWAP_TOKEN_OUT_MINT_INDEX]!;

    return swapLabelAndUsd(amountIn, tokenInMint, tokenOutMint, yesMint, noMint);
  }

  let sawInit = false;
  let sawOther = false;
  for (const ix of rawIxs) {
    if (!ix.programId.equals(omnipairId)) continue;
    const payload = decodeSwapPayload(ix.data);
    if (!payload || payload.length < 8) {
      sawOther = true;
      continue;
    }
    const head = payload.subarray(0, 8);
    if (head.equals(INIT_D)) {
      sawInit = true;
    } else if (!head.equals(SWAP_D)) {
      sawOther = true;
    }
  }

  if (sawInit) {
    return { label: "Bootstrap", summary: "—" };
  }
  if (sawOther) {
    return { label: "Pool", summary: "—" };
  }
  return { label: "Pool tx", summary: "—" };
}

function tokenBalanceAtoms(tb: { uiTokenAmount?: { amount?: string } } | undefined): bigint {
  try {
    const a = tb?.uiTokenAmount?.amount;
    if (a == null || a === "") return 0n;
    return BigInt(a);
  } catch {
    return 0n;
  }
}

/**
 * When ix decode misses (CPI layout, extra accounts, etc.), infer Omnipair YES↔NO notional
 * from token balance deltas (same idea as the explorer).
 */
function inferSwapLegFromTokenBalances(
  tx: ParsedTransactionWithMeta,
  yesMint: PublicKey,
  noMint: PublicKey,
): { label: string; atoms: bigint } | null {
  const pre = tx.meta?.preTokenBalances;
  const post = tx.meta?.postTokenBalances;
  if (!pre?.length && !post?.length) return null;

  const ys = yesMint.toBase58();
  const ns = noMint.toBase58();

  const allIndices = new Set<number>();
  for (const t of [...(pre ?? []), ...(post ?? [])]) {
    if (t.mint === ys || t.mint === ns) allIndices.add(t.accountIndex);
  }

  let bestYesDec = 0n;
  let bestYesInc = 0n;
  let bestNoDec = 0n;
  let bestNoInc = 0n;

  for (const idx of allIndices) {
    const preY = pre?.find((t) => t.accountIndex === idx && t.mint === ys);
    const postY = post?.find((t) => t.accountIndex === idx && t.mint === ys);
    const preN = pre?.find((t) => t.accountIndex === idx && t.mint === ns);
    const postN = post?.find((t) => t.accountIndex === idx && t.mint === ns);
    const y0 = tokenBalanceAtoms(preY);
    const y1 = tokenBalanceAtoms(postY);
    const n0 = tokenBalanceAtoms(preN);
    const n1 = tokenBalanceAtoms(postN);
    const dy = y1 - y0;
    const dn = n1 - n0;
    if (dy < 0n && -dy > bestYesDec) bestYesDec = -dy;
    if (dy > 0n && dy > bestYesInc) bestYesInc = dy;
    if (dn < 0n && -dn > bestNoDec) bestNoDec = -dn;
    if (dn > 0n && dn > bestNoInc) bestNoInc = dn;
  }

  const maxLeg = bestYesDec + bestYesInc + bestNoDec + bestNoInc;
  if (maxLeg <= DUST_ATOMS) return null;

  // BUY YES: pay NO → receive YES (max single-account NO decrease vs YES increase).
  // SELL YES: pay YES → receive NO (max YES decrease vs NO increase).
  if (bestNoDec > bestYesDec + DUST_ATOMS && bestNoDec > DUST_ATOMS) {
    return { label: "BUY YES", atoms: bestNoDec };
  }
  if (bestYesDec > bestNoDec + DUST_ATOMS && bestYesDec > DUST_ATOMS) {
    return { label: "SELL YES", atoms: bestYesDec };
  }
  if (bestNoDec >= bestYesDec && bestNoDec > DUST_ATOMS) {
    return { label: "BUY YES", atoms: bestNoDec };
  }
  if (bestYesDec > DUST_ATOMS) {
    return { label: "SELL YES", atoms: bestYesDec };
  }
  if (bestYesInc > DUST_ATOMS || bestNoInc > DUST_ATOMS) {
    const a = bestYesInc >= bestNoInc ? bestYesInc : bestNoInc;
    return {
      label: bestYesInc >= bestNoInc ? "BUY YES" : "SELL YES",
      atoms: a,
    };
  }
  return null;
}

function inferSwapFromTokenBalances(
  tx: ParsedTransactionWithMeta,
  yesMint: PublicKey,
  noMint: PublicKey,
): { label: string; summary: string } | null {
  const leg = inferSwapLegFromTokenBalances(tx, yesMint, noMint);
  if (!leg) return null;
  return {
    label: leg.label,
    summary: formatUsdFromOutcomeAtomsSold(leg.atoms),
  };
}

function parseSwapUsdMicrosFromSwapIx(
  tx: ParsedTransactionWithMeta,
  omnipairId: PublicKey,
  yesMint: PublicKey,
  noMint: PublicKey,
): bigint {
  const rawIxs = collectRawInstructions(tx);
  for (const ix of rawIxs) {
    if (!ix.programId.equals(omnipairId)) continue;
    const payload = decodeSwapPayload(ix.data);
    if (!payload || payload.length < 8 + 8) continue;
    if (!payload.subarray(0, 8).equals(SWAP_D)) continue;
    if (ix.accounts.length <= OMNIPAIR_SWAP_TOKEN_OUT_MINT_INDEX) continue;
    const amountIn = readU64LE(payload, 8);
    const tokenInMint = ix.accounts[OMNIPAIR_SWAP_TOKEN_IN_MINT_INDEX]!;
    const tokenOutMint = ix.accounts[OMNIPAIR_SWAP_TOKEN_OUT_MINT_INDEX]!;
    const sellsYes =
      tokenInMint.equals(yesMint) && tokenOutMint.equals(noMint);
    const buysYes =
      tokenInMint.equals(noMint) && tokenOutMint.equals(yesMint);
    if (!sellsYes && !buysYes) continue;
    if (amountIn <= 0n) continue;
    return outcomeBaseUnitsToUsdcBaseUnits(amountIn);
  }
  return 0n;
}

/**
 * USDC micro-units (6 dp) of Omnipair YES↔NO swap notional for this tx (0 when not a swap).
 */
export function parseSwapUsdMicrosFromTx(
  tx: ParsedTransactionWithMeta,
  omnipairId: PublicKey,
  yesMint: PublicKey,
  noMint: PublicKey,
): bigint {
  const fromIx = parseSwapUsdMicrosFromSwapIx(tx, omnipairId, yesMint, noMint);
  if (fromIx > 0n) return fromIx;
  const leg = inferSwapLegFromTokenBalances(tx, yesMint, noMint);
  if (!leg) return 0n;
  return outcomeBaseUnitsToUsdcBaseUnits(leg.atoms);
}

const DEFAULT_VOLUME_SIG_CAP = 5000;

/**
 * Sums swap notionals (instruction decode + balance fallback) across paginated pair history.
 * Capped for RPC cost — increase `maxSignatures` for fuller totals.
 */
export async function fetchPoolTotalSwapVolumeUsd(
  connection: Connection,
  params: {
    pairAddress: PublicKey;
    yesMint: PublicKey;
    noMint: PublicKey;
    maxSignatures?: number;
  },
): Promise<number> {
  const omnipairId = getOmnipairProgramId();
  const cap = Math.min(params.maxSignatures ?? DEFAULT_VOLUME_SIG_CAP, 50_000);
  const pageSize = 1000;
  let totalMicros = 0n;
  let before: string | undefined;
  let fetched = 0;

  while (fetched < cap) {
    const pageLimit = Math.min(pageSize, cap - fetched);
    const sigInfos = await connection.getSignaturesForAddress(
      params.pairAddress,
      { limit: pageLimit, before },
      "confirmed",
    );
    if (sigInfos.length === 0) break;

    const signatures = sigInfos.filter((s) => !s.err).map((s) => s.signature);
    const txs = await fetchParsedTxsOneByOne(connection, signatures);

    for (let i = 0; i < txs.length; i++) {
      const tx = txs[i];
      if (!tx) continue;
      totalMicros += parseSwapUsdMicrosFromTx(
        tx,
        omnipairId,
        params.yesMint,
        params.noMint,
      );
    }

    fetched += sigInfos.length;
    const lastSig = sigInfos[sigInfos.length - 1]?.signature;
    if (!lastSig || sigInfos.length < pageLimit) break;
    before = lastSig;
  }

  return Number(totalMicros) / 1_000_000;
}

function classifyTx(
  tx: ParsedTransactionWithMeta,
  omnipairId: PublicKey,
  yesMint: PublicKey,
  noMint: PublicKey,
): { label: string; summary: string } {
  const primary = classifyTxFromInstructionsOnly(tx, omnipairId, yesMint, noMint);
  const tryBalance =
    primary.label === "Pool" ||
    primary.label === "Pool tx" ||
    primary.label === "Swap";

  if (!tryBalance) {
    return primary;
  }

  const inferred = inferSwapFromTokenBalances(tx, yesMint, noMint);
  return inferred ?? primary;
}

/**
 * Fetches recent signatures for the pair PDA, then loads parsed txs and classifies Omnipair ixs.
 */
/** Keep low — free RPC tiers often rate-limit parallel reads. */
const PARSE_CONCURRENCY = 2;

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

export async function fetchPoolOnchainActivity(
  connection: Connection,
  params: {
    pairAddress: PublicKey;
    yesMint: PublicKey;
    noMint: PublicKey;
    limit?: number;
  },
): Promise<OnchainPoolActivityEntry[]> {
  /** Must match deployed program for ix decode; falls back without env. */
  const omnipairId = getOmnipairProgramId();
  const cap = Math.min(Math.max(1, params.limit ?? 24), 40);

  const sigInfos = await connection.getSignaturesForAddress(
    params.pairAddress,
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
    try {
      const { label, summary } = classifyTx(
        tx,
        omnipairId,
        params.yesMint,
        params.noMint,
      );
      entries.push({
        signature: sig,
        blockTimeMs,
        label,
        summary,
      });
    } catch {
      const inferred = inferSwapFromTokenBalances(
        tx,
        params.yesMint,
        params.noMint,
      );
      entries.push({
        signature: sig,
        blockTimeMs,
        ...(inferred ?? { label: "Tx" as const, summary: "—" }),
      });
    }
  }
  return entries;
}

/**
 * Recent **on-chain** activity for an Omnipair pair by scanning transactions that reference the pair account.
 */
import bs58 from "bs58";
import { Connection, PublicKey } from "@solana/web3.js";
import type { ParsedTransactionWithMeta } from "@solana/web3.js";

import { DEVNET_USDC_MINT } from "@/lib/solana/assets";
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
const ADD_LIQUIDITY_D = anchorDiscriminator("add_liquidity");
const REMOVE_LIQUIDITY_D = anchorDiscriminator("remove_liquidity");

type OmnipairCoreIxFlags = {
  sawSwap: boolean;
  sawAddLiquidity: boolean;
  sawRemoveLiquidity: boolean;
};

/** Scan top-level + inner Omnipair instructions for swap vs liquidity adjust. */
function scanOmnipairCoreInstructionFlags(
  tx: ParsedTransactionWithMeta,
  omnipairId: PublicKey,
): OmnipairCoreIxFlags {
  const rawIxs = collectRawInstructions(tx);
  const flags: OmnipairCoreIxFlags = {
    sawSwap: false,
    sawAddLiquidity: false,
    sawRemoveLiquidity: false,
  };
  for (const ix of rawIxs) {
    if (!ix.programId.equals(omnipairId)) continue;
    const payload = decodeSwapPayload(ix.data);
    if (!payload || payload.length < 8) continue;
    const head = payload.subarray(0, 8);
    if (head.equals(SWAP_D)) flags.sawSwap = true;
    if (head.equals(ADD_LIQUIDITY_D)) flags.sawAddLiquidity = true;
    if (head.equals(REMOVE_LIQUIDITY_D)) flags.sawRemoveLiquidity = true;
  }
  return flags;
}

function liquidityAdjustWithoutSwap(flags: OmnipairCoreIxFlags): boolean {
  const sawLiquidity = flags.sawAddLiquidity || flags.sawRemoveLiquidity;
  return sawLiquidity && !flags.sawSwap;
}

function classifyLiquidityOnlyActivity(
  flags: OmnipairCoreIxFlags,
): { label: string; summary: string } {
  if (flags.sawAddLiquidity && flags.sawRemoveLiquidity) {
    return { label: "Liquidity", summary: "—" };
  }
  if (flags.sawAddLiquidity) {
    return { label: "Add LP", summary: "—" };
  }
  return { label: "Remove LP", summary: "—" };
}

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

/**
 * Devnet USDC leg: net USDC received by the fee payer (custody → user on sell redeem).
 */
function inferUsdcNetToFeePayerMicros(
  tx: ParsedTransactionWithMeta,
): bigint {
  const payer = firstSignerPubkey(tx);
  if (!payer) return 0n;
  const payerStr = payer.toBase58();
  const usdc = DEVNET_USDC_MINT.toBase58();
  const pre = tx.meta?.preTokenBalances ?? [];
  const post = tx.meta?.postTokenBalances ?? [];
  const indices = new Set<number>();
  for (const t of [...pre, ...post]) {
    if (t.mint === usdc && t.owner === payerStr) indices.add(t.accountIndex);
  }
  let maxNet = 0n;
  for (const idx of indices) {
    const p0 = tokenBalanceAtoms(
      pre.find((x) => x.accountIndex === idx && x.mint === usdc),
    );
    const p1 = tokenBalanceAtoms(
      post.find((x) => x.accountIndex === idx && x.mint === usdc),
    );
    const d = p1 - p0;
    if (d > maxNet) maxNet = d;
  }
  return maxNet > 0n ? maxNet : 0n;
}

/**
 * USDC sent **from** the fee payer (user → custody on buy-with-USDC).
 * Pairs with `inferUsdcNetToFeePayerMicros`; swap-ix parse can miss CPI layouts — custody notional still counts as volume.
 */
function inferUsdcSentByFeePayerMicros(
  tx: ParsedTransactionWithMeta,
): bigint {
  const payer = firstSignerPubkey(tx);
  if (!payer) return 0n;
  const payerStr = payer.toBase58();
  const usdc = DEVNET_USDC_MINT.toBase58();
  const pre = tx.meta?.preTokenBalances ?? [];
  const post = tx.meta?.postTokenBalances ?? [];
  const indices = new Set<number>();
  for (const t of [...pre, ...post]) {
    if (t.mint === usdc && t.owner === payerStr) indices.add(t.accountIndex);
  }
  let maxOut = 0n;
  for (const idx of indices) {
    const p0 = tokenBalanceAtoms(
      pre.find((x) => x.accountIndex === idx && x.mint === usdc),
    );
    const p1 = tokenBalanceAtoms(
      post.find((x) => x.accountIndex === idx && x.mint === usdc),
    );
    const d = p0 - p1;
    if (d > maxOut) maxOut = d;
  }
  return maxOut > 0n ? maxOut : 0n;
}

/**
 * Paired YES+NO burn to exit into USDC (sell flow without a countable swap ix decode).
 * Uses fee-payer-owned outcome ATAs only (avoids vault noise).
 */
function inferPairedOutcomeBurnUsdMicrosForFeePayer(
  tx: ParsedTransactionWithMeta,
  yesMint: PublicKey,
  noMint: PublicKey,
): bigint {
  const payer = firstSignerPubkey(tx);
  if (!payer) return 0n;
  const payerStr = payer.toBase58();
  const ys = yesMint.toBase58();
  const ns = noMint.toBase58();

  const pre = tx.meta?.preTokenBalances ?? [];
  const post = tx.meta?.postTokenBalances ?? [];
  const indices = new Set<number>();
  for (const t of [...pre, ...post]) {
    if (t.owner !== payerStr) continue;
    if (t.mint === ys || t.mint === ns) indices.add(t.accountIndex);
  }

  let burnYes = 0n;
  let burnNo = 0n;
  for (const idx of indices) {
    const pY = pre.find((x) => x.accountIndex === idx && x.mint === ys);
    const oY = post.find((x) => x.accountIndex === idx && x.mint === ys);
    const pN = pre.find((x) => x.accountIndex === idx && x.mint === ns);
    const oN = post.find((x) => x.accountIndex === idx && x.mint === ns);
    const y0 = tokenBalanceAtoms(pY);
    const y1 = tokenBalanceAtoms(oY);
    const n0 = tokenBalanceAtoms(pN);
    const n1 = tokenBalanceAtoms(oN);
    if (y0 > y1) {
      const b = y0 - y1;
      if (b > burnYes) burnYes = b;
    }
    if (n0 > n1) {
      const b = n0 - n1;
      if (b > burnNo) burnNo = b;
    }
  }

  let atoms = 0n;
  if (burnYes > DUST_ATOMS && burnNo > DUST_ATOMS) {
    atoms = burnYes < burnNo ? burnYes : burnNo;
  } else {
    atoms = burnYes >= burnNo ? burnYes : burnNo;
  }
  if (atoms <= DUST_ATOMS) return 0n;
  return outcomeBaseUnitsToUsdcBaseUnits(atoms);
}

export type ParsedTradeVolumeUsd = {
  /** USDC micro-units (6 dp) */
  micros: bigint;
  /** Which heuristic produced `micros` */
  source: string;
};

/**
 * Full trade volume for a tx: Omnipair swap ix, then USDCNative sell redeem legs, then balance fallback.
 * Sell-to-USDC often pairs burn + custody transfer **without** a standalone YES↔NO swap amount
 * matching `parseSwapUsdMicrosFromSwapIx` — custody USDC to user / paired burns must count.
 */
export function parseTradeVolumeUsdMicrosFromTx(
  tx: ParsedTransactionWithMeta,
  omnipairId: PublicKey,
  yesMint: PublicKey,
  noMint: PublicKey,
): ParsedTradeVolumeUsd {
  const coreFlags = scanOmnipairCoreInstructionFlags(tx, omnipairId);
  if (liquidityAdjustWithoutSwap(coreFlags)) {
    return { micros: 0n, source: "liquidity_adjust_only" };
  }

  const swapMicros = parseSwapUsdMicrosFromSwapIx(
    tx,
    omnipairId,
    yesMint,
    noMint,
  );
  const primary = classifyTxFromInstructionsOnly(tx, omnipairId, yesMint, noMint);
  if (primary.label === "Bootstrap") {
    return { micros: 0n, source: "bootstrap" };
  }

  const usdcMicros = inferUsdcNetToFeePayerMicros(tx);
  const usdcSentMicros = inferUsdcSentByFeePayerMicros(tx);
  const pairedMicros = inferPairedOutcomeBurnUsdMicrosForFeePayer(
    tx,
    yesMint,
    noMint,
  );

  /** Prefer largest explicit leg (buy USDC→custody vs sell redeem vs swap ix). */
  let best: ParsedTradeVolumeUsd = { micros: 0n, source: "none" };
  if (swapMicros > best.micros) {
    best = { micros: swapMicros, source: "omnipair_swap_ix" };
  }
  if (usdcMicros > best.micros) {
    best = { micros: usdcMicros, source: "usdc_to_fee_payer" };
  }
  if (usdcSentMicros > best.micros) {
    best = { micros: usdcSentMicros, source: "usdc_from_fee_payer" };
  }
  if (pairedMicros > best.micros) {
    best = { micros: pairedMicros, source: "paired_outcome_burn" };
  }
  if (best.micros > 0n) {
    return best;
  }

  const leg = inferSwapLegFromTokenBalances(tx, yesMint, noMint);
  if (!leg) {
    return { micros: 0n, source: "none" };
  }
  const m = outcomeBaseUnitsToUsdcBaseUnits(leg.atoms);
  return { micros: m, source: `token_balance_${leg.label}` };
}

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
  return parseTradeVolumeUsdMicrosFromTx(tx, omnipairId, yesMint, noMint).micros;
}

const DEFAULT_VOLUME_SIG_CAP = 5000;

export type PoolTotalSwapVolumeStats = {
  volumeUsd: number;
  /** Rows returned from `getSignaturesForAddress` (paginated, capped). */
  signaturesScanned: number;
  /** Parsed txs where YES↔NO swap notional > 0 (same loop as volume sum). */
  swapsParsed: number;
};

/**
 * Sums swap notionals (instruction decode + balance fallback) across paginated pair history.
 * Capped for RPC cost — increase `maxSignatures` for fuller totals.
 */
export async function fetchPoolTotalSwapVolumeUsdWithStats(
  connection: Connection,
  params: {
    pairAddress: PublicKey;
    yesMint: PublicKey;
    noMint: PublicKey;
    maxSignatures?: number;
  },
): Promise<PoolTotalSwapVolumeStats> {
  const omnipairId = getOmnipairProgramId();
  const cap = Math.min(params.maxSignatures ?? DEFAULT_VOLUME_SIG_CAP, 50_000);
  const pageSize = 1000;
  let totalMicros = 0n;
  let swapsParsed = 0;
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
      const micros = parseSwapUsdMicrosFromTx(
        tx,
        omnipairId,
        params.yesMint,
        params.noMint,
      );
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

/**
 * Sum swap notional in USD for roughly the last 24h (by blockTime on
 * `getSignaturesForAddress` rows). Stops early once signatures are older than the
 * window — cheaper than a full-pair scan when the pool is active.
 */
export async function fetchPoolSwapVolumeUsd24hWithStats(
  connection: Connection,
  params: {
    pairAddress: PublicKey;
    yesMint: PublicKey;
    noMint: PublicKey;
    maxSignatures?: number;
  },
): Promise<PoolTotalSwapVolumeStats> {
  const omnipairId = getOmnipairProgramId();
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
      params.pairAddress,
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
      const micros = parseSwapUsdMicrosFromTx(
        tx,
        omnipairId,
        params.yesMint,
        params.noMint,
      );
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

/**
 * @see fetchPoolTotalSwapVolumeUsdWithStats — same aggregation, number only.
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
  const s = await fetchPoolTotalSwapVolumeUsdWithStats(connection, params);
  return s.volumeUsd;
}

export type SingleTxTradeVolumeResult = {
  volumeUsd: number;
  /** Parser winning leg (see `parseTradeVolumeUsdMicrosFromTx`). */
  source: string;
  txMissing: boolean;
  metaErr: boolean;
};

/**
 * Single confirmed tx → USD notional (swap ix, custody USDC flows, paired burn, or balance fallback).
 */
export async function fetchSingleTxTradeVolumeUsd(
  connection: Connection,
  params: {
    signature: string;
    yesMint: PublicKey;
    noMint: PublicKey;
    /** pm-AMM: use USDC in/out (6 dp) instead of Omnipair outcome parity. */
    marketEngine?: string;
    collateralMint?: PublicKey;
  },
): Promise<SingleTxTradeVolumeResult> {
  let tx = await connection.getParsedTransaction(params.signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!tx) {
    tx = await connection.getParsedTransaction(params.signature, {
      commitment: "confirmed",
    });
  }

  if (!tx) {
    return {
      volumeUsd: 0,
      source: "no_parsed_tx",
      txMissing: true,
      metaErr: false,
    };
  }
  if (tx.meta?.err) {
    return {
      volumeUsd: 0,
      source: "tx_meta_err",
      txMissing: false,
      metaErr: true,
    };
  }

  if (params.marketEngine === "PM_AMM" && params.collateralMint) {
    const { parsePmammTradeVolumeUsdMicrosFromParsedTx } = await import(
      "@/lib/solana/pmamm-pool-activity"
    );
    const { requirePmammProgramId } = await import("@/lib/solana/pmamm-config");
    const parsed = parsePmammTradeVolumeUsdMicrosFromParsedTx(tx, {
      pmammProgramId: requirePmammProgramId(),
      collateralMint: params.collateralMint,
      yesMint: params.yesMint,
      noMint: params.noMint,
    });
    const volumeUsd = Number(parsed.micros) / 1_000_000;
    const v = Number.isFinite(volumeUsd) ? volumeUsd : 0;
    console.info("[predicted][sell-volume-trace]", {
      step: "single_tx_volume_parsed",
      txSignature: params.signature,
      source: parsed.source,
      volumeUsd: v,
    });
    return {
      volumeUsd: v,
      source: parsed.source,
      txMissing: false,
      metaErr: false,
    };
  }

  const omnipairId = getOmnipairProgramId();
  const parsed = parseTradeVolumeUsdMicrosFromTx(
    tx,
    omnipairId,
    params.yesMint,
    params.noMint,
  );
  const volumeUsd = Number(parsed.micros) / 1_000_000;
  const v = Number.isFinite(volumeUsd) ? volumeUsd : 0;

  console.info("[predicted][sell-volume-trace]", {
    step: "single_tx_volume_parsed",
    txSignature: params.signature,
    source: parsed.source,
    volumeUsd: v,
  });

  return {
    volumeUsd: v,
    source: parsed.source,
    txMissing: false,
    metaErr: false,
  };
}

/**
 * Swap notional in USD for one confirmed tx (0 when not a countable YES↔NO swap).
 * Fast: single `getParsedTransaction` — use after trades instead of full history scans.
 */
export async function fetchSwapVolumeUsdFromSingleTx(
  connection: Connection,
  params: {
    signature: string;
    yesMint: PublicKey;
    noMint: PublicKey;
  },
): Promise<number> {
  const r = await fetchSingleTxTradeVolumeUsd(connection, params);
  return r.volumeUsd;
}

function classifyTx(
  tx: ParsedTransactionWithMeta,
  omnipairId: PublicKey,
  yesMint: PublicKey,
  noMint: PublicKey,
): { label: string; summary: string } {
  const coreFlags = scanOmnipairCoreInstructionFlags(tx, omnipairId);
  if (liquidityAdjustWithoutSwap(coreFlags)) {
    return classifyLiquidityOnlyActivity(coreFlags);
  }

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
    /** When `PM_AMM`, pass with `collateralMint` (USDC) for correct notionals. */
    marketEngine?: string;
    collateralMint?: PublicKey;
  },
): Promise<OnchainPoolActivityEntry[]> {
  if (params.marketEngine === "PM_AMM" && params.collateralMint) {
    const { fetchPmammMarketOnchainActivity } = await import(
      "@/lib/solana/pmamm-pool-activity"
    );
    return fetchPmammMarketOnchainActivity(connection, {
      marketPda: params.pairAddress,
      collateralMint: params.collateralMint,
      yesMint: params.yesMint,
      noMint: params.noMint,
      limit: params.limit,
    });
  }

  /** Must match deployed program for ix decode; falls back without env. */
  const omnipairId = getOmnipairProgramId();
  const cap = Math.min(Math.max(1, params.limit ?? 24), 100);

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

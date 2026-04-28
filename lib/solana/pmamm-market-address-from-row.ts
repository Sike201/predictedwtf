import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

import { derivePmammMarketPdas } from "@/lib/solana/pmamm-pda";

/** Subset of DB row fields used to locate the on-chain pmAMM Market PDA. */
export type PmammMarketAddressRow = {
  pmamm_market_address?: string | null;
  market_address?: string | null;
  pool_address?: string | null;
  pmamm_market_id?: string | null;
  /**
   * Used to decide whether `pool_address` may be the pmAMM Market PDA.
   * For `GAMM` / Omnipair, `pool_address` is the pair account and must not be used as the pmAMM market.
   */
  market_engine?: string | null;
};

const FIELD_ORDER =
  "pmamm_market_address, market_address, pool_address (only when market_engine is PM_AMM), pmamm_market_id (PDA derivation)";

function trimOrEmpty(s: string | null | undefined): string {
  return s?.trim() ?? "";
}

function tryPublicKey(label: string, raw: string): PublicKey | "invalid" {
  if (!raw) return "invalid";
  try {
    return new PublicKey(raw);
  } catch {
    return "invalid";
  }
}

function missingMessage(): string {
  return `Missing pmAMM market address (checked: ${FIELD_ORDER}).`;
}

function invalidMessage(field: string): string {
  return `Invalid pmAMM market address (field: ${field}; checked: ${FIELD_ORDER}).`;
}

export type GetPmammMarketAddressOk = {
  ok: true;
  marketPda: PublicKey;
  source:
    | "pmamm_market_address"
    | "market_address"
    | "pool_address"
    | "pmamm_market_id";
};

export type GetPmammMarketAddressResult =
  | GetPmammMarketAddressOk
  | { ok: false; reason: string };

/**
 * Derive the pmAMM Market PDA from the on-chain u64 `market_id` (decimal string in DB).
 */
export function resolvePmammMarketPdaForChainTx(
  programId: PublicKey,
  pmammMarketIdDecimal: string,
): PublicKey {
  const raw = trimOrEmpty(pmammMarketIdDecimal);
  if (!raw) {
    throw new Error(missingMessage());
  }
  let bn: BN;
  try {
    bn = new BN(raw, 10);
  } catch {
    throw new Error(
      `Invalid pmAMM market address (field: pmamm_market_id; checked: ${FIELD_ORDER}).`,
    );
  }
  const maxU64 = new BN("18446744073709551615");
  if (bn.isNeg() || bn.gt(maxU64)) {
    throw new Error(
      `Invalid pmAMM market address (field: pmamm_market_id; checked: ${FIELD_ORDER}).`,
    );
  }
  const { marketPda } = derivePmammMarketPdas(bn, programId);
  return marketPda;
}

/**
 * Resolve the pmAMM Market PDA from row fields:
 * 1. `pmamm_market_address` if set and valid
 * 2. else `market_address` if set and valid
 * 3. else `pool_address` only when `market_engine === "PM_AMM"` (Omnipair pair lives in `pool_address` for GAMM — never use that here)
 * 4. else derive from `pmamm_market_id` when set
 */
export function getPmammMarketAddressFromRow(
  row: PmammMarketAddressRow,
  programId: PublicKey,
): GetPmammMarketAddressResult {
  const a = trimOrEmpty(row.pmamm_market_address);
  if (a) {
    const pk = tryPublicKey("pmamm_market_address", a);
    if (pk === "invalid") {
      return { ok: false, reason: invalidMessage("pmamm_market_address") };
    }
    return { ok: true, marketPda: pk, source: "pmamm_market_address" };
  }

  const b = trimOrEmpty(row.market_address);
  if (b) {
    const pk = tryPublicKey("market_address", b);
    if (pk === "invalid") {
      return { ok: false, reason: invalidMessage("market_address") };
    }
    return { ok: true, marketPda: pk, source: "market_address" };
  }

  const engine = trimOrEmpty(row.market_engine);
  const pool = trimOrEmpty(row.pool_address);
  if (pool && engine === "PM_AMM") {
    const pk = tryPublicKey("pool_address", pool);
    if (pk === "invalid") {
      return { ok: false, reason: invalidMessage("pool_address") };
    }
    return { ok: true, marketPda: pk, source: "pool_address" };
  }

  const idRaw = trimOrEmpty(row.pmamm_market_id);
  if (idRaw) {
    try {
      const marketPda = resolvePmammMarketPdaForChainTx(programId, idRaw);
      return { ok: true, marketPda, source: "pmamm_market_id" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, reason: msg };
    }
  }

  return { ok: false, reason: missingMessage() };
}

/** Same resolution as {@link getPmammMarketAddressFromRow} but throws with the same error strings. */
export function getPmammMarketAddress(
  row: PmammMarketAddressRow,
  programId: PublicKey,
): PublicKey {
  const r = getPmammMarketAddressFromRow(row, programId);
  if (!r.ok) throw new Error(r.reason);
  return r.marketPda;
}

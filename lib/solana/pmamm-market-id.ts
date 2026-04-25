import { createHash } from "crypto";
import { BN } from "@coral-xyz/anchor";

/** Deterministic u64 market_id for pmAMM PDA from DB row identity. */
export function pmammMarketIdBnFromSeed(seed: string): BN {
  const h = createHash("sha256").update(seed, "utf8").digest();
  const lo = h.readBigUInt64LE(0);
  const n = lo === 0n ? 1n : lo;
  return new BN(n.toString());
}

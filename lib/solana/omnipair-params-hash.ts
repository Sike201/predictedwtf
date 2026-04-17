import { createHash } from "crypto";

import { OMNIPAIR_PROTOCOL_VERSION } from "@/lib/solana/omnipair-constants";

/**
 * Matches `InitializeAndBootstrap::validate` hash in
 * `programs/omnipair/src/instructions/liquidity/initialize.rs`:
 * SHA256(VERSION || swap_fee_bps || half_life || fixed_cf || … || max_rate_bps)
 * (`initial_rate_bps` is *not* included.)
 */
export type OmnipairParamsHashInput = {
  swapFeeBps: number;
  halfLifeMs: bigint;
  /** Same as `fixed_cf_bps.unwrap_or(0)` in Rust. */
  fixedCfBps: number;
  targetUtilStartBps: bigint;
  targetUtilEndBps: bigint;
  rateHalfLifeMs: bigint;
  minRateBps: bigint;
  maxRateBps: bigint;
};

function u16le(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n & 0xffff, 0);
  return b;
}

function u64le(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n, 0);
  return b;
}

export function computeOmnipairParamsHash(input: OmnipairParamsHashInput): Buffer {
  const chunks = [
    Buffer.from([OMNIPAIR_PROTOCOL_VERSION & 0xff]),
    u16le(input.swapFeeBps),
    u64le(input.halfLifeMs),
    u16le(input.fixedCfBps),
    u64le(input.targetUtilStartBps),
    u64le(input.targetUtilEndBps),
    u64le(input.rateHalfLifeMs),
    u64le(input.minRateBps),
    u64le(input.maxRateBps),
  ];
  return Buffer.from(createHash("sha256").update(Buffer.concat(chunks)).digest());
}

/** Default prediction-market pool tuning (devnet). Must match `serializeInitializeAndBootstrapArgs` None→0 hashing behavior. */
export const DEFAULT_OMNIPAIR_POOL_PARAMS: OmnipairParamsHashInput = {
  swapFeeBps: 30,
  halfLifeMs: 3_600_000n, // 1 hour
  fixedCfBps: 0,
  targetUtilStartBps: 0n,
  targetUtilEndBps: 0n,
  rateHalfLifeMs: 0n,
  minRateBps: 0n,
  maxRateBps: 0n,
};

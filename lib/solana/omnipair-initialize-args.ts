import type { OmnipairParamsHashInput } from "@/lib/solana/omnipair-params-hash";
import { computeOmnipairParamsHash } from "@/lib/solana/omnipair-params-hash";

/**
 * `InitializeAndBootstrapArgs` from omnipair-rs `instructions/liquidity/initialize.rs`
 * (Borsh layout; Anchor `#[derive(AnchorSerialize)]` field order).
 */
export type InitializeAndBootstrapArgs = {
  swapFeeBps: number;
  halfLifeMs: bigint;
  fixedCfBps?: number;
  targetUtilStartBps?: bigint;
  targetUtilEndBps?: bigint;
  rateHalfLifeMs?: bigint;
  minRateBps?: bigint;
  maxRateBps?: bigint;
  initialRateBps?: bigint;
  paramsHash: Buffer;
  version: number;
  amount0In: bigint;
  amount1In: bigint;
  minLiquidityOut: bigint;
  lpName: string;
  lpSymbol: string;
  /** Must start with `http` per on-chain validation. */
  lpUri: string;
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

function borshOptionU16(v: number | undefined): Buffer {
  if (v === undefined) return Buffer.from([0]);
  const o = Buffer.alloc(3);
  o.writeUInt8(1, 0);
  o.writeUInt16LE(v & 0xffff, 1);
  return o;
}

function borshOptionU64(v: bigint | undefined): Buffer {
  if (v === undefined) return Buffer.from([0]);
  const o = Buffer.alloc(9);
  o.writeUInt8(1, 0);
  o.writeBigUInt64LE(v, 1);
  return o;
}

function borshString(s: string): Buffer {
  const utf8 = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(utf8.length, 0);
  return Buffer.concat([len, utf8]);
}

/** Map hash input numerics → optional Borsh fields (`None` ⇔ hashed value 0). */
export function buildInitializeAndBootstrapArgs(params: {
  pool: OmnipairParamsHashInput;
  version: number;
  amount0In: bigint;
  amount1In: bigint;
  minLiquidityOut: bigint;
  lpName: string;
  lpSymbol: string;
  lpUri: string;
  /** Not part of `params_hash`; omit unless customizing IRM start rate. */
  initialRateBps?: bigint;
}): InitializeAndBootstrapArgs {
  const { pool } = params;
  const hash = computeOmnipairParamsHash(pool);
  return {
    swapFeeBps: pool.swapFeeBps,
    halfLifeMs: pool.halfLifeMs,
    fixedCfBps: pool.fixedCfBps !== 0 ? pool.fixedCfBps : undefined,
    targetUtilStartBps:
      pool.targetUtilStartBps !== 0n ? pool.targetUtilStartBps : undefined,
    targetUtilEndBps:
      pool.targetUtilEndBps !== 0n ? pool.targetUtilEndBps : undefined,
    rateHalfLifeMs: pool.rateHalfLifeMs !== 0n ? pool.rateHalfLifeMs : undefined,
    minRateBps: pool.minRateBps !== 0n ? pool.minRateBps : undefined,
    maxRateBps: pool.maxRateBps !== 0n ? pool.maxRateBps : undefined,
    initialRateBps: params.initialRateBps,
    paramsHash: hash,
    version: params.version,
    amount0In: params.amount0In,
    amount1In: params.amount1In,
    minLiquidityOut: params.minLiquidityOut,
    lpName: params.lpName,
    lpSymbol: params.lpSymbol,
    lpUri: params.lpUri,
  };
}

export function serializeInitializeAndBootstrapArgs(
  a: InitializeAndBootstrapArgs,
): Buffer {
  const parts: Buffer[] = [
    u16le(a.swapFeeBps),
    u64le(a.halfLifeMs),
    borshOptionU16(a.fixedCfBps),
    borshOptionU64(a.targetUtilStartBps),
    borshOptionU64(a.targetUtilEndBps),
    borshOptionU64(a.rateHalfLifeMs),
    borshOptionU64(a.minRateBps),
    borshOptionU64(a.maxRateBps),
    borshOptionU64(a.initialRateBps),
    Buffer.from(a.paramsHash.subarray(0, 32)),
    Buffer.from([a.version & 0xff]),
    u64le(a.amount0In),
    u64le(a.amount1In),
    u64le(a.minLiquidityOut),
    borshString(a.lpName),
    borshString(a.lpSymbol),
    borshString(a.lpUri),
  ];
  return Buffer.concat(parts);
}

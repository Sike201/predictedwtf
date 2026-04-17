import { PublicKey } from "@solana/web3.js";

function readPubkey(data: Buffer, o: number): [PublicKey, number] {
  return [new PublicKey(data.subarray(o, o + 32)), o + 32];
}

function readU16LE(data: Buffer, o: number): [number, number] {
  return [data.readUInt16LE(o), o + 2];
}

function readU64LE(data: Buffer, o: number): [bigint, number] {
  return [data.readBigUInt64LE(o), o + 8];
}

function readU128LE(data: Buffer, o: number): [bigint, number] {
  const lo = data.readBigUInt64LE(o);
  const hi = data.readBigUInt64LE(o + 8);
  return [lo | (hi << 64n), o + 16];
}

function readOptionU16(data: Buffer, o: number): [number | null, number] {
  const tag = data.readUInt8(o);
  if (tag === 0) return [null, o + 1];
  const [v, o2] = readU16LE(data, o + 1);
  return [v, o2];
}

function readLastPriceEma(data: Buffer, o: number): [number, number] {
  /** symmetric u64 + directional u64 — only need to skip 16 bytes */
  return [16, o + 16];
}

/** Parsed on-chain `Pair` account (`programs/omnipair/src/state/pair.rs`). */
export type DecodedOmnipairPair = {
  token0: PublicKey;
  token1: PublicKey;
  lpMint: PublicKey;
  rateModel: PublicKey;
  swapFeeBps: number;
  halfLife: bigint;
  reserve0: bigint;
  reserve1: bigint;
  cashReserve0: bigint;
  cashReserve1: bigint;
  /** Lending totals — same layout as omnipair-rs `Pair` after rates (`total_debt*`, `total_debt*_shares`). */
  totalDebt0: bigint;
  totalDebt1: bigint;
  totalDebt0Shares: bigint;
  totalDebt1Shares: bigint;
  token0Decimals: number;
  token1Decimals: number;
};

/**
 * Decode Anchor `Pair` account data (after 8-byte discriminator).
 * Layout must match omnipair-rs borsh serialization order.
 */
export function decodeOmnipairPairAccount(data: Buffer): DecodedOmnipairPair {
  if (data.length < 8 + 32 * 4 + 2) {
    throw new Error("Pair account data too short.");
  }
  let o = 8;
  const [token0, o1] = readPubkey(data, o);
  o = o1;
  const [token1, o2] = readPubkey(data, o);
  o = o2;
  const [lpMint, o3] = readPubkey(data, o);
  o = o3;
  const [rateModel, o4] = readPubkey(data, o);
  o = o4;
  const [swapFeeBps, o5] = readU16LE(data, o);
  o = o5;
  const [halfLife, o6] = readU64LE(data, o);
  o = o6;
  const [fixedCf, o7] = readOptionU16(data, o);
  o = o7;
  void fixedCf;
  const [reserve0, o8] = readU64LE(data, o);
  o = o8;
  const [reserve1, o9] = readU64LE(data, o);
  o = o9;
  const [cashReserve0, o10] = readU64LE(data, o);
  o = o10;
  const [cashReserve1, o11] = readU64LE(data, o);
  o = o11;
  const [, o12] = readLastPriceEma(data, o);
  o = o12;
  const [, o13] = readLastPriceEma(data, o);
  o = o13;
  /* last_update, last_rate0, last_rate1 */
  const [, o14] = readU64LE(data, o);
  o = o14;
  const [, o15] = readU64LE(data, o);
  o = o15;
  const [, o16] = readU64LE(data, o);
  o = o16;
  const [totalDebt0, o17] = readU64LE(data, o);
  o = o17;
  const [totalDebt1, o18] = readU64LE(data, o);
  o = o18;
  const [totalDebt0Shares, o20] = readU128LE(data, o);
  o = o20;
  const [totalDebt1Shares, o21] = readU128LE(data, o);
  o = o21;
  const [, o22] = readU64LE(data, o);
  o = o22;
  const [, o23] = readU64LE(data, o);
  o = o23;
  const [, o24] = readU64LE(data, o);
  o = o24;
  const token0Decimals = data.readUInt8(o);
  o += 1;
  const token1Decimals = data.readUInt8(o);
  o += 1;

  return {
    token0,
    token1,
    lpMint,
    rateModel,
    swapFeeBps,
    halfLife,
    reserve0,
    reserve1,
    cashReserve0,
    cashReserve1,
    totalDebt0,
    totalDebt1,
    totalDebt0Shares,
    totalDebt1Shares,
    token0Decimals,
    token1Decimals,
  };
}

/** `FutarchyAuthority.revenue_share.swap_bps` split of swap fee (`omnipair-rs`). */
export function decodeFutarchySwapShareBps(data: Buffer): number {
  if (data.length < 8 + 1 + 32 + 96 + 2) {
    throw new Error("FutarchyAuthority account data too short.");
  }
  let o = 8;
  o += 1; // version
  o += 32; // authority
  o += 96; // recipients (3 pubkeys)
  const swapShareBps = data.readUInt16LE(o);
  return swapShareBps;
}

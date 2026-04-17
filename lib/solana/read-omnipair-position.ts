/**
 * Live **UserPosition** account read for Omnipair (`programs/omnipair/src/state/user_position.rs`).
 * Does not use Supabase. Debt *amounts* in outcome tokens require Pair totals — use `calculateDebtAtoms` with pair account.
 */
import { Connection, PublicKey } from "@solana/web3.js";

import { getOmnipairProgramId } from "@/lib/solana/omnipair-program";
import {
  deriveOmnipairLayout,
  getUserPositionPDA,
  orderMints,
} from "@/lib/solana/omnipair-pda";
import { DEFAULT_OMNIPAIR_POOL_PARAMS } from "@/lib/solana/omnipair-params-hash";
import { decodeOmnipairPairAccount } from "@/lib/solana/decode-omnipair-accounts";

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

function ceilDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) return 0n;
  return (a + b - 1n) / b;
}

/** Matches `UserPosition::calculate_debt0` when `total_debt0_shares > 0`. */
export function debtAtomsFromShares(
  debtShares: bigint,
  totalDebt: bigint,
  totalDebtShares: bigint,
): bigint {
  if (totalDebtShares === 0n) return 0n;
  const raw = ceilDiv(debtShares * totalDebt, totalDebtShares);
  const max = totalDebt <= (1n << 64n) - 1n ? totalDebt : 0xffffffffffffffffn;
  return raw > max ? max : raw;
}

export type DecodedUserPosition = {
  owner: PublicKey;
  pair: PublicKey;
  collateral0LiquidationCfBps: number;
  collateral1LiquidationCfBps: number;
  collateral0: bigint;
  collateral1: bigint;
  debt0Shares: bigint;
  debt1Shares: bigint;
  bump: number;
};

/** Parse raw account data (includes 8-byte Anchor discriminator). */
export function decodeUserPositionAccount(data: Buffer): DecodedUserPosition {
  if (data.length < 8 + 32 + 32 + 2 + 2 + 8 + 8 + 16 + 16 + 1) {
    throw new Error("UserPosition account data too short.");
  }
  let o = 8;
  const [owner, o1] = readPubkey(data, o);
  o = o1;
  const [pair, o2] = readPubkey(data, o);
  o = o2;
  const [c0cf, o3] = readU16LE(data, o);
  o = o3;
  const [c1cf, o4] = readU16LE(data, o);
  o = o4;
  const [collateral0, o5] = readU64LE(data, o);
  o = o5;
  const [collateral1, o6] = readU64LE(data, o);
  o = o6;
  const [debt0Shares, o7] = readU128LE(data, o);
  o = o7;
  const [debt1Shares, o8] = readU128LE(data, o);
  o = o8;
  const bump = data.readUInt8(o);

  return {
    owner,
    pair,
    collateral0LiquidationCfBps: c0cf,
    collateral1LiquidationCfBps: c1cf,
    collateral0,
    collateral1,
    debt0Shares,
    debt1Shares,
    bump,
  };
}

export type OmnipairPositionSnapshot = {
  userPositionPda: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
  token0Mint: PublicKey;
  token1Mint: PublicKey;
  yesIsToken0: boolean;
  collateralYesAtoms: bigint;
  collateralNoAtoms: bigint;
  debtYesAtoms: bigint;
  debtNoAtoms: bigint;
  collateral0Atoms: bigint;
  collateral1Atoms: bigint;
  debt0Shares: bigint;
  debt1Shares: bigint;
  /** Utilization-style hint — debt / borrow limit requires full pair math; exposed as optional raw shares ratio. */
  raw: DecodedUserPosition;
};

/**
 * Fetch and decode user Omnipair position for a YES/NO market pair.
 */
export async function readOmnipairUserPositionSnapshot(params: {
  connection: Connection;
  programId?: PublicKey;
  pairAddress: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
  owner: PublicKey;
}): Promise<OmnipairPositionSnapshot | null> {
  const programId = params.programId ?? getOmnipairProgramId();
  const [token0Mint, token1Mint] = orderMints(params.yesMint, params.noMint);
  const yesIsToken0 = params.yesMint.equals(token0Mint);

  const [userPda] = getUserPositionPDA(programId, params.pairAddress, params.owner);

  const [posInfo, pairInfo] = await params.connection.getMultipleAccountsInfo(
    [userPda, params.pairAddress],
    "confirmed",
  );
  if (!posInfo?.data) return null;
  if (!pairInfo?.data) {
    throw new Error("Pair account missing for debt calculation.");
  }

  const raw = decodeUserPositionAccount(Buffer.from(posInfo.data));
  const pairDecoded = decodeOmnipairPairAccount(Buffer.from(pairInfo.data));

  const debt0Atoms = debtAtomsFromShares(
    raw.debt0Shares,
    pairDecoded.totalDebt0,
    pairDecoded.totalDebt0Shares,
  );
  const debt1Atoms = debtAtomsFromShares(
    raw.debt1Shares,
    pairDecoded.totalDebt1,
    pairDecoded.totalDebt1Shares,
  );

  const collateralYesAtoms = yesIsToken0 ? raw.collateral0 : raw.collateral1;
  const collateralNoAtoms = yesIsToken0 ? raw.collateral1 : raw.collateral0;
  const debtYesAtoms = yesIsToken0 ? debt0Atoms : debt1Atoms;
  const debtNoAtoms = yesIsToken0 ? debt1Atoms : debt0Atoms;

  return {
    userPositionPda: userPda,
    yesMint: params.yesMint,
    noMint: params.noMint,
    token0Mint,
    token1Mint,
    yesIsToken0,
    collateralYesAtoms,
    collateralNoAtoms,
    debtYesAtoms,
    debtNoAtoms,
    collateral0Atoms: raw.collateral0,
    collateral1Atoms: raw.collateral1,
    debt0Shares: raw.debt0Shares,
    debt1Shares: raw.debt1Shares,
    raw,
  };
}

/** Resolve pair address from mints when only mints are known (same params hash as pool create). */
export function derivePairAddressForMarket(
  programId: PublicKey,
  yesMint: PublicKey,
  noMint: PublicKey,
): PublicKey {
  return deriveOmnipairLayout(programId, yesMint, noMint, DEFAULT_OMNIPAIR_POOL_PARAMS)
    .pairAddress;
}

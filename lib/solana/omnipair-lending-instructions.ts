/**
 * Omnipair lending instructions — account order matches `omnipair-rs` Anchor layouts:
 * - `add_collateral` → `AddCollateral` + `#[event_cpi]`
 * - `borrow` / `repay` → `CommonAdjustDebt` + `#[event_cpi]`
 * - `remove_collateral` → `CommonAdjustCollateral` + `#[event_cpi]`
 */
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { anchorDiscriminator, u64le } from "@/lib/solana/anchor-util";
import { TOKEN_2022_PROGRAM_ID } from "@/lib/solana/omnipair-constants";
import { getEventAuthorityPDA, getGlobalFutarchyAuthorityPDA } from "@/lib/solana/omnipair-pda";

export const OMNIPAIR_U64_MAX = 18446744073709551615n;

const IX_ADD_COLLATERAL = "add_collateral";
const IX_REMOVE_COLLATERAL = "remove_collateral";
const IX_BORROW = "borrow";
const IX_REPAY = "repay";

function lendingEventCpis(programId: PublicKey): {
  eventAuthority: PublicKey;
  program: PublicKey;
} {
  const { publicKey: eventAuthority } = getEventAuthorityPDA(programId);
  return { eventAuthority, program: programId };
}

/** `AdjustCollateralArgs { amount: u64 }` */
export function buildAddCollateralInstruction(params: {
  programId: PublicKey;
  pair: PublicKey;
  rateModel: PublicKey;
  userPosition: PublicKey;
  collateralVault: PublicKey;
  userCollateralAta: PublicKey;
  collateralMint: PublicKey;
  user: PublicKey;
  amount: bigint;
}): TransactionInstruction {
  const [futarchyAuthority] = getGlobalFutarchyAuthorityPDA(params.programId);
  const { eventAuthority, program } = lendingEventCpis(params.programId);

  const data = Buffer.concat([
    anchorDiscriminator(IX_ADD_COLLATERAL),
    u64le(params.amount),
  ]);

  const keys = [
    { pubkey: params.pair, isSigner: false, isWritable: true },
    { pubkey: params.rateModel, isSigner: false, isWritable: true },
    { pubkey: futarchyAuthority, isSigner: false, isWritable: false },
    { pubkey: params.userPosition, isSigner: false, isWritable: true },
    { pubkey: params.collateralVault, isSigner: false, isWritable: true },
    { pubkey: params.userCollateralAta, isSigner: false, isWritable: true },
    { pubkey: params.collateralMint, isSigner: false, isWritable: false },
    { pubkey: params.user, isSigner: true, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: eventAuthority, isSigner: false, isWritable: false },
    { pubkey: program, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({ programId: params.programId, keys, data });
}

/** `CommonAdjustCollateral` — remove_collateral */
export function buildRemoveCollateralInstruction(params: {
  programId: PublicKey;
  pair: PublicKey;
  rateModel: PublicKey;
  userPosition: PublicKey;
  collateralVault: PublicKey;
  userCollateralAta: PublicKey;
  collateralMint: PublicKey;
  user: PublicKey;
  /** Use `OMNIPAIR_U64_MAX` for "withdraw all allowed". */
  amount: bigint;
}): TransactionInstruction {
  const [futarchyAuthority] = getGlobalFutarchyAuthorityPDA(params.programId);
  const { eventAuthority, program } = lendingEventCpis(params.programId);

  const data = Buffer.concat([
    anchorDiscriminator(IX_REMOVE_COLLATERAL),
    u64le(params.amount),
  ]);

  const keys = [
    { pubkey: params.pair, isSigner: false, isWritable: true },
    { pubkey: params.userPosition, isSigner: false, isWritable: true },
    { pubkey: params.rateModel, isSigner: false, isWritable: true },
    { pubkey: futarchyAuthority, isSigner: false, isWritable: false },
    { pubkey: params.collateralVault, isSigner: false, isWritable: true },
    { pubkey: params.userCollateralAta, isSigner: false, isWritable: true },
    { pubkey: params.collateralMint, isSigner: false, isWritable: false },
    { pubkey: params.user, isSigner: true, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: eventAuthority, isSigner: false, isWritable: false },
    { pubkey: program, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({ programId: params.programId, keys, data });
}

/** `CommonAdjustDebt` — borrow */
export function buildBorrowInstruction(params: {
  programId: PublicKey;
  pair: PublicKey;
  rateModel: PublicKey;
  userPosition: PublicKey;
  reserveVault: PublicKey;
  userReserveAta: PublicKey;
  reserveMint: PublicKey;
  user: PublicKey;
  /** Use `OMNIPAIR_U64_MAX` for max remaining borrow limit. */
  amount: bigint;
}): TransactionInstruction {
  const [futarchyAuthority] = getGlobalFutarchyAuthorityPDA(params.programId);
  const { eventAuthority, program } = lendingEventCpis(params.programId);

  const data = Buffer.concat([
    anchorDiscriminator(IX_BORROW),
    u64le(params.amount),
  ]);

  const keys = [
    { pubkey: params.pair, isSigner: false, isWritable: true },
    { pubkey: params.userPosition, isSigner: false, isWritable: true },
    { pubkey: params.rateModel, isSigner: false, isWritable: true },
    { pubkey: futarchyAuthority, isSigner: false, isWritable: false },
    { pubkey: params.reserveVault, isSigner: false, isWritable: true },
    { pubkey: params.userReserveAta, isSigner: false, isWritable: true },
    { pubkey: params.reserveMint, isSigner: false, isWritable: false },
    { pubkey: params.user, isSigner: true, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: eventAuthority, isSigner: false, isWritable: false },
    { pubkey: program, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({ programId: params.programId, keys, data });
}

/** `CommonAdjustDebt` — repay */
export function buildRepayInstruction(params: {
  programId: PublicKey;
  pair: PublicKey;
  rateModel: PublicKey;
  userPosition: PublicKey;
  reserveVault: PublicKey;
  userReserveAta: PublicKey;
  reserveMint: PublicKey;
  user: PublicKey;
  /** Use `OMNIPAIR_U64_MAX` for repay all debt on this mint. */
  amount: bigint;
}): TransactionInstruction {
  const [futarchyAuthority] = getGlobalFutarchyAuthorityPDA(params.programId);
  const { eventAuthority, program } = lendingEventCpis(params.programId);

  const data = Buffer.concat([
    anchorDiscriminator(IX_REPAY),
    u64le(params.amount),
  ]);

  const keys = [
    { pubkey: params.pair, isSigner: false, isWritable: true },
    { pubkey: params.userPosition, isSigner: false, isWritable: true },
    { pubkey: params.rateModel, isSigner: false, isWritable: true },
    { pubkey: futarchyAuthority, isSigner: false, isWritable: false },
    { pubkey: params.reserveVault, isSigner: false, isWritable: true },
    { pubkey: params.userReserveAta, isSigner: false, isWritable: true },
    { pubkey: params.reserveMint, isSigner: false, isWritable: false },
    { pubkey: params.user, isSigner: true, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: eventAuthority, isSigner: false, isWritable: false },
    { pubkey: program, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({ programId: params.programId, keys, data });
}

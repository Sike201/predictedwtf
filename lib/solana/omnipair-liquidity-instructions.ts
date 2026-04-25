/**
 * Omnipair `add_liquidity` / `remove_liquidity` — `AdjustLiquidity` + `#[event_cpi]`
 * (`programs/omnipair/src/instructions/liquidity/common.rs`).
 */
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import { anchorDiscriminator, u64le } from "@/lib/solana/anchor-util";
import { TOKEN_2022_PROGRAM_ID } from "@/lib/solana/omnipair-constants";
import {
  getEventAuthorityPDA,
  getGlobalFutarchyAuthorityPDA,
  getReserveVaultPDA,
} from "@/lib/solana/omnipair-pda";

const IX_ADD = "add_liquidity";
const IX_REMOVE = "remove_liquidity";

function adjustLiquidityEventCpis(programId: PublicKey): {
  eventAuthority: PublicKey;
  program: PublicKey;
} {
  const { publicKey: eventAuthority } = getEventAuthorityPDA(programId);
  return { eventAuthority, program: programId };
}

export function buildOmnipairAddLiquidityInstruction(params: {
  programId: PublicKey;
  pair: PublicKey;
  rateModel: PublicKey;
  token0Mint: PublicKey;
  token1Mint: PublicKey;
  userToken0: PublicKey;
  userToken1: PublicKey;
  userLp: PublicKey;
  lpMint: PublicKey;
  user: PublicKey;
  amount0In: bigint;
  amount1In: bigint;
  minLiquidityOut: bigint;
}): TransactionInstruction {
  const [futarchyAuthority] = getGlobalFutarchyAuthorityPDA(params.programId);
  const { eventAuthority, program } = adjustLiquidityEventCpis(params.programId);

  const [reserve0Vault] = getReserveVaultPDA(
    params.programId,
    params.pair,
    params.token0Mint,
  );
  const [reserve1Vault] = getReserveVaultPDA(
    params.programId,
    params.pair,
    params.token1Mint,
  );

  const data = Buffer.concat([
    anchorDiscriminator(IX_ADD),
    u64le(params.amount0In),
    u64le(params.amount1In),
    u64le(params.minLiquidityOut),
  ]);

  const keys = [
    { pubkey: params.pair, isSigner: false, isWritable: true },
    { pubkey: params.rateModel, isSigner: false, isWritable: true },
    { pubkey: futarchyAuthority, isSigner: false, isWritable: false },
    { pubkey: reserve0Vault, isSigner: false, isWritable: true },
    { pubkey: reserve1Vault, isSigner: false, isWritable: true },
    { pubkey: params.userToken0, isSigner: false, isWritable: true },
    { pubkey: params.userToken1, isSigner: false, isWritable: true },
    { pubkey: params.token0Mint, isSigner: false, isWritable: false },
    { pubkey: params.token1Mint, isSigner: false, isWritable: false },
    { pubkey: params.lpMint, isSigner: false, isWritable: true },
    { pubkey: params.userLp, isSigner: false, isWritable: true },
    { pubkey: params.user, isSigner: true, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: eventAuthority, isSigner: false, isWritable: false },
    { pubkey: program, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({ programId: params.programId, keys, data });
}

export function buildOmnipairRemoveLiquidityInstruction(params: {
  programId: PublicKey;
  pair: PublicKey;
  rateModel: PublicKey;
  token0Mint: PublicKey;
  token1Mint: PublicKey;
  userToken0: PublicKey;
  userToken1: PublicKey;
  userLp: PublicKey;
  lpMint: PublicKey;
  user: PublicKey;
  liquidityIn: bigint;
  minAmount0Out: bigint;
  minAmount1Out: bigint;
}): TransactionInstruction {
  const [futarchyAuthority] = getGlobalFutarchyAuthorityPDA(params.programId);
  const { eventAuthority, program } = adjustLiquidityEventCpis(params.programId);

  const [reserve0Vault] = getReserveVaultPDA(
    params.programId,
    params.pair,
    params.token0Mint,
  );
  const [reserve1Vault] = getReserveVaultPDA(
    params.programId,
    params.pair,
    params.token1Mint,
  );

  const data = Buffer.concat([
    anchorDiscriminator(IX_REMOVE),
    u64le(params.liquidityIn),
    u64le(params.minAmount0Out),
    u64le(params.minAmount1Out),
  ]);

  const keys = [
    { pubkey: params.pair, isSigner: false, isWritable: true },
    { pubkey: params.rateModel, isSigner: false, isWritable: true },
    { pubkey: futarchyAuthority, isSigner: false, isWritable: false },
    { pubkey: reserve0Vault, isSigner: false, isWritable: true },
    { pubkey: reserve1Vault, isSigner: false, isWritable: true },
    { pubkey: params.userToken0, isSigner: false, isWritable: true },
    { pubkey: params.userToken1, isSigner: false, isWritable: true },
    { pubkey: params.token0Mint, isSigner: false, isWritable: false },
    { pubkey: params.token1Mint, isSigner: false, isWritable: false },
    { pubkey: params.lpMint, isSigner: false, isWritable: true },
    { pubkey: params.userLp, isSigner: false, isWritable: true },
    { pubkey: params.user, isSigner: true, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: eventAuthority, isSigner: false, isWritable: false },
    { pubkey: program, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({ programId: params.programId, keys, data });
}

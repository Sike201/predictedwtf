import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { anchorDiscriminator, u64le } from "@/lib/solana/anchor-util";
import { TOKEN_2022_PROGRAM_ID } from "@/lib/solana/omnipair-constants";
import {
  getEventAuthorityPDA,
  getGlobalFutarchyAuthorityPDA,
  getReserveVaultPDA,
} from "@/lib/solana/omnipair-pda";

const SWAP_IX = "swap";

export type OmnipairSwapInstructionParams = {
  programId: PublicKey;
  pair: PublicKey;
  rateModel: PublicKey;
  tokenInMint: PublicKey;
  tokenOutMint: PublicKey;
  user: PublicKey;
  userTokenIn: PublicKey;
  userTokenOut: PublicKey;
  amountIn: bigint;
  minAmountOut: bigint;
};

/**
 * Build Omnipair `swap` instruction (`programs/omnipair/src/instructions/spot/swap.rs`).
 * Account order: `Swap` accounts + `#[event_cpi]` (`event_authority`, `program`).
 */
export function buildOmnipairSwapInstruction(
  p: OmnipairSwapInstructionParams,
): TransactionInstruction {
  const [futarchyAuthority] = getGlobalFutarchyAuthorityPDA(p.programId);
  const { publicKey: eventAuthority } = getEventAuthorityPDA(p.programId);

  const [tokenInVault] = getReserveVaultPDA(
    p.programId,
    p.pair,
    p.tokenInMint,
  );
  const [tokenOutVault] = getReserveVaultPDA(
    p.programId,
    p.pair,
    p.tokenOutMint,
  );

  const data = Buffer.concat([
    anchorDiscriminator(SWAP_IX),
    u64le(p.amountIn),
    u64le(p.minAmountOut),
  ]);

  const keys = [
    { pubkey: p.pair, isSigner: false, isWritable: true },
    { pubkey: p.rateModel, isSigner: false, isWritable: true },
    { pubkey: futarchyAuthority, isSigner: false, isWritable: false },
    { pubkey: tokenInVault, isSigner: false, isWritable: true },
    { pubkey: tokenOutVault, isSigner: false, isWritable: true },
    { pubkey: p.userTokenIn, isSigner: false, isWritable: true },
    { pubkey: p.userTokenOut, isSigner: false, isWritable: true },
    { pubkey: p.tokenInMint, isSigner: false, isWritable: false },
    { pubkey: p.tokenOutMint, isSigner: false, isWritable: false },
    { pubkey: p.user, isSigner: true, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: eventAuthority, isSigner: false, isWritable: false },
    { pubkey: p.programId, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    programId: p.programId,
    keys,
    data,
  });
}

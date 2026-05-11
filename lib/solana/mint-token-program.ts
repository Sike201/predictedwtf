import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import type { Commitment, Connection, PublicKey } from "@solana/web3.js";

export type ResolvedMintTokenProgram = {
  tokenProgramId: PublicKey;
  /** On-chain owner of the mint account (Token or Token-2022 program). */
  mintOwner: PublicKey;
};

/**
 * Single RPC read: mint account owner → SPL Token vs Token-2022 program for ATA / mint instructions.
 */
export async function resolveMintTokenProgram(
  connection: Connection,
  mint: PublicKey,
  commitment: Commitment = "confirmed",
): Promise<ResolvedMintTokenProgram> {
  const info = await connection.getAccountInfo(mint, commitment);
  if (!info) {
    throw new Error("SparkUSD mint not found");
  }
  const mintOwner = info.owner;
  if (mintOwner.equals(TOKEN_PROGRAM_ID)) {
    return { tokenProgramId: TOKEN_PROGRAM_ID, mintOwner };
  }
  if (mintOwner.equals(TOKEN_2022_PROGRAM_ID)) {
    return { tokenProgramId: TOKEN_2022_PROGRAM_ID, mintOwner };
  }
  throw new Error(`Unexpected mint owner ${mintOwner.toBase58()}`);
}

/** @returns `TOKEN_PROGRAM_ID` or `TOKEN_2022_PROGRAM_ID` from on-chain mint owner. */
export async function getTokenProgramForMint(
  connection: Connection,
  mint: PublicKey,
  commitment?: Commitment,
): Promise<PublicKey> {
  const { tokenProgramId } = await resolveMintTokenProgram(
    connection,
    mint,
    commitment,
  );
  return tokenProgramId;
}

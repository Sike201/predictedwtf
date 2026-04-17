import {
  Connection,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import { TOKEN_2022_PROGRAM_ID } from "@/lib/solana/omnipair-constants";

/** `NAD` from `omnipair-rs` `constants.rs`. */
export const OMNIPAIR_NAD = 1_000_000_000n;

export async function resolveSplTokenProgramForMint(
  connection: Connection,
  mint: PublicKey,
): Promise<PublicKey> {
  const info = await connection.getAccountInfo(mint, "confirmed");
  if (!info) throw new Error("Outcome mint account not found.");
  return info.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;
}

export function getAssociatedTokenAddressForMint(
  mint: PublicKey,
  owner: PublicKey,
  programId: PublicKey,
): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, false, programId);
}

export function ataIdempotentIx(
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  tokenProgramId: PublicKey,
): TransactionInstruction {
  const ata = getAssociatedTokenAddressForMint(mint, owner, tokenProgramId);
  return createAssociatedTokenAccountIdempotentInstruction(
    payer,
    ata,
    owner,
    mint,
    tokenProgramId,
  );
}

/** SPL token account amount (offset 64). */
export function readSplTokenAccountAmount(data: Buffer): bigint {
  if (data.length < 72) return 0n;
  return data.readBigUInt64LE(64);
}

export function parseSimulatedTokenAmount(
  encoded: string[] | undefined,
): bigint | null {
  if (!encoded?.length) return null;
  const buf = Buffer.from(encoded[0]!, "base64");
  return readSplTokenAccountAmount(buf);
}

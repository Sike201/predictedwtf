import {
  Keypair,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type Connection,
} from "@solana/web3.js";
import { MINT_SIZE, TOKEN_PROGRAM_ID } from "@solana/spl-token";

export type OmnipairPreInitAccountsParams = {
  connection: Connection;
  payer: Keypair;
  /** LP mint keypair — same keypair must sign Omnipair init (mint already created here). */
  lpMintKp: Keypair;
  createTreasuryWsolAtaIx: TransactionInstruction | null;
};

/**
 * Transaction 1 — prerequisite accounts before Omnipair `initialize`:
 * optional team treasury WSOL ATA, then `SystemProgram.createAccount` for the LP mint.
 */
export async function buildOmnipairPreInitializeTransaction(
  params: OmnipairPreInitAccountsParams,
): Promise<Transaction> {
  const { connection, payer, lpMintKp, createTreasuryWsolAtaIx } = params;
  const mintRent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);

  const createLpMintIx = SystemProgram.createAccount({
    fromPubkey: payer.publicKey,
    newAccountPubkey: lpMintKp.publicKey,
    lamports: mintRent,
    space: MINT_SIZE,
    programId: TOKEN_PROGRAM_ID,
  });

  const tx = new Transaction();
  if (createTreasuryWsolAtaIx) {
    tx.add(createTreasuryWsolAtaIx);
  }
  tx.add(createLpMintIx);
  return tx;
}

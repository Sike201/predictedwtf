import type { Commitment } from "@solana/web3.js";
import {
  Connection,
  Keypair,
  Transaction,
  VersionedTransaction,
  type SendOptions,
} from "@solana/web3.js";

export type WalletSignTransaction = (
  tx: Transaction | VersionedTransaction,
) => Promise<Transaction | VersionedTransaction>;

type SendSignedTxArgs = {
  connection: Connection;
  transaction: Transaction | VersionedTransaction;
  signTransaction: WalletSignTransaction;
  sendOptions?: SendOptions;
};

/**
 * Sign with the connected wallet, broadcast, and confirm.
 */
export async function sendSignedTransaction({
  connection,
  transaction,
  signTransaction,
  sendOptions,
}: SendSignedTxArgs): Promise<string> {
  const signed = await signTransaction(transaction);
  const raw = signed.serialize();

  const sig = await connection.sendRawTransaction(raw, {
    skipPreflight: false,
    ...sendOptions,
  });

  const latest = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction(
    {
      signature: sig,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    "confirmed",
  );
  return sig;
}

/**
 * Send a legacy `Transaction` signed by local `Keypair`s (server authority).
 */
export async function sendAndConfirmTransactionWithSigners(
  connection: Connection,
  transaction: Transaction,
  signers: Keypair[],
  commitment: Commitment = "confirmed",
): Promise<string> {
  if (signers.length === 0) {
    throw new Error("sendAndConfirmTransactionWithSigners: missing signers");
  }
  transaction.feePayer = signers[0].publicKey;
  const latest = await connection.getLatestBlockhash(commitment);
  transaction.recentBlockhash = latest.blockhash;
  transaction.sign(...signers);
  const sig = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
  });
  await connection.confirmTransaction(
    {
      signature: sig,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    commitment,
  );
  return sig;
}

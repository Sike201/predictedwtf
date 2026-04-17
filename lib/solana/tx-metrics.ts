import { Transaction, type Connection, type PublicKey } from "@solana/web3.js";

/** Best-effort size / ix count (legacy transactions). Prefer after recent blockhash is set. */
export function logLegacyTransactionMetrics(tag: string, tx: Transaction): void {
  let bytes = 0;
  try {
    bytes = tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }).length;
  } catch {
    bytes = 0;
  }
  console.info(
    `[predicted][tx-metrics] ${tag} instructions=${tx.instructions.length} serializedBytes≈${bytes} (limit 1232)`,
  );
}

/**
 * Set fee payer + blockhash so `serialize` reflects realistic size, then log.
 * `sendAndConfirmTransactionWithSigners` will refresh blockhash again before send.
 */
export async function logLegacyTransactionMetricsBeforeSend(
  tag: string,
  connection: Connection,
  tx: Transaction,
  feePayer: PublicKey,
): Promise<void> {
  const latest = await connection.getLatestBlockhash("confirmed");
  tx.feePayer = feePayer;
  tx.recentBlockhash = latest.blockhash;
  logLegacyTransactionMetrics(tag, tx);
}

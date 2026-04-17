import { Connection } from "@solana/web3.js";

import { applyHttpPollingConfirmTransaction } from "@/lib/solana/confirm-transaction-http";
import { getSolanaRpcUrl } from "@/lib/solana/rpc-url";
import { tryLogSerializedTransaction } from "@/lib/solana/trace-transaction-programs";

export { getSolanaRpcUrl, solanaRpcEndpoint } from "@/lib/solana/rpc-url";

let _connection: Connection | null = null;

/** Server / shared Connection (confirmed). Recreated if env differs in tests only. */
export function getConnection(): Connection {
  if (!_connection) {
    _connection = new Connection(getSolanaRpcUrl(), "confirmed");
    /** Avoid RPC WebSocket `signatureSubscribe` (breaks under Next/webpack when `bufferutil`/`ws` mask is broken). */
    applyHttpPollingConfirmTransaction(_connection);
    const sendRaw = _connection.sendRawTransaction.bind(_connection);
    _connection.sendRawTransaction = async (rawTransaction, options) => {
      tryLogSerializedTransaction(
        rawTransaction as Buffer | Uint8Array,
        "Connection.sendRawTransaction",
      );
      return sendRaw(rawTransaction, options);
    };
  }
  return _connection;
}

/** @deprecated Use `getConnection()` — lazy singleton */
export const connection = getConnection();

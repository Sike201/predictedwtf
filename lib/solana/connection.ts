import { Connection } from "@solana/web3.js";

import { applyHttpPollingConfirmTransaction } from "@/lib/solana/confirm-transaction-http";
import { wrapSolanaConnection } from "@/lib/solana/connection-resilient";
import { getSolanaRpcUrl } from "@/lib/solana/rpc-url";
import { tryLogSerializedTransaction } from "@/lib/solana/trace-transaction-programs";

export { getSolanaRpcUrl, solanaRpcEndpoint } from "@/lib/solana/rpc-url";

let _connection: Connection | null = null;

/** Server / shared Connection (confirmed). Recreated if env differs in tests only. */
export function getConnection(): Connection {
  if (!_connection) {
    const url = getSolanaRpcUrl();
    const inner = new Connection(url, "confirmed");
    /** Avoid RPC WebSocket `signatureSubscribe` (breaks under Next/webpack when `bufferutil`/`ws` mask is broken). */
    applyHttpPollingConfirmTransaction(inner);
    const sendRaw = inner.sendRawTransaction.bind(inner);
    inner.sendRawTransaction = async (rawTransaction, options) => {
      tryLogSerializedTransaction(
        rawTransaction as Buffer | Uint8Array,
        "Connection.sendRawTransaction",
      );
      return sendRaw(rawTransaction, options);
    };
    _connection = wrapSolanaConnection(inner, { rpcUrl: url });
  }
  return _connection;
}

/** @deprecated Use `getConnection()` — lazy singleton */
export const connection = getConnection();

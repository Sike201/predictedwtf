import type { PredictedCluster } from "./types.js";

const EXPLORER_BASE = "https://explorer.solana.com";

export function solanaTransactionExplorerUrl(
  signature: string,
  cluster: PredictedCluster,
): string {
  if (cluster === "mainnet-beta") {
    return `${EXPLORER_BASE}/tx/${encodeURIComponent(signature)}`;
  }
  return `${EXPLORER_BASE}/tx/${encodeURIComponent(signature)}?cluster=${cluster}`;
}

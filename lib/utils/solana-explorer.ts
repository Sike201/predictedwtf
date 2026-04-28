/** Cluster query value for explorer.solana.com */
function explorerClusterParam(): string {
  const n = process.env.NEXT_PUBLIC_NETWORK?.trim().toLowerCase();
  if (n === "mainnet" || n === "mainnet-beta") return "mainnet-beta";
  if (n === "testnet") return "testnet";
  return "devnet";
}

/** Solana Explorer link for an address — follows `NEXT_PUBLIC_NETWORK`. */
export function accountExplorerUrl(address: string): string {
  return `https://explorer.solana.com/address/${encodeURIComponent(address)}?cluster=${explorerClusterParam()}`;
}

/** Solana Explorer link for a transaction signature — follows `NEXT_PUBLIC_NETWORK`. */
export function transactionExplorerUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=${explorerClusterParam()}`;
}

/** Solana Explorer (devnet) link for a transaction signature. */
export function devnetTxExplorerUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=devnet`;
}

/** Solana Explorer (devnet) link for an address (account / program). */
export function devnetAccountExplorerUrl(address: string): string {
  return `https://explorer.solana.com/address/${encodeURIComponent(address)}?cluster=devnet`;
}

/** Short display, e.g. `AbCd…XyZz` */
export function shortenTransactionSignature(signature: string, head = 4, tail = 4): string {
  if (signature.length <= head + tail + 1) return signature;
  return `${signature.slice(0, head)}…${signature.slice(-tail)}`;
}

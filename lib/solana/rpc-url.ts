/**
 * JSON-RPC HTTP URL only — no `@solana/web3.js` import (avoids heavy / flaky webpack vendor chunks
 * for layout + wallet UI). Does not use `Connection` or `lib/solana/connection.ts`.
 *
 * Set `NEXT_PUBLIC_SOLANA_RPC_URL` to your own RPC (Helius, QuickNode, etc.) to avoid public
 * endpoint rate limits. Falls back to devnet/mainnet/testnet defaults from `NEXT_PUBLIC_NETWORK`.
 */
const DEFAULT_DEVNET = "https://api.devnet.solana.com";
const DEFAULT_MAINNET = "https://api.mainnet-beta.solana.com";
const DEFAULT_TESTNET = "https://api.testnet.solana.com";

export function getSolanaRpcUrl(): string {
  const custom = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim();
  if (custom) return custom;
  const n = process.env.NEXT_PUBLIC_NETWORK?.trim().toLowerCase();
  if (n === "mainnet" || n === "mainnet-beta") return DEFAULT_MAINNET;
  if (n === "testnet") return DEFAULT_TESTNET;
  return DEFAULT_DEVNET;
}

export const solanaRpcEndpoint = getSolanaRpcUrl();

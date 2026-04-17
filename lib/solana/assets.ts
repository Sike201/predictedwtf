import { PublicKey } from "@solana/web3.js";

/**
 * Devnet SPL token commonly used as USDC stand-in (6 decimals).
 * https://spl-token-faucet.com — same mint referenced in Solana cookbook examples.
 */
export const DEVNET_USDC_MINT = new PublicKey(
  "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr",
);

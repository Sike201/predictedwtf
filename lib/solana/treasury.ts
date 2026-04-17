import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";

/**
 * Hot wallet used only by the server to mint outcomes, initialize pools, and seed demo liquidity.
 * Set `MARKET_ENGINE_AUTHORITY_SECRET` — JSON array of 64 bytes or base58-encoded secret key.
 */
export function loadMarketEngineAuthority(): Keypair | null {
  const raw = process.env.MARKET_ENGINE_AUTHORITY_SECRET?.trim();
  if (!raw) return null;
  try {
    if (raw.startsWith("[")) {
      const arr = JSON.parse(raw) as number[];
      return Keypair.fromSecretKey(Uint8Array.from(arr));
    }
    return Keypair.fromSecretKey(bs58.decode(raw));
  } catch {
    return null;
  }
}

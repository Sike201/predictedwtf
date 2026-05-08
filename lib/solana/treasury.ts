import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";

import { TRUSTED_RESOLVER_ADDRESS } from "@/lib/market/trusted-resolver";

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

export function deriveTrustedResolverSecretPublicKey(): string | null {
  const raw = process.env.TRUSTED_RESOLVER_SECRET?.trim();
  if (!raw) return null;
  try {
    const kp = raw.startsWith("[")
      ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw) as number[]))
      : Keypair.fromSecretKey(bs58.decode(raw));
    return kp.publicKey.toBase58();
  } catch {
    if (process.env.NODE_ENV === "development") {
      throw new Error(
        "TRUSTED_RESOLVER_SECRET could not be parsed (expect JSON [..] byte array or base58 secret).",
      );
    }
    return null;
  }
}

/**
 * Optional hot wallet matching `TRUSTED_RESOLVER_ADDRESS` for server-signed `resolve_market`.
 * JSON array of 64 bytes or base58-encoded secret key.
 *
 * In development, if the secret-derived pubkey does not equal `TRUSTED_RESOLVER_ADDRESS`, throws.
 * In production, logs and returns null on mismatch so a wrong signer is never used silently.
 */
export function loadTrustedResolverSigner(): Keypair | null {
  const raw = process.env.TRUSTED_RESOLVER_SECRET?.trim();
  if (!raw) return null;

  const envAddressRaw =
    process.env.TRUSTED_RESOLVER_ADDRESS?.trim() ||
    process.env.NEXT_PUBLIC_TRUSTED_RESOLVER_ADDRESS?.trim() ||
    "";

  let kp: Keypair;
  try {
    if (raw.startsWith("[")) {
      const arr = JSON.parse(raw) as number[];
      kp = Keypair.fromSecretKey(Uint8Array.from(arr));
    } else {
      kp = Keypair.fromSecretKey(bs58.decode(raw));
    }
  } catch {
    if (process.env.NODE_ENV === "development") {
      throw new Error(
        "TRUSTED_RESOLVER_SECRET could not be parsed (expect JSON [..] byte array or base58 secret).",
      );
    }
    console.error(
      "[predicted][treasury] TRUSTED_RESOLVER_SECRET parse failed — omitting trusted resolver signer",
    );
    return null;
  }

  const derivedPk = kp.publicKey.toBase58();
  const compareTo = envAddressRaw || TRUSTED_RESOLVER_ADDRESS;

  if (process.env.NODE_ENV === "development") {
    console.info("[predicted][treasury] trusted_resolver_env_check", {
      TRUSTED_RESOLVER_ADDRESS_from_env: envAddressRaw || null,
      TRUSTED_RESOLVER_ADDRESS_resolved: compareTo,
      TRUSTED_RESOLVER_SECRET_pubkey: derivedPk,
      match: derivedPk === compareTo,
    });
  }

  if (derivedPk !== compareTo) {
    const msg = `TRUSTED_RESOLVER_SECRET pubkey (${derivedPk}) does not match TRUSTED_RESOLVER_ADDRESS (${compareTo}).`;
    if (process.env.NODE_ENV === "development") {
      throw new Error(msg);
    }
    console.error(`[predicted][treasury] ${msg}`);
    return null;
  }

  return kp;
}

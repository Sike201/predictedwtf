import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";

import { TRUSTED_RESOLVER_ADDRESS } from "@/lib/market/trusted-resolver";

function parseKeypairSecret(raw: string): Keypair {
  if (raw.startsWith("[")) {
    const arr = JSON.parse(raw) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  }
  return Keypair.fromSecretKey(bs58.decode(raw));
}

/** `NODE_ENV === "production"` disables trusted-resolver fallback for market-style authority. */
function isProductionNodeEnv(): boolean {
  return process.env.NODE_ENV === "production";
}

export type EffectiveMarketAuthoritySource = "market_engine" | "trusted_resolver";

/**
 * Effective server signer for market-engine-style operations (init, custody, faucet when unset).
 *
 * Priority:
 * 1. `MARKET_ENGINE_AUTHORITY_SECRET` (when present and parses)
 * 2. `TRUSTED_RESOLVER_SECRET` — only when **not** in production (local dev, tests, `tsx` scripts).
 *
 * In production, only a valid market engine secret is returned; trusted resolver is never used here.
 */
export function loadEffectiveMarketAuthoritySigner(): {
  signer: Keypair;
  source: EffectiveMarketAuthoritySource;
} | null {
  const raw = process.env.MARKET_ENGINE_AUTHORITY_SECRET?.trim();
  if (raw) {
    try {
      return {
        signer: parseKeypairSecret(raw),
        source: "market_engine",
      };
    } catch {
      if (isProductionNodeEnv()) {
        return null;
      }
      console.warn(
        "[predicted][authority-fallback] MARKET_ENGINE_AUTHORITY_SECRET could not be parsed; trying TRUSTED_RESOLVER_SECRET.",
      );
    }
  }

  if (isProductionNodeEnv()) {
    return null;
  }

  const trusted = loadTrustedResolverSigner();
  if (!trusted) return null;
  return { signer: trusted, source: "trusted_resolver" };
}

/**
 * Hot wallet for server-side engine operations (mint outcomes, pool init, demo seed, etc.).
 *
 * - **Production:** `MARKET_ENGINE_AUTHORITY_SECRET` only.
 * - **Non-production:** {@link loadEffectiveMarketAuthoritySigner} (market engine, else trusted resolver).
 */
export function loadMarketEngineAuthority(): Keypair | null {
  if (isProductionNodeEnv()) {
    const raw = process.env.MARKET_ENGINE_AUTHORITY_SECRET?.trim();
    if (!raw) return null;
    try {
      return parseKeypairSecret(raw);
    } catch {
      return null;
    }
  }
  return loadEffectiveMarketAuthoritySigner()?.signer ?? null;
}

/**
 * SparkUSD faucet / mint signing: optional `SPARK_USD_MINT_AUTHORITY_SECRET`, else {@link loadEffectiveMarketAuthoritySigner}.
 * In production, falls back only to market engine secret (not trusted resolver).
 */
export function loadSparkUsdMintAuthority(): Keypair | null {
  const mintRaw = process.env.SPARK_USD_MINT_AUTHORITY_SECRET?.trim();
  if (mintRaw) {
    try {
      return parseKeypairSecret(mintRaw);
    } catch {
      return null;
    }
  }
  if (isProductionNodeEnv()) {
    const raw = process.env.MARKET_ENGINE_AUTHORITY_SECRET?.trim();
    if (!raw) return null;
    try {
      return parseKeypairSecret(raw);
    } catch {
      return null;
    }
  }
  return loadEffectiveMarketAuthoritySigner()?.signer ?? null;
}

export function deriveTrustedResolverSecretPublicKey(): string | null {
  const raw = process.env.TRUSTED_RESOLVER_SECRET?.trim();
  if (!raw) return null;
  try {
    return parseKeypairSecret(raw).publicKey.toBase58();
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
    kp = parseKeypairSecret(raw);
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

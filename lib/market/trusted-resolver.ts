import { PublicKey } from "@solana/web3.js";

/**
 * Client-facing trusted resolver base58 (UI, mocks, optional GAMM server paths).
 * May fall back to `NEXT_PUBLIC_TRUSTED_RESOLVER_ADDRESS` or a dev default.
 *
 * **pmAMM market creation on the server must not use this constant** — use
 * `getServerTrustedResolverAddressStrict()` so `initialize_market` never picks up a
 * public-env or bundled fallback instead of `process.env.TRUSTED_RESOLVER_ADDRESS`.
 */
export const TRUSTED_RESOLVER_ADDRESS =
  (typeof process !== "undefined" && process.env.TRUSTED_RESOLVER_ADDRESS?.trim()) ||
  (typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_TRUSTED_RESOLVER_ADDRESS?.trim()) ||
  "AayL4RVTNeqTRi4YaAWcMmv6pfx4ctNLwYUVyCEfgt7s";

/**
 * Server-only resolver for pmAMM `initialize_market` and other privileged flows.
 * Uses `process.env.TRUSTED_RESOLVER_ADDRESS` only — no NEXT_PUBLIC_*, no hardcoded fallback,
 * no authority/wallet substitution.
 */
export function getServerTrustedResolverAddressStrict(): PublicKey {
  const raw = process.env.TRUSTED_RESOLVER_ADDRESS?.trim();
  if (!raw) {
    throw new Error(
      "TRUSTED_RESOLVER_ADDRESS is required (set in .env.local for Next dev). Do not use NEXT_PUBLIC_TRUSTED_RESOLVER_ADDRESS for server pmAMM create.",
    );
  }
  try {
    return new PublicKey(raw);
  } catch {
    throw new Error(
      `TRUSTED_RESOLVER_ADDRESS is not a valid Solana public key: ${raw}`,
    );
  }
}

export function isTrustedResolverWallet(address: string | undefined | null): boolean {
  const a = address?.trim();
  if (!a) return false;
  return a === TRUSTED_RESOLVER_ADDRESS;
}

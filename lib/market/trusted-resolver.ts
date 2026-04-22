/**
 * Single trusted resolver (MVP) — on-chain + DB resolution is gated to this base58 key.
 * Override in env for staging if needed.
 */
export const TRUSTED_RESOLVER_ADDRESS =
  (typeof process !== "undefined" && process.env.TRUSTED_RESOLVER_ADDRESS?.trim()) ||
  (typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_TRUSTED_RESOLVER_ADDRESS?.trim()) ||
  "2PUXQwMJrYV9B1mwqMUCFZ5qTEDeq7saHcNCeRiHsgot";

export function isTrustedResolverWallet(address: string | undefined | null): boolean {
  const a = address?.trim();
  if (!a) return false;
  return a === TRUSTED_RESOLVER_ADDRESS;
}

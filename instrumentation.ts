/**
 * Next.js server startup — logs resolver env at boot (public keys only, no secrets).
 * Next loads `.env.local` before this runs (see https://nextjs.org/docs/app/building-your-application/configuring/environment-variables).
 */
import { assertSparkUsdDevBoot } from "@/lib/config/spark-usd-boot";
import { deriveTrustedResolverSecretPublicKey } from "@/lib/solana/treasury";

export async function register(): Promise<void> {
  try {
    await assertSparkUsdDevBoot();
  } catch (e) {
    if (process.env.NODE_ENV === "development") {
      console.error("[predicted][spark-usd-boot] validation failed:", e);
      throw e;
    }
    console.error("[predicted][spark-usd-boot] validation skipped or failed:", e);
  }

  const trustedResolverSecretPubkey = deriveTrustedResolverSecretPublicKey();
  const trustedResolverAddress = process.env.TRUSTED_RESOLVER_ADDRESS?.trim();
  const trustedResolverSecretMatches =
    trustedResolverSecretPubkey != null &&
    trustedResolverAddress != null &&
    trustedResolverSecretPubkey === trustedResolverAddress;

  console.log("[predicted][server-startup-env]", {
    TRUSTED_RESOLVER_ADDRESS: trustedResolverAddress,
    NEXT_PUBLIC_TRUSTED_RESOLVER_ADDRESS:
      process.env.NEXT_PUBLIC_TRUSTED_RESOLVER_ADDRESS,
    TRUSTED_RESOLVER_SECRET_pubkey: trustedResolverSecretPubkey,
    TRUSTED_RESOLVER_SECRET_matches_TRUSTED_RESOLVER_ADDRESS:
      trustedResolverSecretMatches,
  });

  if (process.env.NODE_ENV !== "development") return;

  if (
    trustedResolverSecretPubkey != null &&
    trustedResolverAddress != null &&
    trustedResolverSecretPubkey !== trustedResolverAddress
  ) {
    throw new Error(
      `TRUSTED_RESOLVER_SECRET pubkey (${trustedResolverSecretPubkey}) does not match TRUSTED_RESOLVER_ADDRESS (${trustedResolverAddress}).`,
    );
  }

  const t = process.env.TRUSTED_RESOLVER_ADDRESS;
  const np = process.env.NEXT_PUBLIC_TRUSTED_RESOLVER_ADDRESS;

  console.info(
    `[predicted][dev-env] TRUSTED_RESOLVER_ADDRESS=${t != null && t.trim() !== "" ? t.trim() : "<unset>"}`,
  );
  console.info(
    `[predicted][dev-env] NEXT_PUBLIC_TRUSTED_RESOLVER_ADDRESS=${np != null && np.trim() !== "" ? np.trim() : "<unset>"}`,
  );
}

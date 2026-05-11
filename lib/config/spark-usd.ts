import { PublicKey } from "@solana/web3.js";

/**
 * Legacy devnet USDC mint previously used as pmAMM/GAMM collateral in this app.
 * On-chain markets created with this mint still hold this token in vaults — label as "Legacy USDC" in UI.
 */
export const LEGACY_DEVNET_USDC_COLLATERAL_MINT =
  "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr";

export const SPARK_USD_DECIMALS = 6;

export const SPARK_USD_SYMBOL =
  process.env.NEXT_PUBLIC_COLLATERAL_SYMBOL?.trim() || "SPKUSD";

export const SPARK_USD_DISPLAY_NAME =
  process.env.SPARK_USD_DISPLAY_NAME?.trim() ||
  process.env.NEXT_PUBLIC_COLLATERAL_DISPLAY_NAME?.trim() ||
  "SparkUSD";

/** Human-readable collateral name for UI (not "USDC"). */
export const COLLATERAL_DISPLAY_LABEL = SPARK_USD_DISPLAY_NAME;

/** @internal */
function sparkMintRawFromEnv(): string | undefined {
  const a = process.env.SPARK_USD_MINT?.trim();
  const b = process.env.PMAMM_COLLATERAL_MINT?.trim();
  const c = process.env.NEXT_PUBLIC_COLLATERAL_MINT?.trim();
  const d = process.env.NEXT_PUBLIC_PMAMM_USDC_MINT?.trim();
  return a || b || c || d || undefined;
}

/**
 * Resolves configured SparkUSD (platform collateral) mint from env, without throwing.
 * Order: `SPARK_USD_MINT`, `PMAMM_COLLATERAL_MINT`, `NEXT_PUBLIC_COLLATERAL_MINT`, deprecated `NEXT_PUBLIC_PMAMM_USDC_MINT`.
 */
export function tryGetSparkUsdMintRawFromEnv(): string | undefined {
  return sparkMintRawFromEnv();
}

export function getSparkUsdMint(): PublicKey {
  const raw = sparkMintRawFromEnv();
  if (!raw) {
    if (process.env.NODE_ENV === "development") {
      throw new Error(
        "SparkUSD mint is not configured. Set SPARK_USD_MINT and NEXT_PUBLIC_COLLATERAL_MINT (and PMAMM_COLLATERAL_MINT on the server to match).",
      );
    }
    throw new Error("SparkUSD mint is not configured.");
  }
  return new PublicKey(raw);
}

/**
 * Same as {@link getSparkUsdMint} but returns null when unset (for optional UI).
 */
export function tryGetSparkUsdMint(): PublicKey | null {
  const raw = sparkMintRawFromEnv();
  if (!raw) return null;
  try {
    return new PublicKey(raw);
  } catch {
    return null;
  }
}

export function isLegacyCollateralMint(mint: PublicKey | string): boolean {
  const s = typeof mint === "string" ? mint : mint.toBase58();
  return s === LEGACY_DEVNET_USDC_COLLATERAL_MINT;
}

export function isSparkUsdConfiguredMint(mint: PublicKey | string): boolean {
  const configured = tryGetSparkUsdMint();
  if (!configured) return false;
  const s = typeof mint === "string" ? mint : mint.toBase58();
  return s === configured.toBase58();
}

/**
 * UI: how to describe collateral for a market row / pool.
 */
export function collateralLabelForMint(mint: string | null | undefined): string {
  if (!mint) return COLLATERAL_DISPLAY_LABEL;
  if (isSparkUsdConfiguredMint(mint)) return COLLATERAL_DISPLAY_LABEL;
  if (isLegacyCollateralMint(mint)) return "Legacy USDC";
  return "Collateral";
}

/** GAMM rows: collateral SPL mint recorded in Supabase (`usdc_mint`). */
export function collateralMintFromMarketRecord(
  usdcMint: string | null | undefined,
): PublicKey {
  const t = usdcMint?.trim();
  if (!t) return getSparkUsdMint();
  return new PublicKey(t);
}

/** GAMM `markets.usdc_mint` + volume parsers: treat these as SPL collateral legs (6 dp). */
export function gammCollateralMintStringsForMatching(): string[] {
  const spark = tryGetSparkUsdMintRawFromEnv();
  const set = new Set<string>();
  if (spark) set.add(spark);
  set.add(LEGACY_DEVNET_USDC_COLLATERAL_MINT);
  return [...set];
}

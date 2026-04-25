import { PublicKey } from "@solana/web3.js";

import { parseUsdcHumanToBaseUnits } from "@/lib/solana/mint-market-positions";

/**
 * pm-AMM ([Mattdgn/pm-amm](https://github.com/Mattdgn/pm-amm)) deployment config.
 * Set `NEXT_PUBLIC_PMAMM_PROGRAM_ID` to your devnet program id.
 */
export const PMAMM_CONFIG = {
  programId: new PublicKey(
    process.env.NEXT_PUBLIC_PMAMM_PROGRAM_ID ??
      "11111111111111111111111111111111",
  ),
  collateralMint: new PublicKey(
    process.env.NEXT_PUBLIC_PMAMM_USDC_MINT ??
      "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr",
  ),
  cluster: "devnet" as const,
};

export function requirePmammProgramId(): PublicKey {
  const raw = process.env.NEXT_PUBLIC_PMAMM_PROGRAM_ID?.trim();
  if (!raw) {
    throw new Error(
      "NEXT_PUBLIC_PMAMM_PROGRAM_ID is not set (required for pmAMM markets).",
    );
  }
  return new PublicKey(raw);
}

/** Default initial liquidity (human USDC) when the client omits `initialLiquidityUsdc`. */
export const PMAMM_DEFAULT_INITIAL_LIQUIDITY_USDC_HUMAN = "1000";

/** `PMAMM_DEFAULT_INITIAL_LIQUIDITY_USDC_HUMAN` in base units (6 decimals). */
export const PMAMM_DEFAULT_INITIAL_LIQUIDITY_USDC_ATOMS =
  parseUsdcHumanToBaseUnits(PMAMM_DEFAULT_INITIAL_LIQUIDITY_USDC_HUMAN);

/**
 * @deprecated Renamed to {@link PMAMM_DEFAULT_INITIAL_LIQUIDITY_USDC_ATOMS}. Initial liquidity is now user-configurable.
 */
export const PMAMM_SEED_LIQUIDITY_USDC_ATOMS =
  PMAMM_DEFAULT_INITIAL_LIQUIDITY_USDC_ATOMS;

export function getPmammCollateralMint(): PublicKey {
  const raw =
    process.env.NEXT_PUBLIC_PMAMM_USDC_MINT?.trim() ??
    "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr";
  return new PublicKey(raw);
}

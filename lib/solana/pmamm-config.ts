import { PublicKey } from "@solana/web3.js";

import { parseUsdcHumanToBaseUnits } from "@/lib/solana/mint-market-positions";

/** Matt’s referenced public devnet program id ([Mattdgn/pm-amm](https://github.com/Mattdgn/pm-amm)). */
export const PMAMM_MATT_REFERENCE_DEVNET_PROGRAM_ID_STR =
  "8V872cTKfH1gC5zBvQhrQN2DXSmRNokPPjPsBE46MZNj";

/**
 * If using Matt’s deployed program ID, Anchor **must** use the exact IDL that matches that bytecode
 * or you will typically see Anchor 102 InstructionDidNotDeserialize.
 */
export const PMAMM_MATTS_IDL_COMPAT_WARNING =
  "If using Matt’s deployed pmAMM program ID, this app must use Matt’s exact deployed Anchor IDL (same build as chain). Prefer `NEXT_PUBLIC_PMAMM_PROGRAM_ID` set to our own deployed program (see contracts/pm-amm-anchor/DEPLOY.md) and ship the paired `target/idl/pm_amm.json` into lib/engines/idl.";

/** Shown when instruction payload / IDL drift is suspected. */
export const PMAMM_ADAPTER_MISMATCH_USER_MESSAGE =
  "pmAMM TS client (`lib/solana/pmamm-program.ts` + checked-in IDL) does not match the program at NEXT_PUBLIC_PMAMM_PROGRAM_ID.";

/**
 * Predicted wiring: **`NEXT_PUBLIC_PMAMM_PROGRAM_ID`** must equal the pubkey in **`lib/engines/idl/pm_amm.json`** for that deployment (copy from `contracts/pm-amm-anchor/target/idl/pm_amm.json` after build).
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

/** Thrown when `getAccountInfo(programId)` is null — program not deployed on this RPC/cluster. */
export const PMAMM_PROGRAM_NOT_ON_CLUSTER_MESSAGE =
  "pmAMM program not found on this cluster. Check program ID and RPC.";

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

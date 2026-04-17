import type {
  LeveragePreviewNoResult,
  LeveragePreviewYesResult,
} from "@/lib/solana/omnipair-leverage-preview";

/**
 * Same multiple as the leverage slider / preview: (collateral + estimated swap-out) / collateral
 * in raw atoms — matches what users select as target leverage before fees/slippage.
 */
export function outcomeLeverageMultiple(
  side: "yes" | "no",
  collateralAtoms: bigint,
  preview: LeveragePreviewYesResult | LeveragePreviewNoResult,
): number {
  if (collateralAtoms <= 0n) return 1;
  if (side === "yes") {
    const est = (preview as LeveragePreviewYesResult).estimatedYesOutAtoms;
    return Number(collateralAtoms + est) / Number(collateralAtoms);
  }
  const est = (preview as LeveragePreviewNoResult).estimatedNoOutAtoms;
  return Number(collateralAtoms + est) / Number(collateralAtoms);
}

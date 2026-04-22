import type { OutcomeSide } from "@/lib/types/market";

const LOG = "[predicted][resolved-redeem-ui]";

export type ResolvedRedeemRenderedState =
  | "winning_redeem"
  | "losing"
  | "neutral"
  | "unknown_winner"
  | "n_a";

type Bal = { yesRaw: bigint; noRaw: bigint; loading: boolean };

export function winningSideOrNull(
  status: string,
  resolved: OutcomeSide | undefined,
): "yes" | "no" | null {
  if (status !== "resolved") return null;
  if (resolved === "yes" || resolved === "no") return resolved;
  return null;
}

/**
 * For resolved binary markets, only the winning leg is ever redeemable to USDC.
 */
export function computeResolvedRedeemFlags(
  winning: "yes" | "no" | null,
  b: Bal,
) {
  if (!winning) {
    return {
      redeemableYes: false,
      redeemableNo: false,
      hasWinningBalance: false,
      hasLosingBalance: false,
    };
  }
  const hasYes = b.yesRaw > 0n;
  const hasNo = b.noRaw > 0n;
  if (winning === "yes") {
    return {
      redeemableYes: hasYes,
      redeemableNo: false,
      hasWinningBalance: hasYes,
      hasLosingBalance: hasNo,
    };
  }
  return {
    redeemableYes: false,
    redeemableNo: hasNo,
    hasWinningBalance: hasNo,
    hasLosingBalance: hasYes,
  };
}

export function resolvedRedeemRenderedState(
  connected: boolean,
  winning: "yes" | "no" | null,
  b: Bal,
  flags: ReturnType<typeof computeResolvedRedeemFlags>,
): ResolvedRedeemRenderedState {
  if (winning == null) return "unknown_winner";
  if (b.loading) return "n_a";
  if (!connected) return "neutral";
  if (flags.hasWinningBalance) return "winning_redeem";
  if (flags.hasLosingBalance) return "losing";
  return "neutral";
}

export function logResolvedRedeemUi(params: {
  slug: string;
  resolvedOutcome: "yes" | "no" | null;
  selectedUiSide: "yes" | "no";
  winningSide: "yes" | "no" | null;
  userYesBalance: string;
  userNoBalance: string;
  redeemableYes: boolean;
  redeemableNo: boolean;
  renderedPrimaryAction: string;
  renderedState: ResolvedRedeemRenderedState;
}): void {
  if (process.env.NODE_ENV !== "development") return;
  console.info(
    LOG,
    JSON.stringify({
      slug: params.slug,
      resolvedOutcome: params.resolvedOutcome,
      selectedUiSide: params.selectedUiSide,
      winningSide: params.winningSide,
      userYesBalance: params.userYesBalance,
      userNoBalance: params.userNoBalance,
      redeemableYes: params.redeemableYes,
      redeemableNo: params.redeemableNo,
      renderedPrimaryAction: params.renderedPrimaryAction,
      renderedState: params.renderedState,
    }),
  );
}

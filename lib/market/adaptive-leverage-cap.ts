import {
  parseUsdcHumanToBaseUnits,
  usdcBaseUnitsToOutcomeBaseUnits,
} from "@/lib/solana/mint-market-positions";

/** Reference notional (USDC human) used only to probe pool borrow / swap feasibility for the slider. */
export const ADAPTIVE_LEVERAGE_REFERENCE_USDC = "5";

/** Product cap — UI never exceeds this multiple. */
export const ADAPTIVE_LEVERAGE_GLOBAL_CAP = 3 as const;

export type LeverageUiTier = 1 | 2 | 3;

export const LEVERAGE_CAPACITY_USER_MESSAGE =
  "This size exceeds current leverage capacity. Reduce amount or leverage.";

const SLIPPAGE_BPS = 150;
const EPS = 1e-7;

/** Mirrors `outcomeLeverageMultiple` in market-leverage-section (USDC → outcome atoms collateral). */
function outcomeLeverageMultipleFromPreview(
  side: "yes" | "no",
  usdcAmountHuman: string,
  preview: {
    borrowNoAtoms?: string;
    estimatedYesOutAtoms?: string;
    borrowYesAtoms?: string;
    estimatedNoOutAtoms?: string;
  },
): number {
  let usdcAtoms: bigint;
  try {
    usdcAtoms = parseUsdcHumanToBaseUnits(usdcAmountHuman.trim());
  } catch {
    return 1;
  }
  const collateralAtoms = usdcBaseUnitsToOutcomeBaseUnits(usdcAtoms);
  if (collateralAtoms <= 0n) return 1;

  if (side === "yes") {
    const est = BigInt(preview.estimatedYesOutAtoms ?? "0");
    return Number(collateralAtoms + est) / Number(collateralAtoms);
  }
  const est = BigInt(preview.estimatedNoOutAtoms ?? "0");
  return Number(collateralAtoms + est) / Number(collateralAtoms);
}

type PreviewJson = {
  error?: string;
  side?: "yes" | "no";
  preview?: {
    borrowNoAtoms?: string;
    estimatedYesOutAtoms?: string;
    minYesOutAtoms?: string;
    borrowYesAtoms?: string;
    estimatedNoOutAtoms?: string;
    minNoOutAtoms?: string;
  };
};

async function postPreviewLeverageUsdc(args: {
  slug: string;
  userWallet: string;
  side: "yes" | "no";
  usdcAmountHuman: string;
  leverageSlider01: number;
  skipUsdcBalanceCheck: boolean;
  signal?: AbortSignal;
}): Promise<
  | { ok: true; body: PreviewJson & { preview: NonNullable<PreviewJson["preview"]>; side: "yes" | "no" } }
  | { ok: false; error: string }
> {
  const res = await fetch("/api/market/preview-leverage-usdc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: args.signal,
    body: JSON.stringify({
      slug: args.slug,
      userWallet: args.userWallet,
      usdcAmountHuman: args.usdcAmountHuman,
      side: args.side,
      leverageSlider01: args.leverageSlider01,
      slippageBps: SLIPPAGE_BPS,
      skipUsdcBalanceCheck: args.skipUsdcBalanceCheck,
    }),
  });

  const data = (await res.json()) as PreviewJson;
  if (!res.ok || data.error) {
    return { ok: false, error: data.error ?? `Preview failed (${res.status})` };
  }
  if (!data.preview || (data.side !== "yes" && data.side !== "no")) {
    return { ok: false, error: "Invalid preview response" };
  }
  return { ok: true, body: data as typeof data & { preview: NonNullable<PreviewJson["preview"]>; side: "yes" | "no" } };
}

/**
 * Highest discrete tier (1×–3×) allowed for the slider, using a small reference USDC size
 * and the same borrow scaling as the live worm (`leverageSlider01`).
 */
export async function computeAdaptiveLeverageMaxTier(params: {
  slug: string;
  userWallet: string;
  side: "yes" | "no";
  signal?: AbortSignal;
}): Promise<{
  maxTier: LeverageUiTier;
  refMaxMultiple: number | null;
  probeError: string | null;
}> {
  const ref = ADAPTIVE_LEVERAGE_REFERENCE_USDC;

  const full = await postPreviewLeverageUsdc({
    slug: params.slug,
    userWallet: params.userWallet,
    side: params.side,
    usdcAmountHuman: ref,
    leverageSlider01: 1,
    skipUsdcBalanceCheck: true,
    signal: params.signal,
  });

  if (!full.ok) {
    return { maxTier: 1, refMaxMultiple: null, probeError: full.error };
  }

  const mMax = outcomeLeverageMultipleFromPreview(
    params.side,
    ref,
    full.body.preview,
  );

  if (!Number.isFinite(mMax) || mMax <= 1 + EPS) {
    return { maxTier: 1, refMaxMultiple: mMax, probeError: null };
  }

  let maxTier: LeverageUiTier = 1;

  if (mMax >= ADAPTIVE_LEVERAGE_GLOBAL_CAP - EPS) {
    const f3 = (ADAPTIVE_LEVERAGE_GLOBAL_CAP - 1) / (mMax - 1);
    if (f3 <= 1 + 1e-6) {
      const t3 = await postPreviewLeverageUsdc({
        slug: params.slug,
        userWallet: params.userWallet,
        side: params.side,
        usdcAmountHuman: ref,
        leverageSlider01: f3,
        skipUsdcBalanceCheck: true,
        signal: params.signal,
      });
      if (t3.ok) maxTier = ADAPTIVE_LEVERAGE_GLOBAL_CAP;
    }
  }

  if (maxTier < 3 && mMax >= 2 - EPS) {
    const f2 = (2 - 1) / (mMax - 1);
    if (f2 <= 1 + 1e-6) {
      const t2 = await postPreviewLeverageUsdc({
        slug: params.slug,
        userWallet: params.userWallet,
        side: params.side,
        usdcAmountHuman: ref,
        leverageSlider01: f2,
        skipUsdcBalanceCheck: true,
        signal: params.signal,
      });
      if (t2.ok) maxTier = 2;
    }
  }

  return { maxTier, refMaxMultiple: mMax, probeError: null };
}

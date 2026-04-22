import { getResolvedBinaryDisplayPrices } from "@/lib/market/resolved-binary-prices";
import type { Market } from "@/lib/types/market";

const DEV_LOG = "[predicted][position-metrics][dev]";

/**
 * Omnipair “Your position” USD metrics.
 *
 * **Prices:** Prefer `spotYesProbability` / `spotNoProbability` from pool reserves (same as
 * `derive-market-probability` / health math). Fall back to `market.pool` / `yesProbability`.
 *
 * **Collateral / debt value:** Sum of each leg at marks (not interchanged).
 *
 * **Directional exposure (USD):** For each leveraged archetype, long-side collateral USD plus
 * borrowed opposite token USD (what was swapped into directional exposure). Algebraically this
 * equals `collateralYesUsd + debtNoUsd + collateralNoUsd + debtYesUsd` when all four are
 * valued at the same marks — we compute leg sums explicitly for clarity.
 *
 * **Current effective leverage:** Matches the trade UI definition of target leverage:
 * gross directional exposure on the position ÷ **posted collateral on that side** (same structure
 * as `outcomeLeverageMultiple`: (collateral + borrowed leg as implied long) / collateral).
 * In USD at consistent marks: YES track `(collateralYesUsd + debtNoUsd) / collateralYesUsd`,
 * NO track `(collateralNoUsd + debtYesUsd) / collateralNoUsd`. With both legs active,
 * `(Cy+Dn+Cn+Dy) / (Cy+Cn)`. This aligns with post-open display vs the slider; remaining gap is
 * fees/slippage vs preview simulation.
 *
 * **Leverage on equity** (optional, dev log only): `directionalExposureUsd / equityUsd` — not
 * shown as primary because it diverges from the “× vs deposit” notion used at open.
 */
export type OmnipairPositionMetricsUsd = {
  priceSource: "resolved_payout" | "spot_reserves" | "market_pool";
  impliedYes: number;
  impliedNo: number;
  collateralValueUsd: number;
  debtValueUsd: number;
  equityUsd: number;
  /** Cy+Dn + Cn+Dy at marks (directional gross USD). */
  directionalExposureUsd: number;
  /**
   * Trade-consistent multiple vs posted collateral (see module comment).
   * Post-fee/slippage vs `outcomeLeverageMultiple` at open.
   */
  currentEffectiveLeverage: number | null;
  /** directionalExposureUsd / equityUsd when equity &gt; 0 — informational. */
  leverageOnEquityUsd: number | null;
  healthFactor: number | null;
};

export type PriceInput = {
  spotYesProbability: number | null | undefined;
  spotNoProbability: number | null | undefined;
};

export function resolveImpliedPrices(
  market: Market,
  spot: PriceInput,
): {
  impliedYes: number;
  impliedNo: number;
  priceSource: "resolved_payout" | "spot_reserves" | "market_pool";
} {
  const resolved = getResolvedBinaryDisplayPrices(market);
  if (resolved) {
    return {
      impliedYes: resolved.yes,
      impliedNo: resolved.no,
      priceSource: "resolved_payout",
    };
  }
  const sy = spot.spotYesProbability;
  const sn = spot.spotNoProbability;
  if (
    sy != null &&
    sn != null &&
    Number.isFinite(sy) &&
    Number.isFinite(sn) &&
    sy > 0 &&
    sn > 0
  ) {
    const sum = sy + sn;
    const ny = sum > 0 ? sy / sum : sy;
    const nn = sum > 0 ? sn / sum : sn;
    return { impliedYes: ny, impliedNo: nn, priceSource: "spot_reserves" };
  }
  const yes = market.pool?.yesPrice ?? market.yesProbability;
  const no = market.pool?.noPrice ?? 1 - market.yesProbability;
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  const y = clamp(yes);
  const n = clamp(no > 0 ? no : 1 - y);
  return { impliedYes: y, impliedNo: n, priceSource: "market_pool" };
}

export function computeOmnipairPositionMetricsUsd(params: {
  market: Market;
  collateralYesAtoms: bigint;
  collateralNoAtoms: bigint;
  debtYesAtoms: bigint;
  debtNoAtoms: bigint;
  yesDecimals: number;
  noDecimals: number;
  healthFactorApprox: number | null | undefined;
  spot: PriceInput;
}): OmnipairPositionMetricsUsd {
  const { impliedYes: py, impliedNo: pn, priceSource } = resolveImpliedPrices(
    params.market,
    params.spot,
  );
  const yd = params.yesDecimals;
  const nd = params.noDecimals;

  const cy = Number(params.collateralYesAtoms) / 10 ** yd;
  const cn = Number(params.collateralNoAtoms) / 10 ** nd;
  const dy = Number(params.debtYesAtoms) / 10 ** yd;
  const dn = Number(params.debtNoAtoms) / 10 ** nd;

  const collateralYesUsd = cy * py;
  const collateralNoUsd = cn * pn;
  const collateralValueUsd = collateralYesUsd + collateralNoUsd;

  const debtYesUsd = dy * py;
  const debtNoUsd = dn * pn;
  const debtValueUsd = debtYesUsd + debtNoUsd;

  const equityUsd = collateralValueUsd - debtValueUsd;

  const yesLegGrossUsd = collateralYesUsd + debtNoUsd;
  const noLegGrossUsd = collateralNoUsd + debtYesUsd;
  const directionalExposureUsd = yesLegGrossUsd + noLegGrossUsd;

  const yesLeveraged = params.debtNoAtoms > 0n && params.collateralYesAtoms > 0n;
  const noLeveraged = params.debtYesAtoms > 0n && params.collateralNoAtoms > 0n;

  let currentEffectiveLeverage: number | null = null;

  if (yesLeveraged && !noLeveraged) {
    if (collateralYesUsd > 1e-12) {
      currentEffectiveLeverage = yesLegGrossUsd / collateralYesUsd;
    }
  } else if (!yesLeveraged && noLeveraged) {
    if (collateralNoUsd > 1e-12) {
      currentEffectiveLeverage = noLegGrossUsd / collateralNoUsd;
    }
  } else if (yesLeveraged && noLeveraged) {
    const denom = collateralYesUsd + collateralNoUsd;
    if (denom > 1e-12) {
      currentEffectiveLeverage = directionalExposureUsd / denom;
    }
  } else {
    const hasDebt = params.debtYesAtoms > 0n || params.debtNoAtoms > 0n;
    if (!hasDebt && (params.collateralYesAtoms > 0n || params.collateralNoAtoms > 0n)) {
      currentEffectiveLeverage = 1;
    }
  }

  let leverageOnEquityUsd: number | null = null;
  if (Number.isFinite(equityUsd) && equityUsd > 1e-12) {
    leverageOnEquityUsd = directionalExposureUsd / equityUsd;
  }

  const hf = params.healthFactorApprox;
  const healthFactor = hf != null && Number.isFinite(hf) ? hf : null;

  return {
    priceSource,
    impliedYes: py,
    impliedNo: pn,
    collateralValueUsd,
    debtValueUsd,
    equityUsd,
    directionalExposureUsd,
    currentEffectiveLeverage,
    leverageOnEquityUsd,
    healthFactor,
  };
}

export type PositionRiskBadge =
  | "safe"
  | "moderate"
  | "high"
  | "liquidatable"
  | "unknown";

export function riskBadgeFromHealthFactor(
  health: number | null | undefined,
): PositionRiskBadge {
  if (health == null || !Number.isFinite(health)) return "unknown";
  if (health > 2) return "safe";
  if (health > 1.2) return "moderate";
  if (health > 1) return "high";
  return "liquidatable";
}

export function riskBadgeLabel(badge: PositionRiskBadge): string {
  switch (badge) {
    case "safe":
      return "Safe";
    case "moderate":
      return "Moderate Risk";
    case "high":
      return "High Risk";
    case "liquidatable":
      return "Liquidatable";
    default:
      return "Unknown";
  }
}

const usdFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return usdFmt.format(n);
}

export function formatLeverageMult(x: number | null): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${x.toFixed(2)}×`;
}

export function formatHealthMult(x: number | null): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return x.toFixed(2);
}

export type PositionMetricsDevPayload = OmnipairPositionMetricsUsd & {
  yesMint: string;
  noMint: string;
  collateralYesHuman: number;
  collateralNoHuman: number;
  debtYesHuman: number;
  debtNoHuman: number;
};

export function logPositionMetricsDev(p: PositionMetricsDevPayload): void {
  if (process.env.NODE_ENV === "production") return;
  console.info(
    DEV_LOG,
    JSON.stringify({
      yesMint: p.yesMint,
      noMint: p.noMint,
      collateralYesHuman: p.collateralYesHuman,
      collateralNoHuman: p.collateralNoHuman,
      debtYesHuman: p.debtYesHuman,
      debtNoHuman: p.debtNoHuman,
      currentYesPrice: p.impliedYes,
      currentNoPrice: p.impliedNo,
      priceSource: p.priceSource,
      collateralValueUsd: p.collateralValueUsd,
      debtValueUsd: p.debtValueUsd,
      directionalExposureUsd: p.directionalExposureUsd,
      equityUsd: p.equityUsd,
      currentEffectiveLeverage: p.currentEffectiveLeverage,
      leverageOnEquityUsd: p.leverageOnEquityUsd,
      healthFactor: p.healthFactor,
    }),
  );
}

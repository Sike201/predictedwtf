import type { DecodedOmnipairPair } from "@/lib/solana/decode-omnipair-accounts";
import { OMNIPAIR_NAD } from "@/lib/solana/omnipair-leverage-common";
import { OMNIPAIR_BPS } from "@/lib/solana/omnipair-swap-math";
import type { OmnipairPositionSnapshot } from "@/lib/solana/read-omnipair-position";

/**
 * Spot price of token0 in token1 units, NAD-scaled (mirrors `Pair::spot_price0_nad`).
 */
export function spotPrice0Nad(pair: DecodedOmnipairPair): bigint {
  if (pair.reserve0 === 0n) return 0n;
  return (pair.reserve1 * OMNIPAIR_NAD) / pair.reserve0;
}

export function spotPrice1Nad(pair: DecodedOmnipairPair): bigint {
  if (pair.reserve1 === 0n) return 0n;
  return (pair.reserve0 * OMNIPAIR_NAD) / pair.reserve1;
}

export type LeverageRiskSummary = {
  /** >1 means more headroom before protocol liquidation at spot (indicative only). */
  healthFactorApprox: number | null;
  /** User-position liquidation CF (bps) on the YES leg. */
  liquidationCfYesBps: number;
  /** User-position liquidation CF (bps) on the NO leg. */
  liquidationCfNoBps: number;
  /** Plain-language risk bucket for UI. */
  riskLabel: "low" | "moderate" | "elevated" | "na";
};

/**
 * Rough headroom: compares outstanding debt in the borrowed leg to notional collateral value
 * using **spot** reserves (protocol uses EMA + pessimistic CF internally).
 */
export function summarizeLeverageRiskDisplay(params: {
  position: OmnipairPositionSnapshot;
  pair: DecodedOmnipairPair;
}): LeverageRiskSummary {
  const { position, pair } = params;
  const liqYes = position.yesIsToken0
    ? position.raw.collateral0LiquidationCfBps
    : position.raw.collateral1LiquidationCfBps;
  const liqNo = position.yesIsToken0
    ? position.raw.collateral1LiquidationCfBps
    : position.raw.collateral0LiquidationCfBps;

  const p0 = spotPrice0Nad(pair);
  const p1 = spotPrice1Nad(pair);

  /** YES value in NO atoms (rough) when YES is token0: collateralYes * p0 / NAD */
  const valueYesInNo =
    position.yesIsToken0
      ? (position.collateralYesAtoms * p0) / OMNIPAIR_NAD
      : (position.collateralYesAtoms * p1) / OMNIPAIR_NAD;
  const valueNoInYes = position.yesIsToken0
    ? (position.collateralNoAtoms * p1) / OMNIPAIR_NAD
    : (position.collateralNoAtoms * p0) / OMNIPAIR_NAD;

  let healthFactorApprox: number | null = null;
  let riskLabel: LeverageRiskSummary["riskLabel"] = "na";

  /** YES collateral + NO debt (leveraged YES archetype). */
  if (position.debtNoAtoms > 0n && position.collateralYesAtoms > 0n) {
    const notionalSupported = (valueYesInNo * BigInt(liqYes)) / OMNIPAIR_BPS;
    if (notionalSupported > 0n) {
      healthFactorApprox = Number(notionalSupported) / Number(position.debtNoAtoms);
    }
    riskLabel = healthBucket(healthFactorApprox);
  } else if (position.debtYesAtoms > 0n && position.collateralNoAtoms > 0n) {
    /** NO collateral + YES debt (leveraged NO archetype). */
    const notionalSupported = (valueNoInYes * BigInt(liqNo)) / OMNIPAIR_BPS;
    if (notionalSupported > 0n) {
      healthFactorApprox = Number(notionalSupported) / Number(position.debtYesAtoms);
    }
    riskLabel = healthBucket(healthFactorApprox);
  } else {
    riskLabel = "na";
  }

  return {
    healthFactorApprox,
    liquidationCfYesBps: liqYes,
    liquidationCfNoBps: liqNo,
    riskLabel,
  };
}

function healthBucket(h: number | null): LeverageRiskSummary["riskLabel"] {
  if (h == null || !Number.isFinite(h)) return "na";
  if (h >= 1.6) return "low";
  if (h >= 1.15) return "moderate";
  return "elevated";
}

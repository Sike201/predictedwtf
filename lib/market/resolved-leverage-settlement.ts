import type { OmnipairUserPositionSnapshot } from "@/lib/hooks/use-omnipair-user-position";
import { computeOmnipairPositionMetricsUsd } from "@/lib/market/omnipair-position-metrics";
import { getResolvedBinaryDisplayPrices } from "@/lib/market/resolved-binary-prices";
import type { Market } from "@/lib/types/market";

const LOG = "[predicted][leverage-settlement]";

/**
 * USD mark-to-resolution for an open position (outcome @ $1 / $0). Ignores live pool
 * implied spot; uses `getResolvedBinaryDisplayPrices` via `computeOmnipairPositionMetricsUsd`.
 */
export function estimateAtResolutionPayoutMark(params: {
  market: Market;
  snapshot: OmnipairUserPositionSnapshot;
  yesDecimals: number;
  noDecimals: number;
}) {
  return computeOmnipairPositionMetricsUsd({
    market: params.market,
    collateralYesAtoms: BigInt(params.snapshot.collateralYesAtoms),
    collateralNoAtoms: BigInt(params.snapshot.collateralNoAtoms),
    debtYesAtoms: BigInt(params.snapshot.debtYesAtoms),
    debtNoAtoms: BigInt(params.snapshot.debtNoAtoms),
    yesDecimals: params.yesDecimals,
    noDecimals: params.noDecimals,
    healthFactorApprox: params.snapshot.healthFactorApprox,
    spot: { spotYesProbability: null, spotNoProbability: null },
  });
}

export function shouldUseLeverageSettlement(
  market: Market,
  snapshot: OmnipairUserPositionSnapshot | null,
): boolean {
  if (!snapshot) return false;
  if (!getResolvedBinaryDisplayPrices(market)) return false;
  return (
    BigInt(snapshot.collateralYesAtoms) > 0n ||
    BigInt(snapshot.collateralNoAtoms) > 0n ||
    BigInt(snapshot.debtYesAtoms) > 0n ||
    BigInt(snapshot.debtNoAtoms) > 0n
  );
}

export function logLeverageSettlementStart(payload: {
  slug: string;
  winningOutcome: "yes" | "no";
  userPositionId: string;
  wallet: string;
}): void {
  console.info(
    `${LOG} settlement_start`,
    JSON.stringify({
      slug: payload.slug,
      winningOutcome: payload.winningOutcome,
      userPositionId: payload.userPositionId,
      wallet: payload.wallet,
    }),
  );
}

export function logLeverageSettlementResult(payload: {
  slug: string;
  winningOutcome: "yes" | "no";
  userPositionId: string;
  wallet: string;
  finalUserValue: number;
  debtNet: number;
  collateralNet: number;
}): void {
  console.info(
    `${LOG} settlement_result`,
    JSON.stringify({
      slug: payload.slug,
      winningOutcome: payload.winningOutcome,
      userPositionId: payload.userPositionId,
      wallet: payload.wallet,
      finalUserValue: payload.finalUserValue,
      debtNet: payload.debtNet,
      collateralNet: payload.collateralNet,
    }),
  );
}

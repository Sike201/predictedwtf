import type { Market } from "@/lib/types/market";

const LOG_PREFIX = "[predicted][resolved-pricing]";

/**
 * When a binary market is resolved, visible YES/NO must be 0/1 from payout, not pool mids.
 */
export function getResolvedBinaryDisplayPrices(
  market: Market,
):
  | { yes: number; no: number; winningOutcome: "yes" | "no" }
  | null {
  if (market.kind !== "binary") return null;
  if (market.resolution.status !== "resolved") return null;
  const w = market.resolution.resolvedOutcome;
  if (w !== "yes" && w !== "no") return null;
  return w === "yes"
    ? { yes: 1, no: 0, winningOutcome: "yes" }
    : { yes: 0, no: 1, winningOutcome: "no" };
}

/**
 * Re-apply 0/1 on `yesProbability` and `pool` prices so any upstream enrich does not
 * clobber resolved display.
 */
export function withResolvedBinaryDisplay(market: Market): Market {
  const r = getResolvedBinaryDisplayPrices(market);
  if (!r) return market;
  return {
    ...market,
    yesProbability: r.yes,
    pool: market.pool
      ? {
          ...market.pool,
          yesPrice: r.yes,
          noPrice: r.no,
        }
      : market.pool,
  };
}

export function logResolvedPricingOverride(params: {
  slug: string;
  winningOutcome: "yes" | "no";
  finalYesPrice: number;
  finalNoPrice: number;
}): void {
  console.info(
    `${LOG_PREFIX} source_override_applied`,
    JSON.stringify({
      slug: params.slug,
      winningOutcome: params.winningOutcome,
      finalYesPrice: params.finalYesPrice,
      finalNoPrice: params.finalNoPrice,
    }),
  );
}

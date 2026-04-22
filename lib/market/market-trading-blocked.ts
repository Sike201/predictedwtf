import { isPastResolveAfter } from "@/lib/market/market-lifecycle";
import type { MarketRecord } from "@/lib/types/market-record";

/** User-facing: market finished and outcome is final. */
export const MARKET_RESOLVED_TRADING_ERROR =
  "This market is resolved — new trades are disabled.";

/** User-facing: past end, outcome not set yet. */
export const MARKET_RESOLVING_TRADING_ERROR =
  "This market is resolving — trading is disabled until the outcome is posted.";

export function isMarketRecordResolved(row: {
  resolution_status?: string | null;
}): boolean {
  return row.resolution_status === "resolved";
}

/** After `resolve_on` (DB is still `active`, resolver pending). */
export function isMarketRecordResolvingWindow(row: MarketRecord): boolean {
  if (row.resolution_status === "resolved") return false;
  if (row.resolution_status !== "active") return false;
  return isPastResolveAfter(row);
}

/**
 * Block buys, new leverage, mints when resolved or in resolving window.
 * Sells (redeem) allowed only when fully resolved, not while resolving.
 */
export function isMarketRowBlockedForNewBuys(
  row: MarketRecord,
  nowMs: number = Date.now(),
): boolean {
  if (isMarketRecordResolved(row)) return true;
  if (isPastResolveAfter(row, nowMs) && (row.resolution_status ?? "active") === "active")
    return true;
  return false;
}

/** Block sell/redeem while past end and not yet final (resolving). */
export function isMarketRowBlockedForSells(
  row: MarketRecord,
  nowMs: number = Date.now(),
): boolean {
  if (isMarketRecordResolved(row)) return false;
  if (isPastResolveAfter(row, nowMs) && (row.resolution_status ?? "active") === "active")
    return true;
  return false;
}

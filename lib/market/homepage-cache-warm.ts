import type { Market } from "@/lib/types/market";

import { filterFeedMarkets } from "@/lib/data/filter-markets";

/** Max markets per homepage background batch (each stale one may scan chain). */
export const HOMEPAGE_CACHE_WARM_MAX = 10;

/** Ms between batch reconcile calls to spread RPC load. */
export const HOMEPAGE_CACHE_WARM_STAGGER_MS = 140;

/**
 * Trending-by-volume first (likely user interest), cap `max`.
 * Falls back to creation order for ties.
 */
export function pickHomepagePrioritySlugs(
  markets: Market[],
  max: number,
): string[] {
  if (markets.length === 0 || max <= 0) return [];
  const trending = filterFeedMarkets(markets, "trending", "all");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of trending) {
    if (out.length >= max) break;
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m.id);
  }
  return out;
}

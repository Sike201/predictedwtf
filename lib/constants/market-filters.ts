import type {
  MarketCategoryKey,
  MarketFilterKey,
  MarketSortKey,
} from "@/lib/types/market";

/**
 * Left row: sort / discovery (like Polymarket Trending · New · … + Worm “Ending soon”).
 * - trending: volume-weighted feed
 * - new: newest markets first
 * - ending-soon: soonest expiry first
 */
export const FILTER_PRIMARY: {
  key: MarketSortKey;
  label: string;
}[] = [
  { key: "trending", label: "Trending" },
  { key: "new", label: "New" },
  { key: "ending-soon", label: "Ending soon" },
];

/**
 * Topic lanes — plain names (between Polymarket-style and sports-app style).
 * Predicted stays last.
 */
export const FILTER_CATEGORIES: { key: MarketCategoryKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "politics", label: "Politics" },
  { key: "sports", label: "Sports" },
  { key: "crypto", label: "Crypto" },
  { key: "tech", label: "Tech" },
  { key: "finance", label: "Finance" },
  { key: "predicted", label: "Predicted" },
];

export type { MarketCategoryKey, MarketFilterKey, MarketSortKey };

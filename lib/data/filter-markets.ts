import type { Market, MarketCategoryKey, MarketSortKey } from "@/lib/types/market";

function byVolumeDesc(a: Market, b: Market) {
  return b.snapshot.volumeUsd - a.snapshot.volumeUsd;
}

/** Apply topic filter then sort. Sort and category are independent (e.g. Sports + New). */
export function filterFeedMarkets(
  markets: Market[],
  sort: MarketSortKey,
  category: MarketCategoryKey,
): Market[] {
  const base =
    category === "all"
      ? [...markets]
      : markets.filter((m) => m.category === category);

  switch (sort) {
    case "trending":
      return base.sort(byVolumeDesc);
    case "new":
      return base.sort((a, b) => b.createdAt - a.createdAt);
    case "ending-soon":
      return base.sort(
        (a, b) => new Date(a.expiry).getTime() - new Date(b.expiry).getTime(),
      );
  }
}

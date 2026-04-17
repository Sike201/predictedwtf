import type { Market } from "@/lib/types/market";

export function marketDisplayMeta(market: Market) {
  const creatorHandle = market.creatorHandle ?? "@predicted";
  const viewsRaw = market.views;
  const views =
    typeof viewsRaw === "number"
      ? viewsRaw
      : typeof viewsRaw === "string"
        ? parseInt(viewsRaw.replace(/\D/g, ""), 10) || fallbackViews(market)
        : fallbackViews(market);

  const aiOverview =
    market.aiOverview ??
    `${market.description}\n\nLikely drivers: liquidity depth, time to resolution, and how clearly the oracle source maps to the question. Resolution path: ${market.resolution.source}`;

  return { creatorHandle, views, aiOverview };
}

function fallbackViews(m: Market) {
  return Math.min(99_000, Math.floor(m.snapshot.volumeUsd / 35 + 180));
}

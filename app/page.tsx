import { MarketFeed } from "@/components/markets/market-feed";
import { fetchLiveMarketsForFeed } from "@/lib/market/fetch-markets";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HomePage() {
  const t0 = Date.now();
  const initialMarkets = await fetchLiveMarketsForFeed();
  if (process.env.NODE_ENV === "development") {
    console.info("[predicted][cache-warm] ssr_homepage_ms", {
      ms: Date.now() - t0,
      marketCount: initialMarkets.length,
    });
  }
  return <MarketFeed initialMarkets={initialMarkets} />;
}

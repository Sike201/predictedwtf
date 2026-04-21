import { MarketFeed } from "@/components/markets/market-feed";
import { fetchLiveMarketsForFeed } from "@/lib/market/fetch-markets";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function MarketsPage() {
  const t0 = Date.now();
  const initialMarkets = await fetchLiveMarketsForFeed();
  if (process.env.NODE_ENV === "development") {
    console.info("[predicted][markets-index-server]", {
      ms: Date.now() - t0,
      markets: initialMarkets.length,
    });
  }
  return <MarketFeed initialMarkets={initialMarkets} />;
}

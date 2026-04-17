import { MarketFeed } from "@/components/markets/market-feed";
import { fetchLiveMarketsForFeed } from "@/lib/market/fetch-markets";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HomePage() {
  const initialMarkets = await fetchLiveMarketsForFeed();
  return <MarketFeed initialMarkets={initialMarkets} />;
}

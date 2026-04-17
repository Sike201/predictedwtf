import { MarketFeed } from "@/components/markets/market-feed";
import { fetchLiveMarketsForFeed } from "@/lib/market/fetch-markets";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function MarketsPage() {
  const initialMarkets = await fetchLiveMarketsForFeed();
  return <MarketFeed initialMarkets={initialMarkets} />;
}

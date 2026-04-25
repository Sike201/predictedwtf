import { EarnView } from "@/components/earn/earn-view";
import { fetchLiveMarketsForFeed } from "@/lib/market/fetch-markets";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function EarnPage() {
  const markets = await fetchLiveMarketsForFeed();
  return <EarnView initialMarkets={markets} />;
}

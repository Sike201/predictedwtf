import { Suspense } from "react";
import { notFound } from "next/navigation";
import { GroupedMarketPage } from "@/components/markets/grouped-market-page";
import { fetchLiveMarketsForFeed } from "@/lib/market/fetch-markets";
import {
  collectMarketsForGroupKey,
  eventDisplayTitleFromMarkets,
  groupMetaFromMarket,
  normalizeStoredGroupKey,
} from "@/lib/market/group-feed-markets";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = { params: Promise<{ groupKey: string }> };

export default async function EventGroupPage({ params }: PageProps) {
  const { groupKey: rawKey } = await params;
  const groupKey = decodeURIComponent(rawKey);
  const all = await fetchLiveMarketsForFeed();
  const markets = collectMarketsForGroupKey(all, groupKey);
  if (markets.length < 2) notFound();

  const title = eventDisplayTitleFromMarkets(markets);
  const canonicalKey = normalizeStoredGroupKey(
    groupMetaFromMarket(markets[0]!)?.groupKey ?? groupKey,
  );

  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-black px-4 py-12 text-center text-sm text-zinc-500">
          Loading event…
        </div>
      }
    >
      <GroupedMarketPage
        groupKey={canonicalKey}
        title={title}
        markets={markets}
      />
    </Suspense>
  );
}

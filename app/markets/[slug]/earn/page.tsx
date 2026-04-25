import { notFound } from "next/navigation";
import { MarketEarnView } from "@/components/market/market-earn-view";
import { fetchLiveMarketBySlug } from "@/lib/market/fetch-markets";
import { logMarketTraceServer } from "@/lib/market/detail-trading-surface";
import { marketRecordToMarket } from "@/lib/market/market-record-adapter";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = { params: Promise<{ slug: string }> };

export default async function MarketEarnPage({ params }: PageProps) {
  const { slug } = await params;
  const record = await fetchLiveMarketBySlug(decodeURIComponent(slug));
  if (!record) notFound();

  const base = marketRecordToMarket(record, 0);
  logMarketTraceServer({
    where: "app/markets/[slug]/earn/page.tsx",
    record,
    market: base,
    nowMs: Date.now(),
  });

  return <MarketEarnView market={base} />;
}

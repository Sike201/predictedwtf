import { notFound } from "next/navigation";
import { MarketDetailView } from "@/components/market/market-detail-view";
import { enrichMarketWithOnChainStats } from "@/lib/market/enrich-markets-chain";
import { fetchLiveMarketBySlug } from "@/lib/market/fetch-markets";
import { marketRecordToMarket } from "@/lib/market/market-record-adapter";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = { params: Promise<{ slug: string }> };

export default async function MarketBySlugPage({ params }: PageProps) {
  const { slug } = await params;
  const record = await fetchLiveMarketBySlug(decodeURIComponent(slug));
  if (!record) notFound();

  const base = marketRecordToMarket(record, 0);
  const market = await enrichMarketWithOnChainStats(base);
  return <MarketDetailView market={market} />;
}

import { notFound } from "next/navigation";
import { MarketDetailView } from "@/components/market/market-detail-view";
import { enrichMarketWithOnChainStats } from "@/lib/market/enrich-markets-chain";
import { fetchLiveMarketBySlug } from "@/lib/market/fetch-markets";
import { marketRecordToMarket } from "@/lib/market/market-record-adapter";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: Promise<{ id: string }>;
};

/** Legacy `/market/[id]` — `id` is treated as a market `slug` (same as `/markets/[slug]`). */
export default async function LegacyMarketPage({ params }: PageProps) {
  const { id } = await params;
  const record = await fetchLiveMarketBySlug(decodeURIComponent(id));
  if (!record) notFound();

  const base = marketRecordToMarket(record, 0);
  const market = await enrichMarketWithOnChainStats(base);
  return <MarketDetailView market={market} />;
}

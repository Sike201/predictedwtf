import { notFound } from "next/navigation";
import { MarketDetailView } from "@/components/market/market-detail-view";
import { fetchLiveMarketBySlug } from "@/lib/market/fetch-markets";
import { fetchMarketPriceHistoryPoints } from "@/lib/market/market-price-history";
import { marketRecordToMarket } from "@/lib/market/market-record-adapter";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: Promise<{ id: string }>;
};

/** Legacy `/market/[id]` — `id` is treated as a market `slug` (same as `/markets/[slug]`). */
export default async function LegacyMarketPage({ params }: PageProps) {
  const t0 = Date.now();
  const { id } = await params;
  const record = await fetchLiveMarketBySlug(decodeURIComponent(id));
  if (!record) notFound();

  const base = marketRecordToMarket(record, 0);
  const decodedSlug = decodeURIComponent(id);
  const chartFetchedAt = Date.now();
  const chartPoints = await fetchMarketPriceHistoryPoints(decodedSlug);
  const initialChartHistory = chartPoints.map(({ t, p }) => ({ t, p }));

  if (process.env.NODE_ENV === "development") {
    console.info("[predicted][market-page-server]", {
      slug: decodedSlug,
      ms: Date.now() - t0,
      chartHistoryPoints: initialChartHistory.length,
    });
  }
  return (
    <MarketDetailView
      market={base}
      initialChartHistory={initialChartHistory}
      chartHistoryServerFetchedAtMs={chartFetchedAt}
    />
  );
}

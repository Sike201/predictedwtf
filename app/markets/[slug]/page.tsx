import { notFound } from "next/navigation";
import { MarketDetailView } from "@/components/market/market-detail-view";
import { fetchLiveMarketBySlug } from "@/lib/market/fetch-markets";
import { fetchMarketPriceHistoryPoints } from "@/lib/market/market-price-history";
import { logMarketTraceServer } from "@/lib/market/detail-trading-surface";
import { marketRecordToMarket } from "@/lib/market/market-record-adapter";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = { params: Promise<{ slug: string }> };

export default async function MarketBySlugPage({ params }: PageProps) {
  const t0 = Date.now();
  const { slug } = await params;
  const record = await fetchLiveMarketBySlug(decodeURIComponent(slug));
  if (!record) notFound();

  const base = marketRecordToMarket(record, 0);
  const tTrace = Date.now();
  logMarketTraceServer({
    where: "app/markets/[slug]/page.tsx",
    record,
    market: base,
    nowMs: tTrace,
  });
  const chartFetchedAt = Date.now();
  const chartPoints = await fetchMarketPriceHistoryPoints(decodeURIComponent(slug));
  const initialChartHistory = chartPoints.map(({ t, p }) => ({ t, p }));

  if (process.env.NODE_ENV === "development") {
    console.info("[predicted][market-page-server]", {
      slug: decodeURIComponent(slug),
      ms: Date.now() - t0,
      rscSnapshotVolumeUsd: base.snapshot.volumeUsd,
      lastStatsUpdatedAt: base.lastStatsUpdatedAt ?? null,
      rowLastKnownVol: record.last_known_volume_usd,
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

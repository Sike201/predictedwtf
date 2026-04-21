"use client";

import { useEffect, useRef } from "react";
import { MarketChartOrderbookSection } from "@/components/market/market-chart-orderbook-section";
import type { MarketPriceHistoryControls } from "@/lib/hooks/use-market-price-history";
import type { LiveOmnipairPoolState } from "@/lib/hooks/use-live-omnipair-pool";
import type { Market } from "@/lib/types/market";

type Props = {
  market: Market;
  tradingBinary: boolean;
  livePool: Pick<
    LiveOmnipairPoolState,
    "yesProbability" | "noProbability" | "unavailable" | "oneSidedLiquidity" | "refreshEpoch"
  >;
  /** Owning page instantiates the hook so trades can POST before lazy chart mounts. */
  priceHistory: MarketPriceHistoryControls;
};

export function MarketChartBlock({
  market,
  tradingBinary,
  livePool,
  priceHistory,
}: Props) {
  const autoRepairOnce = useRef(false);

  useEffect(() => {
    if (!tradingBinary || priceHistory.loading) return;
    if (priceHistory.series.length > 1) return;
    if (autoRepairOnce.current) return;
    autoRepairOnce.current = true;

    void fetch("/api/market/chart-history-repair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: market.id, mode: "auto" }),
    })
      .then((r) => r.json())
      .then((j: { ok?: boolean; ran?: boolean }) => {
        if (j?.ok && j?.ran) {
          void priceHistory.refetch();
        }
      })
      .catch(() => {
        /* ignore */
      });
  }, [
    tradingBinary,
    market.id,
    priceHistory.loading,
    priceHistory.series.length,
    priceHistory.refetch,
  ]);

  return (
    <MarketChartOrderbookSection
      market={market}
      series={priceHistory.series}
      sparseHistory={priceHistory.sparseHistory}
      historyLoading={priceHistory.loading}
      {...(tradingBinary
        ? {
            liveYesProbability: livePool.yesProbability,
            liveNoProbability: livePool.noProbability,
            livePriceUnavailable: livePool.unavailable,
            oneSidedLiquidity: livePool.oneSidedLiquidity,
            liveRefreshEpoch: livePool.refreshEpoch,
          }
        : {})}
    />
  );
}

"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Market } from "@/lib/types/market";
import {
  MarketDetailView,
  type GroupedChartRenderContext,
} from "@/components/market/market-detail-view";
import { MarketChartOrderbookSection } from "@/components/market/market-chart-orderbook-section";
import { outcomeLabelFromMarket } from "@/lib/market/group-feed-markets";
import {
  OutcomeSelectorDropdown,
  type OutcomeDropdownOption,
} from "@/components/markets/outcome-selector-dropdown";

type GroupedMarketPageProps = {
  groupKey: string;
  title: string;
  markets: Market[];
};

function shortQuestionFallback(question: string): string {
  const trimmed = question.trim();
  return trimmed.length > 42 ? `${trimmed.slice(0, 42).trim()}…` : trimmed;
}

function outcomeName(market: Market): string {
  return outcomeLabelFromMarket(market) ?? shortQuestionFallback(market.question);
}

export function GroupedMarketPage({
  groupKey: _groupKey,
  title,
  markets,
}: GroupedMarketPageProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qSlug = searchParams.get("m");

  const selected = useMemo(() => {
    if (qSlug && markets.some((m) => m.id === qSlug)) {
      return markets.find((m) => m.id === qSlug)!;
    }
    return markets[0] ?? null;
  }, [markets, qSlug]);

  const setSelectedSlug = useCallback(
    (slug: string) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set("m", slug);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const selectorOptions = useMemo<OutcomeDropdownOption[]>(
    () =>
      markets.map((market) => ({
        id: market.id,
        label: outcomeName(market),
        imageUrl: market.imageUrl,
        yesProbability: market.pool?.yesPrice ?? market.yesProbability,
      })),
    [markets],
  );

  const renderGroupedChart = useCallback((ctx: GroupedChartRenderContext) => {
    return (
      <MarketChartOrderbookSection
        market={ctx.market}
        series={ctx.priceHistory.series}
        sparseHistory={ctx.priceHistory.sparseHistory}
        historyLoading={ctx.priceHistory.loading}
        chartTooltipSubtitle={outcomeName(ctx.market)}
        liveYesProbability={ctx.livePool.yesProbability}
        liveNoProbability={ctx.livePool.noProbability}
        livePriceUnavailable={ctx.livePool.unavailable}
        oneSidedLiquidity={ctx.livePool.oneSidedLiquidity}
        liveRefreshEpoch={ctx.livePool.refreshEpoch}
      />
    );
  }, []);

  if (!selected || markets.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-zinc-500">
        No outcomes in this event.
      </p>
    );
  }

  return (
    <MarketDetailView
      key={selected.id}
      market={selected}
      embeddedInEvent
      eventPageTitle={title}
      renderGroupedChart={renderGroupedChart}
      eventSidebarLead={
        <OutcomeSelectorDropdown
          options={selectorOptions}
          selectedId={selected.id}
          onSelect={setSelectedSlug}
        />
      }
    />
  );
}

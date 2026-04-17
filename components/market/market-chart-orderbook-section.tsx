"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatedChancePct } from "@/components/market/animated-chance-pct";
import { ProbabilityChart } from "@/components/market/probability-chart";
import { MarketOrderbookPanel } from "@/components/market/market-orderbook-panel";
import type { Market } from "@/lib/types/market";
import { cn } from "@/lib/utils/cn";

const RANGES = ["1H", "6H", "1D", "1W", "1M", "ALL"] as const;

type MainTab = "chart" | "orderbook";

/** DB snapshots + optional render-only live tail (not persisted). */
export type ChartRenderPoint = {
  t: number;
  p: number;
  _liveTail?: boolean;
};

function normalizeHistoryPoint(raw: {
  t?: unknown;
  p?: unknown;
}): { t: number; p: number } | null {
  const t = typeof raw.t === "number" ? raw.t : Number(raw.t);
  const p = typeof raw.p === "number" ? raw.p : Number(raw.p);
  if (!Number.isFinite(t) || !Number.isFinite(p)) return null;
  return { t, p };
}

type Props = {
  market: Market;
  series: { t: number; p: number }[];
  sparseHistory?: boolean;
  historyLoading?: boolean;
  liveYesProbability?: number | null;
  liveNoProbability?: number | null;
  livePriceUnavailable?: boolean;
  oneSidedLiquidity?: boolean;
  /** Bumps when pool RPC read succeeds — recomputes live tail timestamp. */
  liveRefreshEpoch?: number;
};

export function MarketChartOrderbookSection({
  market,
  series,
  sparseHistory,
  historyLoading,
  liveYesProbability,
  liveNoProbability,
  livePriceUnavailable,
  oneSidedLiquidity,
  liveRefreshEpoch = 0,
}: Props) {
  const [main, setMain] = useState<MainTab>("chart");
  const [range, setRange] = useState<(typeof RANGES)[number]>("1D");
  const [cachedSeries, setCachedSeries] = useState<{ t: number; p: number }[]>(series);
  /** Wall-clock tick so the live tail’s x = “now” advances even if YES% is unchanged. */
  const [chartClock, setChartClock] = useState(() => Date.now());

  const hasLiveInputs =
    liveYesProbability !== undefined &&
    liveNoProbability !== undefined &&
    livePriceUnavailable !== undefined &&
    oneSidedLiquidity !== undefined;

  const staticYes = market.pool?.yesPrice ?? market.yesProbability;
  const staticNo = market.pool?.noPrice ?? 1 - market.yesProbability;

  const useLive =
    hasLiveInputs &&
    !livePriceUnavailable &&
    !oneSidedLiquidity &&
    liveYesProbability !== null &&
    liveNoProbability !== null;

  const yesP = useLive ? (liveYesProbability as number) : staticYes;
  const noP = useLive ? (liveNoProbability as number) : staticNo;
  const yesCents = Math.round(yesP * 100);
  const noCents = Math.round(noP * 100);

  const midPriceUnavailable =
    !!market.pool && livePriceUnavailable === true;

  useEffect(() => {
    setCachedSeries(series);
  }, [series]);

  useEffect(() => {
    const id = window.setInterval(() => setChartClock(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const normalizedHistory = useMemo(() => {
    const out: { t: number; p: number }[] = [];
    for (const raw of cachedSeries) {
      const n = normalizeHistoryPoint(raw);
      if (n) out.push(n);
    }
    return out;
  }, [cachedSeries]);

  const filteredHistory = useMemo(() => {
    if (range === "ALL") return normalizedHistory;
    const now = Date.now();
    const windowMs: Record<(typeof RANGES)[number], number> = {
      "1H": 60 * 60 * 1000,
      "6H": 6 * 60 * 60 * 1000,
      "1D": 24 * 60 * 60 * 1000,
      "1W": 7 * 24 * 60 * 60 * 1000,
      "1M": 30 * 24 * 60 * 60 * 1000,
      ALL: Number.POSITIVE_INFINITY,
    };
    const cut = now - windowMs[range];
    return normalizedHistory.filter((p) => p.t >= cut);
  }, [normalizedHistory, range]);

  const chartRenderSeries: ChartRenderPoint[] = useMemo(() => {
    if (!useLive || liveYesProbability == null) {
      return filteredHistory.map((p) => ({ ...p }));
    }

    const y = liveYesProbability;
    let tailT = Date.now();
    const last = filteredHistory[filteredHistory.length - 1];
    if (last && tailT <= last.t) {
      tailT = last.t + 1;
    }

    return [
      ...filteredHistory.map((p) => ({ ...p })),
      { t: tailT, p: y, _liveTail: true },
    ];
  }, [
    filteredHistory,
    useLive,
    liveYesProbability,
    chartClock,
    liveRefreshEpoch,
  ]);

  const chartSeriesForSvg = useMemo(
    () => chartRenderSeries.map(({ t, p }) => ({ t, p })),
    [chartRenderSeries],
  );

  const chartTopYesPct = useMemo(() => {
    const last = chartRenderSeries[chartRenderSeries.length - 1];
    if (last) return Math.round(last.p * 100);
    if (
      useLive &&
      liveYesProbability != null &&
      liveNoProbability != null
    ) {
      return Math.round(liveYesProbability * 100);
    }
    return null;
  }, [
    chartRenderSeries,
    useLive,
    liveYesProbability,
    liveNoProbability,
  ]);

  const hasRenderableChart = chartRenderSeries.length > 0;
  const showHistoryLoading =
    historyLoading && cachedSeries.length === 0;

  const chartDrawEpoch = useMemo(
    () =>
      `${filteredHistory.length}-${range}-${liveRefreshEpoch}-${historyLoading ? "l" : "r"}`,
    [filteredHistory.length, range, liveRefreshEpoch, historyLoading],
  );

  const chartShell = (
    <>
      {main === "chart" ? (
        <>
          <div className="px-0 pt-1 pb-2 sm:px-0">
            <p className="text-3xl font-semibold tabular-nums tracking-tight text-white">
              <AnimatedChancePct key={market.id} value={chartTopYesPct} />
              <span className="ml-1.5 text-base font-normal text-zinc-500">
                chance
              </span>
            </p>
          </div>
          {showHistoryLoading ? (
            <div className="flex min-h-[240px] items-center justify-center text-[13px] text-zinc-500">
              Loading chart…
            </div>
          ) : !hasRenderableChart ? (
            <div className="flex min-h-[200px] items-center justify-center text-[13px] text-zinc-500">
              {useLive && liveYesProbability != null
                ? "No snapshot history yet — pool mid will appear once trades are recorded."
                : "No on-chain price history yet. Trade to record snapshots."}
            </div>
          ) : (
            <div className="space-y-2">
              {sparseHistory ? (
                <p className="text-[11px] leading-snug text-zinc-600">
                  Not enough trades yet for full history — real pool snapshots
                  only.
                </p>
              ) : null}
              <ProbabilityChart
                series={chartSeriesForSvg}
                drawEpoch={chartDrawEpoch}
              />
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-1 px-0 py-1">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-medium transition",
                  range === r
                    ? "bg-white/[0.08] text-zinc-100"
                    : "text-zinc-600 hover:text-zinc-400",
                )}
              >
                {r}
              </button>
            ))}
          </div>
        </>
      ) : (
        <MarketOrderbookPanel
          marketSlug={market.id}
          yesMidCents={yesCents}
          noMidCents={noCents}
          midPriceUnavailable={midPriceUnavailable}
          oneSidedLiquidity={oneSidedLiquidity === true}
        />
      )}
    </>
  );

  return (
    <div className="overflow-visible">
      <div className="flex items-center justify-end gap-1.5 pb-3">
        <button
          type="button"
          onClick={() => setMain("chart")}
          className={cn(
            "rounded-full px-3 py-1.5 text-[12px] font-medium transition",
            main === "chart"
              ? "bg-white/[0.08] text-white"
              : "text-zinc-500 hover:text-zinc-300",
          )}
        >
          Chart
        </button>
        <button
          type="button"
          onClick={() => setMain("orderbook")}
          className={cn(
            "rounded-full px-3 py-1.5 text-[12px] font-medium transition",
            main === "orderbook"
              ? "bg-white/[0.08] text-white"
              : "text-zinc-500 hover:text-zinc-300",
          )}
        >
          Orderbook
        </button>
      </div>

      {chartShell}
    </div>
  );
}

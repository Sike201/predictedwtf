"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatedChancePct } from "@/components/market/animated-chance-pct";
import { ProbabilityChart } from "@/components/market/probability-chart";
import { MarketOrderbookPanel } from "@/components/market/market-orderbook-panel";
import {
  buildPathSeriesForTimeDomain,
  evenTimeTicks,
  xAxisTickCountForRange,
} from "@/lib/chart/time-series-path";
import { getResolvedBinaryDisplayPrices } from "@/lib/market/resolved-binary-prices";
import type { Market } from "@/lib/types/market";
import { cn } from "@/lib/utils/cn";

const RANGES = ["1H", "6H", "1D", "1W", "1M", "ALL"] as const;

const CHART_TF_LOG = "[predicted][chart-timeframe]";
const CHART_SERIES_LOG = "[predicted][chart-series]";
const CHART_TIME_PLACEMENT_LOG = "[predicted][chart-time-placement]";
const CHART_HYDRATE = "[predicted][chart-hydrate]";
const RESOLVED_CHART_CLAMP_LOG = "[predicted][resolved-chart-clamp]";
const CHART_FLAT_FALLBACK_LOG = "[predicted][chart-flat-fallback]";

type MainTab = "chart" | "orderbook";

/** DB snapshots + optional render-only live tail (not persisted). */
export type ChartRenderPoint = {
  t: number;
  p: number;
  _liveTail?: boolean;
  _anchor?: boolean;
};

/** Normalize JSON / DB timestamps to epoch milliseconds (avoids seconds vs ms mixups). */
function coerceHistoryTimeMs(t: number): number {
  if (!Number.isFinite(t)) return t;
  const x = Math.trunc(t);
  if (x > 0 && x < 1_000_000_000_000) return x * 1000;
  return x;
}

function normalizeHistoryPoint(raw: {
  t?: unknown;
  p?: unknown;
}): { t: number; p: number } | null {
  const tRaw = typeof raw.t === "number" ? raw.t : Number(raw.t);
  const p = typeof raw.p === "number" ? raw.p : Number(raw.p);
  const t = coerceHistoryTimeMs(tRaw);
  if (!Number.isFinite(t) || !Number.isFinite(p)) return null;
  return { t, p };
}

/** Epoch ms for market.createdAt (DB is ISO-parsed ms). */
function marketCreatedAtMs(market: Market): number | null {
  const c = market.createdAt;
  if (c == null || !Number.isFinite(c)) return null;
  const x = Math.trunc(c);
  if (x > 0 && x < 1_000_000_000_000) return x * 1000;
  return x;
}

/**
 * Rolling window start clamped so we never show empty time before the market existed:
 * max(requestedStart, marketCreatedAt, firstHistoryPoint).
 */
function effectiveRollingVisibleStartMs(params: {
  endMs: number;
  windowMs: number;
  marketCreatedAt: number | null;
  firstHistoryT: number | null;
}): {
  requestedStartMs: number;
  marketCreatedAtMs: number | null;
  firstHistoryPointAtMs: number | null;
  effectiveStartMs: number;
} {
  const { endMs, windowMs, marketCreatedAt, firstHistoryT } = params;
  const requestedStartMs = endMs - windowMs;
  let effectiveStartMs = requestedStartMs;
  if (marketCreatedAt != null) {
    effectiveStartMs = Math.max(effectiveStartMs, marketCreatedAt);
  }
  if (firstHistoryT != null) {
    effectiveStartMs = Math.max(effectiveStartMs, firstHistoryT);
  }
  if (effectiveStartMs >= endMs) {
    effectiveStartMs = Math.max(requestedStartMs, endMs - 60_000);
  }
  return {
    requestedStartMs,
    marketCreatedAtMs: marketCreatedAt,
    firstHistoryPointAtMs: firstHistoryT,
    effectiveStartMs,
  };
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
  sparseHistory: _sparseHistory,
  historyLoading,
  liveYesProbability,
  liveNoProbability,
  livePriceUnavailable,
  oneSidedLiquidity,
  liveRefreshEpoch = 0,
}: Props) {
  const sectionMountPerfRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (sectionMountPerfRef.current == null && typeof performance !== "undefined") {
      sectionMountPerfRef.current = performance.now();
    }
  }, []);

  const firstRenderableChartLogged = useRef(false);

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

  const resolvedDisplay = useMemo(
    () => getResolvedBinaryDisplayPrices(market),
    [market],
  );
  const resolvedAtMs = useMemo(() => {
    const raw = market.resolution.resolvedAt;
    if (raw == null) return Number.NaN;
    const t = Date.parse(String(raw));
    return Number.isFinite(t) && t > 0 ? t : Number.NaN;
  }, [market.resolution.resolvedAt]);

  /**
   * Chronological order. When resolved: drop any post-`resolvedAt` DB rows, then
   * append a single terminal point at `resolvedAt` with YES = 0 or 1 (no live bounces after).
   */
  const { normalizedHistory, resolvedChartClamp } = useMemo(() => {
    const out: { t: number; p: number }[] = [];
    for (const raw of cachedSeries) {
      const n = normalizeHistoryPoint(raw);
      if (n) out.push(n);
    }
    out.sort((a, b) => a.t - b.t);
    if (!resolvedDisplay || !Number.isFinite(resolvedAtMs) || resolvedAtMs <= 0) {
      return { normalizedHistory: out, resolvedChartClamp: null };
    }
    const removedPostResolutionPointsCount = out.filter(
      (p) => p.t > resolvedAtMs,
    ).length;
    const before = out.filter((p) => p.t < resolvedAtMs);
    const finalP = resolvedDisplay.yes;
    const merged = [...before, { t: resolvedAtMs, p: finalP }].sort(
      (a, b) => a.t - b.t,
    );
    return {
      normalizedHistory: merged,
      resolvedChartClamp: {
        removedPostResolutionPointsCount,
        finalClampedValue: finalP,
        resolvedAt: String(market.resolution.resolvedAt),
        resolvedOutcome: resolvedDisplay.winningOutcome,
      },
    };
  }, [cachedSeries, market.resolution.resolvedAt, resolvedAtMs, resolvedDisplay]);

  const lastResolvedClampKey = useRef<string | null>(null);
  useEffect(() => {
    if (!resolvedChartClamp) {
      lastResolvedClampKey.current = null;
      return;
    }
    const key = [
      market.id,
      resolvedChartClamp.resolvedAt,
      String(resolvedChartClamp.finalClampedValue),
      String(resolvedChartClamp.removedPostResolutionPointsCount),
    ].join("\0");
    if (lastResolvedClampKey.current === key) return;
    lastResolvedClampKey.current = key;
    console.info(
      RESOLVED_CHART_CLAMP_LOG,
      JSON.stringify({
        slug: market.id,
        resolvedOutcome: resolvedChartClamp.resolvedOutcome,
        resolvedAt: resolvedChartClamp.resolvedAt,
        finalClampedValue: resolvedChartClamp.finalClampedValue,
        removedPostResolutionPointsCount:
          resolvedChartClamp.removedPostResolutionPointsCount,
        liveTailSuppressed: true,
      }),
    );
  }, [market.id, resolvedChartClamp]);

  const earliestHistoryPointTs = useMemo(() => {
    if (normalizedHistory.length === 0) return null;
    return normalizedHistory[0]!.t;
  }, [normalizedHistory]);

  const windowMsForRange = useMemo((): Record<(typeof RANGES)[number], number> => {
    return {
      "1H": 60 * 60 * 1000,
      "6H": 6 * 60 * 60 * 1000,
      "1D": 24 * 60 * 60 * 1000,
      "1W": 7 * 24 * 60 * 60 * 1000,
      "1M": 30 * 24 * 60 * 60 * 1000,
      ALL: Number.POSITIVE_INFINITY,
    };
  }, []);

  const createdAtMs = useMemo(() => marketCreatedAtMs(market), [market]);

  const { cutMs, inWindowHistory, anchorPoint, rollingDomainMeta } = useMemo(() => {
    if (range === "ALL") {
      return {
        cutMs: null as number | null,
        inWindowHistory: normalizedHistory,
        anchorPoint: null as { t: number; p: number } | null,
        rollingDomainMeta: null as ReturnType<
          typeof effectiveRollingVisibleStartMs
        > | null,
      };
    }
    const nowMs = Date.now();
    const win = windowMsForRange[range];
    const { effectiveStartMs, ...meta } = effectiveRollingVisibleStartMs({
      endMs: nowMs,
      windowMs: win,
      marketCreatedAt: createdAtMs,
      firstHistoryT: earliestHistoryPointTs,
    });
    const cut = effectiveStartMs;
    const inWin: { t: number; p: number }[] = [];
    let anchor: { t: number; p: number } | null = null;
    for (const p of normalizedHistory) {
      if (p.t >= cut) inWin.push(p);
      else anchor = p;
    }
    return {
      cutMs: cut,
      inWindowHistory: inWin,
      anchorPoint: anchor,
      rollingDomainMeta: { ...meta, effectiveStartMs },
    };
  }, [
    earliestHistoryPointTs,
    normalizedHistory,
    range,
    windowMsForRange,
    chartClock,
    createdAtMs,
  ]);

  /** Distinct persisted knots (anchor + in-window) used before live tail — not counting live tail. */
  const pathInputKnotCount = useMemo(() => {
    if (range === "ALL") {
      return normalizedHistory.length;
    }
    if (inWindowHistory.length === 0 && anchorPoint == null) return 0;
    let c = inWindowHistory.length;
    if (anchorPoint) {
      if (inWindowHistory.length > 0) {
        if (anchorPoint.t !== inWindowHistory[0]!.t) c += 1;
      } else {
        c += 1;
      }
    }
    return c;
  }, [range, normalizedHistory.length, inWindowHistory, anchorPoint]);

  const renderYesPrice =
    useLive && liveYesProbability != null ? liveYesProbability : yesP;
  const chartEndYesPrice = useMemo(
    () =>
      resolvedDisplay != null
        ? resolvedDisplay.yes
        : (renderYesPrice as number),
    [renderYesPrice, resolvedDisplay],
  );

  const validChartEnd =
    Number.isFinite(chartEndYesPrice) &&
    chartEndYesPrice >= 0 &&
    chartEndYesPrice <= 1;

  /** Fewer than 2 real samples: draw a flat line at current YES probability (no implied baseline jump). */
  const chartFlatHistoryFallback =
    !resolvedDisplay && validChartEnd && pathInputKnotCount < 2;

  const notEnoughRecentTrades =
    range !== "ALL" &&
    inWindowHistory.length === 0 &&
    anchorPoint == null &&
    !chartFlatHistoryFallback;

  const canAppendLiveTail =
    !resolvedDisplay &&
    Number.isFinite(renderYesPrice) &&
    renderYesPrice >= 0 &&
    renderYesPrice <= 1;

  const chartRenderSeries: ChartRenderPoint[] = useMemo(() => {
    if (notEnoughRecentTrades) return [];

    const base: ChartRenderPoint[] = [];
    if (anchorPoint) {
      if (inWindowHistory.length > 0) {
        const first = inWindowHistory[0]!;
        if (anchorPoint.t !== first.t) {
          base.push({ ...anchorPoint, _anchor: true });
        }
      } else {
        base.push({ ...anchorPoint, _anchor: true });
      }
    }
    for (const p of inWindowHistory) {
      base.push({ ...p });
    }

    const shouldAppendLive =
      !chartFlatHistoryFallback &&
      canAppendLiveTail &&
      (base.length > 0 ||
        (range === "ALL" && normalizedHistory.length > 0));

    if (!shouldAppendLive) {
      return base;
    }

    const y = chartEndYesPrice;
    let tailT = Date.now();
    const last = base[base.length - 1];
    if (last && tailT <= last.t) {
      tailT = last.t + 1;
    }

    return [...base, { t: tailT, p: y, _liveTail: true }];
  }, [
    anchorPoint,
    chartFlatHistoryFallback,
    inWindowHistory,
    notEnoughRecentTrades,
    canAppendLiveTail,
    chartEndYesPrice,
    range,
    normalizedHistory.length,
    chartClock,
    liveRefreshEpoch,
  ]);

  /** Real DB/anchor points only — live pool price is applied via `endMs`/`endPrice`, not a duplicate vertex at "now". */
  const chartHistoryPointsForPath = useMemo(
    () =>
      chartRenderSeries
        .filter((p) => !p._liveTail)
        .map(({ t, p }) => ({ t, p })),
    [chartRenderSeries],
  );

  const chartPathPrep = useMemo(() => {
    const endMs = Date.now();
    if (notEnoughRecentTrades) return null;

    const pathPoints =
      chartFlatHistoryFallback ? [] : chartHistoryPointsForPath;

    let startMs: number;
    if (range === "ALL") {
      if (normalizedHistory.length === 0) {
        if (!chartFlatHistoryFallback || !validChartEnd) return null;
        const startMsAll = Math.min(
          createdAtMs ?? endMs - 86400000,
          endMs - 60_000,
        );
        const pathSeries = buildPathSeriesForTimeDomain({
          points: [],
          startMs: startMsAll,
          endMs,
          endPrice: chartEndYesPrice,
        });
        const span = endMs - startMsAll;
        const tickCount = xAxisTickCountForRange("ALL", span);
        const tickTimes = evenTimeTicks(startMsAll, endMs, tickCount);
        return {
          pathSeries,
          xDomain: { minT: startMsAll, maxT: endMs } as const,
          xTickCount: tickCount,
          tickTimes,
          livePointTs: endMs,
        };
      }
      startMs = normalizedHistory[0]!.t;
      const lastData = normalizedHistory[normalizedHistory.length - 1]!.t;
      const domainEnd = Math.max(lastData, endMs);
      if (domainEnd - startMs <= 0) return null;
      const pathSeries = buildPathSeriesForTimeDomain({
        points: pathPoints,
        startMs,
        endMs: domainEnd,
        endPrice: chartEndYesPrice,
      });
      const span = domainEnd - startMs;
      const tickCount = xAxisTickCountForRange("ALL", span);
      const tickTimes = evenTimeTicks(startMs, domainEnd, tickCount);
      return {
        pathSeries,
        xDomain: { minT: startMs, maxT: domainEnd } as const,
        xTickCount: tickCount,
        tickTimes,
        livePointTs: domainEnd,
      };
    }

    startMs = effectiveRollingVisibleStartMs({
      endMs,
      windowMs: windowMsForRange[range],
      marketCreatedAt: createdAtMs,
      firstHistoryT: earliestHistoryPointTs,
    }).effectiveStartMs;
    const pathSeries = buildPathSeriesForTimeDomain({
      points: pathPoints,
      startMs,
      endMs,
      endPrice: chartEndYesPrice,
    });
    const span = endMs - startMs;
    const tickCount = xAxisTickCountForRange(range, span);
    const tickTimes = evenTimeTicks(startMs, endMs, tickCount);
    return {
      pathSeries,
      xDomain: { minT: startMs, maxT: endMs } as const,
      xTickCount: tickCount,
      tickTimes,
      livePointTs: endMs,
    };
  }, [
    chartFlatHistoryFallback,
    chartHistoryPointsForPath,
    chartEndYesPrice,
    createdAtMs,
    earliestHistoryPointTs,
    notEnoughRecentTrades,
    normalizedHistory,
    range,
    validChartEnd,
    windowMsForRange,
    chartClock,
    liveRefreshEpoch,
  ]);

  const chartFlatFallbackLogKey = useRef<string | null>(null);
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    if (!chartFlatHistoryFallback || !chartPathPrep) return;
    const key = `${market.id}\0${range}\0${pathInputKnotCount}\0${chartPathPrep.pathSeries.length}`;
    if (chartFlatFallbackLogKey.current === key) return;
    chartFlatFallbackLogKey.current = key;
    console.info(
      CHART_FLAT_FALLBACK_LOG,
      "Chart fallback: insufficient history, rendering flat line.",
      JSON.stringify({
        slug: market.id,
        timeframe: range,
        pathInputKnotCount,
        endPrice: chartEndYesPrice,
      }),
    );
  }, [
    chartEndYesPrice,
    chartFlatHistoryFallback,
    chartPathPrep,
    market.id,
    pathInputKnotCount,
    range,
  ]);

  const chartSeriesLogRef = useRef<string | null>(null);
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const pathSeries = chartPathPrep?.pathSeries ?? [];
    const payload = {
      marketSlug: market.id,
      timeframe: range,
      /** Points from `useMarketPriceHistory` / API (full market history, not window-filtered). */
      historyPointsLoadedFromApi: normalizedHistory.length,
      rowsInsideSelectedTimeframe: inWindowHistory.length,
      anchorBeforeWindowIncluded: anchorPoint != null,
      liveTailIncluded:
        chartRenderSeries.some((p) => p._liveTail === true) && canAppendLiveTail,
      chartRenderPointCount: chartRenderSeries.length,
      pathSeriesPointCount: pathSeries.length,
      first10RenderedTimestampsIso: pathSeries
        .slice(0, 10)
        .map((p) => new Date(p.t).toISOString()),
      windowCutIso: cutMs != null ? new Date(cutMs).toISOString() : null,
      hint:
        "If historyPointsLoadedFromApi is low, check DB/API. If loaded is high but pathSeriesPointCount is low, inspect buildPathSeriesForTimeDomain / window cut.",
    };
    const key = JSON.stringify(payload);
    if (chartSeriesLogRef.current === key) return;
    chartSeriesLogRef.current = key;
    console.info(CHART_SERIES_LOG, payload);
  }, [
    anchorPoint,
    canAppendLiveTail,
    chartPathPrep?.pathSeries,
    chartRenderSeries,
    cutMs,
    inWindowHistory.length,
    market.id,
    normalizedHistory.length,
    range,
  ]);

  const chartTimePlacementLogRef = useRef<string | null>(null);
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    if (!chartPathPrep) return;
    const pathSeries = chartPathPrep.pathSeries;
    const hist = chartHistoryPointsForPath;
    const latestH = hist.length > 0 ? hist[hist.length - 1]! : null;
    const liveTailTs = chartPathPrep.xDomain.maxT;
    const liveTailPrice = chartEndYesPrice;
    const lastTwo = pathSeries.slice(-2);
    const latestTradeCollapsedIntoNow =
      pathSeries.length >= 2 &&
      pathSeries[pathSeries.length - 1]!.t === pathSeries[pathSeries.length - 2]!.t;
    const payload = {
      marketSlug: market.id,
      timeframe: range,
      historyTimestampsUsedIso: hist.map((p) => new Date(p.t).toISOString()),
      latestHistoryTs: latestH != null ? new Date(latestH.t).toISOString() : null,
      latestHistoryPrice: latestH?.p ?? null,
      liveTailTs: new Date(liveTailTs).toISOString(),
      liveTailPrice,
      renderedLastTwoPoints: lastTwo.map((p) => ({
        tIso: new Date(p.t).toISOString(),
        p: p.p,
      })),
      last10RenderedPoints: pathSeries.slice(-10).map((p) => ({
        tIso: new Date(p.t).toISOString(),
        p: p.p,
      })),
      latestTradeCollapsedIntoNow,
    };
    const key = JSON.stringify(payload);
    if (chartTimePlacementLogRef.current === key) return;
    chartTimePlacementLogRef.current = key;
    console.info(CHART_TIME_PLACEMENT_LOG, payload);
  }, [
    chartHistoryPointsForPath,
    chartPathPrep,
    chartEndYesPrice,
    market.id,
    range,
  ]);

  const chartDebugRef = useRef<string | null>(null);
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const first = chartRenderSeries[0];
    const last = chartRenderSeries[chartRenderSeries.length - 1];
    const roll = rollingDomainMeta;
    const payload = JSON.stringify({
      timeframe: range,
      visibleDomainStart: chartPathPrep
        ? new Date(chartPathPrep.xDomain.minT).toISOString()
        : null,
      visibleDomainEnd: chartPathPrep
        ? new Date(chartPathPrep.xDomain.maxT).toISOString()
        : null,
      requestedTimeframeStartIso:
        roll != null ? new Date(roll.requestedStartMs).toISOString() : null,
      marketCreatedAtIso:
        roll?.marketCreatedAtMs != null
          ? new Date(roll.marketCreatedAtMs).toISOString()
          : createdAtMs != null
            ? new Date(createdAtMs).toISOString()
            : null,
      firstHistoryPointAtIso:
        roll?.firstHistoryPointAtMs != null
          ? new Date(roll.firstHistoryPointAtMs).toISOString()
          : earliestHistoryPointTs != null
            ? new Date(earliestHistoryPointTs).toISOString()
            : null,
      effectiveVisibleStartIso:
        roll != null ? new Date(roll.effectiveStartMs).toISOString() : null,
      historyRowsLoaded: normalizedHistory.length,
      inWindowCount: inWindowHistory.length,
      firstSeriesTs: first ? new Date(first.t).toISOString() : null,
      lastSeriesTs: last ? new Date(last.t).toISOString() : null,
      anchorIncluded: chartRenderSeries.some((p) => p._anchor === true),
      liveTailAppended:
        chartRenderSeries.some((p) => p._liveTail === true) && canAppendLiveTail,
      livePointTs: chartPathPrep
        ? new Date(chartPathPrep.livePointTs).toISOString()
        : null,
      pathPointCount: chartPathPrep?.pathSeries.length ?? 0,
      xAxisTickValues:
        chartPathPrep?.tickTimes.map((t) => new Date(t).toISOString()) ?? [],
      cutIso: cutMs != null ? new Date(cutMs).toISOString() : null,
    });
    if (chartDebugRef.current === payload) return;
    chartDebugRef.current = payload;
    console.info(CHART_TF_LOG, payload);
  }, [
    canAppendLiveTail,
    chartPathPrep,
    chartRenderSeries,
    createdAtMs,
    cutMs,
    earliestHistoryPointTs,
    inWindowHistory.length,
    normalizedHistory,
    range,
    rollingDomainMeta,
  ]);

  /** Headline % must track live pool mid when available — not the last path vertex (can lag on static fallback). */
  const chartTopYesPct = useMemo(() => {
    if (
      useLive &&
      liveYesProbability != null &&
      liveNoProbability != null
    ) {
      return Math.round(liveYesProbability * 100);
    }
    if (chartFlatHistoryFallback && validChartEnd) {
      return Math.round(chartEndYesPrice * 100);
    }
    const last = chartRenderSeries[chartRenderSeries.length - 1];
    if (last) return Math.round(last.p * 100);
    return null;
  }, [
    chartEndYesPrice,
    chartFlatHistoryFallback,
    chartRenderSeries,
    useLive,
    liveYesProbability,
    liveNoProbability,
    liveRefreshEpoch,
    validChartEnd,
  ]);

  const chartHeadlineLogRef = useRef<string | null>(null);
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const staticYes = market.pool?.yesPrice ?? market.yesProbability;
    const usingStaticFallback = !useLive;
    const payload = JSON.stringify({
      marketId: market.id,
      poolAddress: market.pool?.poolId ?? null,
      useLive,
      liveYes: liveYesProbability,
      liveNo: liveNoProbability,
      unavailable: livePriceUnavailable,
      oneSided: oneSidedLiquidity,
      staticYesFallback: staticYes,
      chartTopYesPct,
      usingStaticFallback,
      fallbackReason: !hasLiveInputs
        ? "live_props_not_passed"
        : livePriceUnavailable
          ? "live_unavailable"
          : oneSidedLiquidity
            ? "one_sided_mid_hidden"
            : liveYesProbability == null
              ? "live_yes_null"
              : null,
      historyRowCount: normalizedHistory.length,
      liveRefreshEpoch,
    });
    if (chartHeadlineLogRef.current === payload) return;
    chartHeadlineLogRef.current = payload;
    console.info("[predicted][chart-headline]", payload);
  }, [
    chartTopYesPct,
    hasLiveInputs,
    liveNoProbability,
    livePriceUnavailable,
    liveRefreshEpoch,
    liveYesProbability,
    market.id,
    market.pool?.poolId,
    market.pool?.yesPrice,
    market.yesProbability,
    normalizedHistory.length,
    oneSidedLiquidity,
    useLive,
  ]);

  const hasRenderableLine =
    (chartPathPrep?.pathSeries.length ?? 0) >= 2;
  const hasRenderableChart =
    chartRenderSeries.length > 0 || chartFlatHistoryFallback;
  const showHistoryLoading =
    historyLoading && cachedSeries.length === 0;

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    if (firstRenderableChartLogged.current) return;
    if (!hasRenderableLine || !chartPathPrep) return;
    firstRenderableChartLogged.current = true;
    const t0 = sectionMountPerfRef.current;
    const ms =
      t0 != null && typeof performance !== "undefined"
        ? Math.round(performance.now() - t0)
        : null;
    console.info(CHART_HYDRATE, {
      event: "chart_time_to_first_render_ms",
      marketSlug: market.id,
      msSinceSectionMount: ms,
    });
  }, [hasRenderableLine, chartPathPrep, market.id]);

  const chartDrawEpoch = useMemo(
    () =>
      `${inWindowHistory.length}-${range}-${liveRefreshEpoch}-${historyLoading ? "l" : "r"}-${chartRenderSeries.length}-${chartFlatHistoryFallback ? "flat" : "n"}`,
    [
      chartFlatHistoryFallback,
      chartRenderSeries.length,
      historyLoading,
      inWindowHistory.length,
      liveRefreshEpoch,
      range,
    ],
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
          ) : notEnoughRecentTrades ? (
            <div className="flex min-h-[200px] items-center justify-center px-2 text-center text-[13px] text-zinc-500">
              Not enough recent trades for this timeframe
            </div>
          ) : !hasRenderableChart ? (
            <div className="flex min-h-[200px] items-center justify-center text-[13px] text-zinc-500">
              {useLive && liveYesProbability != null
                ? "No snapshot history yet — pool mid will appear once trades are recorded."
                : "No on-chain price history yet. Trade to record snapshots."}
            </div>
          ) : !hasRenderableLine ? (
            <div className="flex min-h-[200px] items-center justify-center px-2 text-center text-[13px] text-zinc-500">
              Not enough recent trades for this timeframe
            </div>
          ) : (
            <div className="space-y-2">
              {chartPathPrep ? (
                <ProbabilityChart
                  series={chartPathPrep.pathSeries}
                  xDomain={chartPathPrep.xDomain}
                  xTickCount={chartPathPrep.xTickCount}
                  drawEpoch={chartDrawEpoch}
                />
              ) : null}
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

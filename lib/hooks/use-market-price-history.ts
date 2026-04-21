"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { logChartPersist } from "@/lib/market/chart-persist-log";
import { logChartSnapshot } from "@/lib/market/chart-snapshot-log";
import type { VolumeTradeVerify } from "@/lib/market/volume-trade-verify";

type Point = { t: number; p: number };

const LP = "[predicted][use-market-price-history]";
const CHART_HYDRATE = "[predicted][chart-hydrate]";

/** Server snapshot older than this → background full replace (repair drift / missed rows). */
const STALE_FULL_REFRESH_MS = 5 * 60 * 1000;

function coerceHistoryTimeMs(t: number): number {
  if (!Number.isFinite(t)) return t;
  const x = Math.trunc(t);
  if (x > 0 && x < 1_000_000_000_000) return x * 1000;
  return x;
}

function normalizePoints(
  raw: Array<{ t: number; p: number } | { t: unknown; p: unknown }>,
): Point[] {
  const out: Point[] = [];
  for (const x of raw) {
    const tRaw = typeof x.t === "number" ? x.t : Number(x.t);
    const t = coerceHistoryTimeMs(tRaw);
    const p = typeof x.p === "number" ? x.p : Number(x.p);
    if (!Number.isFinite(t) || !Number.isFinite(p)) continue;
    out.push({ t, p });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

function mergeByT(a: Point[], b: Point[]): Point[] {
  const map = new Map<number, Point>();
  for (const p of a) map.set(p.t, p);
  for (const p of b) map.set(p.t, p);
  return [...map.values()].sort((x, y) => x.t - y.t);
}

async function fetchHistoryFull(slug: string): Promise<Point[]> {
  const res = await fetch(
    `/api/market/price-history?slug=${encodeURIComponent(slug)}`,
    { cache: "no-store" },
  );
  if (!res.ok) {
    console.warn(`${LP} GET failed`, res.status);
    return [];
  }
  const data = (await res.json()) as {
    points?: Array<{ t: number; p: number }>;
    mode?: string;
  };
  const raw = data.points ?? [];
  return normalizePoints(raw);
}

async function fetchHistoryIncremental(
  slug: string,
  sinceMsExclusive: number,
): Promise<Point[]> {
  const u = new URL("/api/market/price-history", window.location.origin);
  u.searchParams.set("slug", slug);
  u.searchParams.set("sinceTs", String(sinceMsExclusive));
  const res = await fetch(u.toString(), { cache: "no-store" });
  if (!res.ok) {
    console.warn(`${LP} GET incremental failed`, res.status);
    return [];
  }
  const data = (await res.json()) as {
    points?: Array<{ t: number; p: number }>;
    mode?: string;
  };
  return normalizePoints(data.points ?? []);
}

/**
 * Loads `market_price_history` — optional SSR `initialSeries` for instant first paint.
 */
export type MarketPriceHistoryControls = ReturnType<
  typeof useMarketPriceHistory
>;

export function useMarketPriceHistory(params: {
  slug: string;
  /** RSC snapshot — chart renders immediately without waiting for client fetch. */
  initialSeries?: { t: number; p: number }[];
  /** Server time when `initialSeries` was read (Date.now() in page loader). */
  chartHistoryServerFetchedAtMs?: number;
}) {
  const { slug, initialSeries, chartHistoryServerFetchedAtMs } = params;

  const hadSsrProp = initialSeries !== undefined;
  const [series, setSeries] = useState<Point[]>(() =>
    hadSsrProp ? normalizePoints(initialSeries!) : [],
  );
  const [loading, setLoading] = useState(() => !hadSsrProp);

  const seriesRef = useRef(series);
  seriesRef.current = series;

  /** Frozen SSR snapshot for this slug — background refresh reads once (no re-run on parent re-render). */
  const bgInputRef = useRef<{
    slug: string;
    base: Point[];
    fetchedAt: number | null;
    hadSsr: boolean;
  } | null>(null);
  if (!bgInputRef.current || bgInputRef.current.slug !== slug) {
    bgInputRef.current = {
      slug,
      base: initialSeries !== undefined ? normalizePoints(initialSeries) : [],
      fetchedAt: chartHistoryServerFetchedAtMs ?? null,
      hadSsr: initialSeries !== undefined,
    };
  }

  const initialSeriesRef = useRef(initialSeries);
  initialSeriesRef.current = initialSeries;

  /** Reset series when navigating to another market (RSC snapshot is per slug). */
  useEffect(() => {
    const cur = initialSeriesRef.current;
    if (cur !== undefined) {
      setSeries(normalizePoints(cur));
      setLoading(false);
    } else {
      setSeries([]);
      setLoading(true);
    }
  }, [slug]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cur = seriesRef.current;
      const lastTs =
        cur.length > 0 ? cur[cur.length - 1]!.t : undefined;
      if (lastTs != null && cur.length > 0) {
        const inc = await fetchHistoryIncremental(slug, lastTs);
        if (inc.length > 0) {
          setSeries((prev) => mergeByT(prev, inc));
          if (process.env.NODE_ENV === "development") {
            console.info(CHART_HYDRATE, {
              event: "refetch_merge",
              slug,
              strategy: "incremental_patch",
              appendedCount: inc.length,
            });
          }
          return;
        }
      }
      const full = await fetchHistoryFull(slug);
      setSeries(full);
      if (process.env.NODE_ENV === "development") {
        console.info(CHART_HYDRATE, {
          event: "refetch_merge",
          slug,
          strategy: "full_replace",
          pointCount: full.length,
        });
      }
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    if (!hadSsrProp) {
      void load();
    }
  }, [hadSsrProp, load]);

  /** Background refresh after first paint (no artificial delay). Runs once per slug. */
  useEffect(() => {
    if (typeof window === "undefined") return;

    const snap = bgInputRef.current;
    if (!snap || snap.slug !== slug) return;

    const usedCachedOnFirstPaint = snap.hadSsr;
    const cachedCount = snap.base.length;
    const latestCachedTs =
      cachedCount > 0
        ? new Date(snap.base[cachedCount - 1]!.t).toISOString()
        : null;

    if (process.env.NODE_ENV === "development") {
      console.info(CHART_HYDRATE, {
        event: "first_paint_context",
        slug,
        usedCachedChartOnFirstPaint: usedCachedOnFirstPaint,
        cachedPointCount: cachedCount,
        latestCachedTimestampIso: latestCachedTs,
        chartHistoryServerFetchedAtMs: snap.fetchedAt,
      });
    }

    let cancelled = false;
    const bgStartedAt =
      typeof performance !== "undefined" ? performance.now() : 0;

    const run = async () => {
      if (process.env.NODE_ENV === "development") {
        console.info(CHART_HYDRATE, {
          event: "background_refresh_started",
          slug,
        });
      }

      const base = snap.base;
      const serverAgeMs =
        snap.fetchedAt != null
          ? Date.now() - snap.fetchedAt
          : Number.POSITIVE_INFINITY;
      const stale = serverAgeMs > STALE_FULL_REFRESH_MS;

      try {
        if (base.length === 0) {
          const full = await fetchHistoryFull(slug);
          if (cancelled) return;
          setSeries(full);
          if (process.env.NODE_ENV === "development") {
            console.info(CHART_HYDRATE, {
              event: "background_refresh_done",
              slug,
              strategy: "full_replace",
              reason: "no_ssr_points",
              appendedOrReplacedCount: full.length,
              timeToRefreshMs: Math.round(
                (typeof performance !== "undefined"
                  ? performance.now()
                  : 0) - bgStartedAt,
              ),
            });
          }
          return;
        }

        if (stale) {
          const full = await fetchHistoryFull(slug);
          if (cancelled) return;
          setSeries(full);
          if (process.env.NODE_ENV === "development") {
            console.info(CHART_HYDRATE, {
              event: "background_refresh_done",
              slug,
              strategy: "full_replace",
              reason: "stale_server_snapshot",
              serverAgeMs: Math.round(serverAgeMs),
              pointCount: full.length,
              fullReplaceVsIncrementalPatch: "full_replace",
            });
          }
          return;
        }

        const lastT = base[base.length - 1]!.t;
        const inc = await fetchHistoryIncremental(slug, lastT);
        if (cancelled) return;

        if (inc.length > 0) {
          setSeries((prev) => mergeByT(prev, inc));
          if (process.env.NODE_ENV === "development") {
            console.info(CHART_HYDRATE, {
              event: "background_refresh_done",
              slug,
              strategy: "incremental_patch",
              appendedPointsCount: inc.length,
              fullReplaceVsIncrementalPatch: "incremental_patch",
              timeToRefreshMs: Math.round(
                (typeof performance !== "undefined"
                  ? performance.now()
                  : 0) - bgStartedAt,
              ),
            });
          }
        } else if (process.env.NODE_ENV === "development") {
          console.info(CHART_HYDRATE, {
            event: "background_refresh_done",
            slug,
            strategy: "noop",
            appendedPointsCount: 0,
            fullReplaceVsIncrementalPatch: "incremental_patch",
            note: "no new rows after latest cached ts",
          });
        }
      } catch (e) {
        if (process.env.NODE_ENV === "development") {
          console.warn(CHART_HYDRATE, {
            event: "background_refresh_error",
            slug,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    };

    const id = requestAnimationFrame(() => {
      void run();
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, [slug]);

  const sparseHistory = useMemo(() => series.length < 3, [series.length]);

  const recordAfterTrade = useCallback(
    async (txSignature: string): Promise<VolumeTradeVerify | undefined> => {
      const t0 = typeof performance !== "undefined" ? performance.now() : 0;
      let verify: VolumeTradeVerify | undefined;
      logChartSnapshot("recordAfterTrade_called", {
        slug,
        txSignature,
        queryKey: "slug",
        note: "Must match markets.slug — pass market.id from adapter",
      });
      logChartPersist("recordAfterTrade_called", { slug, txSignature });
      try {
        console.info("[predicted][buy-volume-trace] client_success", {
          step: "POST /api/market/price-history sent",
          slug,
          txSignature,
        });
        const res = await fetch("/api/market/price-history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug, txSignature }),
        });
        const t1 = typeof performance !== "undefined" ? performance.now() : 0;
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          console.warn(`${LP} POST record failed`, res.status, text);
          console.warn("[predicted][buy-volume-trace] client_success", {
            step: "POST price-history failed",
            slug,
            txSignature,
            status: res.status,
            body: text.slice(0, 500),
          });
        } else {
          const json = (await res.json()) as {
            ok?: boolean;
            volumeVerify?: VolumeTradeVerify;
          };
          verify = json.volumeVerify;
          console.info("[predicted][buy-volume-trace] client_success", {
            step: "POST price-history ok",
            slug,
            txSignature,
            incrementalVolumeApplied: verify?.incrementalVolumeApplied,
            skipReason: verify?.skipReason ?? null,
            volumeDeltaParsedUsd: verify?.volumeDeltaParsedUsd,
            newLastKnownVolumeUsd: verify?.newLastKnownVolumeUsd,
          });
          if (process.env.NODE_ENV === "development") {
            console.info("[predicted][volume-verify] client_post_response", {
              slug,
              txSignature,
              msHttpToJson: Math.round(t1 - t0),
              incrementalVolumeApplied: verify?.incrementalVolumeApplied,
              volumeVerify: verify,
              volumeCacheUpdated:
                verify?.incrementalVolumeApplied &&
                verify?.newLastKnownVolumeUsd != null,
            });
          }
        }
      } catch (e) {
        console.warn(`${LP} POST record error`, e);
      }
      const t2 = typeof performance !== "undefined" ? performance.now() : 0;

      const cur = seriesRef.current;
      const lastTs = cur.length > 0 ? cur[cur.length - 1]!.t : undefined;
      if (lastTs != null && cur.length > 0) {
        const inc = await fetchHistoryIncremental(slug, lastTs);
        if (inc.length > 0) {
          setSeries((prev) => mergeByT(prev, inc));
        } else {
          const full = await fetchHistoryFull(slug);
          setSeries(full);
        }
      } else {
        const full = await fetchHistoryFull(slug);
        setSeries(full);
      }

      setLoading(false);
      const t3 = typeof performance !== "undefined" ? performance.now() : 0;
      if (process.env.NODE_ENV === "development") {
        console.info("[predicted][volume-verify] client_roundtrip_complete", {
          slug,
          txSignature,
          msPostAndParse: Math.round(t2 - t0),
          msIncludingChartRefetch: Math.round(t3 - t0),
          note: "Router refresh / RSC may update header volume after navigation",
        });
      }
      return verify;
    },
    [slug],
  );

  return {
    series,
    sparseHistory,
    loading,
    refetch: load,
    recordAfterTrade,
  };
}

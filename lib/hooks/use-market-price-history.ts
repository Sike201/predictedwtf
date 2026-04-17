"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Point = { t: number; p: number };

const LP = "[predicted][use-market-price-history]";

async function fetchHistoryPoints(slug: string): Promise<Point[]> {
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
  };
  const raw = data.points ?? [];
  return raw
    .map((x) => {
      const t = typeof x.t === "number" ? x.t : Number(x.t);
      const p = typeof x.p === "number" ? x.p : Number(x.p);
      if (!Number.isFinite(t) || !Number.isFinite(p)) return null;
      return { t, p };
    })
    .filter((x): x is Point => x != null)
    .sort((a, b) => a.t - b.t);
}

/**
 * Loads `market_price_history` only — no synthetic chart points.
 */
export function useMarketPriceHistory(params: { slug: string }) {
  const { slug } = params;

  const [series, setSeries] = useState<Point[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const pts = await fetchHistoryPoints(slug);
      setSeries(pts);
      if (process.env.NODE_ENV === "development") {
        if (!pts.length) {
          console.info(`${LP} loaded 0 history points`, { slug });
        } else {
          const first = pts[0]!;
          const last = pts[pts.length - 1]!;
          console.info(`${LP} loaded`, {
            slug,
            count: pts.length,
            firstTs: new Date(first.t).toISOString(),
            lastTs: new Date(last.t).toISOString(),
            firstYesPrice: first.p,
            lastYesPrice: last.p,
          });
        }
      }
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const sparseHistory = useMemo(() => series.length < 3, [series.length]);

  const recordAfterTrade = useCallback(
    async (txSignature: string) => {
      try {
        const res = await fetch("/api/market/price-history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug, txSignature }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          console.warn(`${LP} POST record failed`, res.status, text);
        }
      } catch (e) {
        console.warn(`${LP} POST record error`, e);
      }
      await load();
    },
    [slug, load],
  );

  return {
    /** Real DB points only (YES price vs time). */
    series,
    sparseHistory,
    loading,
    refetch: load,
    recordAfterTrade,
  };
}

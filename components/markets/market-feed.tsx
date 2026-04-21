"use client";

import { motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { filterFeedMarkets } from "@/lib/data/filter-markets";
import { MarketCard } from "@/components/markets/market-card";
import { CategoryFilterBar } from "@/components/markets/category-filter-bar";
import {
  HOMEPAGE_CACHE_WARM_MAX,
  pickHomepagePrioritySlugs,
} from "@/lib/market/homepage-cache-warm";
import type { Market } from "@/lib/types/market";
import type { MarketCategoryKey, MarketSortKey } from "@/lib/types/market";

type MarketFeedProps = {
  /** Supabase `live` markets (see `fetchLiveMarketsForFeed`). */
  initialMarkets: Market[];
};

/**
 * Merges spot price + pool display from `/api/markets/feed-enrich` while keeping
 * `snapshot.volumeUsd` from the SSR/client row only (`markets.last_known_volume_usd` —
 * never on-chain aggregate volume on the homepage path).
 */
function mergeFeedEnrichOddsOnly(base: Market[], enriched: Market[]): Market[] {
  const map = new Map(enriched.map((m) => [m.id, m]));
  return base.map((row) => {
    const e = map.get(row.id);
    if (!e) return row;
    const volumeUsd =
      typeof row.snapshot?.volumeUsd === "number" &&
      Number.isFinite(row.snapshot.volumeUsd)
        ? Math.max(0, row.snapshot.volumeUsd)
        : 0;
    return {
      ...e,
      snapshot: {
        liquidityUsd:
          e.snapshot?.liquidityUsd ?? row.snapshot?.liquidityUsd ?? 0,
        volumeUsd,
      },
    };
  });
}

export function MarketFeed({ initialMarkets }: MarketFeedProps) {
  const [markets, setMarkets] = useState(initialMarkets);
  const [sort, setSort] = useState<MarketSortKey>("trending");
  const [category, setCategory] = useState<MarketCategoryKey>("all");

  const feedKey = useMemo(
    () => initialMarkets.map((m) => m.id).join("\0"),
    [initialMarkets],
  );
  const homepageVolumeSourceLogged = useRef(false);

  /** Bust stale client state when RSC passes new stats without a new array ref. */
  const serverStatsFingerprint = useMemo(
    () =>
      initialMarkets
        .map(
          (m) =>
            `${m.id}:${String(m.snapshot?.volumeUsd ?? "")}:${m.lastStatsUpdatedAt ?? ""}`,
        )
        .join("\0"),
    [initialMarkets],
  );

  useEffect(() => {
    setMarkets(initialMarkets);
  }, [initialMarkets, serverStatsFingerprint]);

  useEffect(() => {
    if (homepageVolumeSourceLogged.current) return;
    const first = initialMarkets[0];
    if (!first) return;
    homepageVolumeSourceLogged.current = true;
    if (process.env.NODE_ENV === "development") {
      console.info("[predicted][cache-warm] homepage_volume_source", {
        event: "client_hydrate_once",
        phase: "after_first_paint_row",
        source: "db_snapshot_prop",
        sampleSlug: first.id,
        sampleVolumeUsd: first.snapshot?.volumeUsd ?? null,
        lastStatsUpdatedAt: first.lastStatsUpdatedAt ?? null,
        perfNowMs: typeof performance !== "undefined" ? performance.now() : null,
        ts: Date.now(),
      });
    }
  }, [initialMarkets]);

  useEffect(() => {
    const slugs = feedKey.split("\0").filter((s) => s.length > 0);
    if (slugs.length === 0) return;

    let cancelled = false;
    void fetch("/api/markets/feed-enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slugs }),
    })
      .then((r) => r.json())
      .then((j: { markets?: Market[] }) => {
        if (cancelled) return;
        const next = j.markets;
        if (!Array.isArray(next)) return;
        setMarkets((prev) => mergeFeedEnrichOddsOnly(prev, next));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [feedKey]);

  /** Cheap spot prices first (feed-enrich); heavy volume reconcile only if stale (server TTL). */
  useEffect(() => {
    if (initialMarkets.length === 0) return;
    const warmSlugs = pickHomepagePrioritySlugs(
      initialMarkets,
      HOMEPAGE_CACHE_WARM_MAX,
    );
    if (warmSlugs.length === 0) return;

    const id = requestAnimationFrame(() => {
      if (process.env.NODE_ENV === "development") {
        console.info("[predicted][cache-warm] batch_queued", {
          event: "client_rAF_homepage_priority",
          count: warmSlugs.length,
          slugs: warmSlugs,
          ts: Date.now(),
        });
      }
      void fetch("/api/markets/cache-warm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slugs: warmSlugs,
          reason: "homepage_priority",
        }),
      }).catch(() => {});
    });
    return () => cancelAnimationFrame(id);
  }, [feedKey, initialMarkets]);

  const visibleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const slugs = filterFeedMarkets(markets, sort, category)
      .slice(0, 8)
      .map((m) => m.id);
    if (slugs.length === 0) return;
    if (visibleDebounceRef.current) clearTimeout(visibleDebounceRef.current);
    visibleDebounceRef.current = setTimeout(() => {
      if (process.env.NODE_ENV === "development") {
        console.info("[predicted][cache-warm] client_schedule_visible_warm", {
          sort,
          category,
          slugs,
        });
      }
      void fetch("/api/markets/cache-warm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slugs, reason: "visible_filter" }),
      }).catch(() => {});
    }, 2500);
    return () => {
      if (visibleDebounceRef.current) clearTimeout(visibleDebounceRef.current);
    };
  }, [sort, category, markets]);

  const list = useMemo(
    () => filterFeedMarkets(markets, sort, category),
    [markets, sort, category],
  );

  return (
    <div className="bg-black px-3 pb-24 pt-4 sm:px-4 lg:px-6">
      <div className="mx-auto max-w-[1920px]">
        <motion.div
          className="mb-5 border-b border-white/[0.04] pb-4"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <CategoryFilterBar
            sort={sort}
            category={category}
            onSortChange={setSort}
            onCategoryChange={setCategory}
          />
        </motion.div>

        <motion.div
          className="grid grid-cols-1 gap-3 min-[560px]:grid-cols-2 xl:grid-cols-4"
          initial="hidden"
          animate="show"
          variants={{
            hidden: { opacity: 0 },
            show: {
              opacity: 1,
              transition: {
                staggerChildren: 0.055,
                delayChildren: 0.08,
                ease: [0.16, 1, 0.3, 1],
              },
            },
          }}
        >
          {list.map((m) => (
            <motion.div
              key={m.id}
              variants={{
                hidden: { opacity: 0, y: 18, filter: "blur(6px)" },
                show: {
                  opacity: 1,
                  y: 0,
                  filter: "blur(0px)",
                  transition: { duration: 0.52, ease: [0.16, 1, 0.3, 1] },
                },
              }}
            >
              <MarketCard market={m} />
            </motion.div>
          ))}
        </motion.div>

        {list.length === 0 && (
          <p className="py-16 text-center text-sm text-zinc-500">
            No markets in this category yet.
          </p>
        )}
      </div>
    </div>
  );
}

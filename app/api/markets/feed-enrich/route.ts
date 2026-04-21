import { NextResponse } from "next/server";

import { enrichMarketsPoolSpotOnly } from "@/lib/market/enrich-markets-chain";
import { marketRecordToMarket } from "@/lib/market/market-record-adapter";
import { patchMarketCachedStatsByRowId } from "@/lib/market/patch-market-cached-stats";
import { getSupabaseAdmin } from "@/lib/supabase/server-client";
import type { MarketRecord } from "@/lib/types/market-record";

export const maxDuration = 60;

const PRICE_EPS = 2e-4;

/**
 * POST { slugs: string[] } — live pool spot for cards (vault reads only).
 * Homepage volume is **not** taken from this response: `MarketFeed` keeps `snapshot.volumeUsd`
 * from SSR / `markets.last_known_volume_usd` only (see `mergeFeedEnrichOddsOnly`).
 * Persists YES/NO to `markets` when on-chain differs from cache.
 */
export async function POST(req: Request) {
  let slugs: string[] = [];
  try {
    const body = (await req.json()) as { slugs?: unknown };
    slugs = Array.isArray(body?.slugs)
      ? body.slugs.filter((s): s is string => typeof s === "string" && s.length > 0)
      : [];
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (slugs.length === 0) {
    return NextResponse.json({ markets: [], timings: {} });
  }
  if (slugs.length > 200) {
    return NextResponse.json({ error: "too many slugs" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  if (!sb) {
    return NextResponse.json({ markets: [] });
  }

  const tQuery0 = Date.now();
  const { data, error } = await sb
    .from("markets")
    .select("*")
    .eq("status", "live")
    .in("slug", slugs);
  const dbQueryMs = Date.now() - tQuery0;

  if (error) {
    console.error("[predicted][feed-enrich-api]", error.message);
    return NextResponse.json({ markets: [] }, { status: 500 });
  }

  const rows = (data ?? []) as MarketRecord[];
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const ordered = slugs
    .map((slug) => bySlug.get(slug))
    .filter(Boolean) as MarketRecord[];

  const markets = ordered.map((row, i) => marketRecordToMarket(row, i));

  const spotPerMarketMs: number[] = [];
  const tEnrich0 = Date.now();
  const enriched = await enrichMarketsPoolSpotOnly(markets, {
    perMarketMs: spotPerMarketMs,
  });
  const enrichMs = Date.now() - tEnrich0;

  const tPersist0 = Date.now();
  const patchTasks: Promise<unknown>[] = [];
  for (let i = 0; i < enriched.length; i++) {
    const m = enriched[i]!;
    const row = ordered[i]!;
    const yDb =
      typeof row.last_known_yes_price === "number" &&
      Number.isFinite(row.last_known_yes_price)
        ? row.last_known_yes_price
        : 0.5;
    const nDb =
      typeof row.last_known_no_price === "number" &&
      Number.isFinite(row.last_known_no_price)
        ? row.last_known_no_price
        : 0.5;
    const yLive = m.yesProbability;
    const nLive =
      m.pool?.noPrice ?? Math.max(0, Math.min(1, 1 - yLive));

    if (
      Math.abs(yLive - yDb) > PRICE_EPS ||
      Math.abs(nLive - nDb) > PRICE_EPS
    ) {
      patchTasks.push(
        patchMarketCachedStatsByRowId(row.id, {
          yesPrice: yLive,
          noPrice: nLive,
        }),
      );
    }
  }
  await Promise.all(patchTasks);
  const persistMs = Date.now() - tPersist0;

  const totalMs = dbQueryMs + enrichMs + persistMs;
  const spotSlowest = [...spotPerMarketMs].sort((a, b) => b - a).slice(0, 5);

  if (process.env.NODE_ENV === "development") {
    console.info("[predicted][feed-enrich-api]", {
      dbQueryMs,
      enrichMs,
      persistMs,
      totalMs,
      requested: slugs.length,
      enriched: enriched.length,
      patches: patchTasks.length,
      spotPerMarketCount: spotPerMarketMs.length,
      spotPerMarketSlowestMs: spotSlowest,
    });
  }

  return NextResponse.json({
    markets: enriched,
    timings: {
      dbQueryMs,
      enrichMs,
      persistMs,
      totalMs,
      spotPerMarketSlowestMs: spotSlowest,
    },
  });
}

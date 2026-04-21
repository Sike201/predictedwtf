import { marketRecordToMarket } from "@/lib/market/market-record-adapter";
import { getSupabaseAdmin } from "@/lib/supabase/server-client";
import type { MarketRecord } from "@/lib/types/market-record";
import type { Market } from "@/lib/types/market";

function logDbReadDetail(row: MarketRecord, slug: string) {
  if (process.env.NODE_ENV !== "development") return;
  console.info("[predicted][volume-trace] db_read_detail_row", {
    slug,
    id: row.id,
    last_known_volume_usd: row.last_known_volume_usd,
    vol_type: typeof row.last_known_volume_usd,
    last_stats_updated_at: row.last_stats_updated_at ?? null,
  });
}

/** Homepage cards read `last_known_volume_usd` only (see `marketRecordToMarket`). */
function logHomepageVolumeFetch(rows: MarketRecord[], markets: Market[]) {
  const marketsPayload = rows.map((r, i) => ({
    slug: r.slug,
    last_known_volume_usd: r.last_known_volume_usd,
    renderedVolumeUsd: markets[i]?.snapshot.volumeUsd,
  }));
  console.info("[predicted][homepage-volume-fetch]", {
    count: rows.length,
    markets: marketsPayload,
  });
}

const LP = "[predicted][markets-fetch]";

/** `status = 'live'`, newest first — for homepage / markets index feeds. */
export async function fetchLiveMarketsForFeed(): Promise<Market[]> {
  const sb = getSupabaseAdmin();
  if (!sb) {
    console.warn(`${LP} Supabase not configured — empty feed`);
    return [];
  }

  const { data, error } = await sb
    .from("markets")
    .select("*")
    .eq("status", "live")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(`${LP} homepage query failed`, error.message);
    return [];
  }

  const rows = (data ?? []) as MarketRecord[];
  console.info(`${LP} homepage fetched ${rows.length} live markets`);

  const markets = rows.map((row, i) => marketRecordToMarket(row, i));
  console.info("[predicted][cache-warm] homepage_volume_source", {
    event: "ssr_feed_row",
    phase: "initial_html_path",
    source: "db_last_known_volume_usd_last_stats",
    marketCount: markets.length,
    ts: Date.now(),
  });
  if (process.env.NODE_ENV === "development") {
    logHomepageVolumeFetch(rows, markets);
  }
  return markets;
}

/** Single market for `/markets/[slug]` — must be `live`. */
export async function fetchLiveMarketBySlug(
  slug: string,
): Promise<MarketRecord | null> {
  const sb = getSupabaseAdmin();
  if (!sb) {
    console.warn(`${LP} Supabase not configured`);
    return null;
  }

  const { data, error } = await sb
    .from("markets")
    .select("*")
    .eq("slug", slug)
    .eq("status", "live")
    .maybeSingle();

  if (error) {
    console.error(`${LP} detail query failed`, error.message);
    return null;
  }

  if (data) {
    const rec = data as MarketRecord;
    console.info(`${LP} detail page fetched market`, { slug: rec.slug });
    logDbReadDetail(rec, slug);
  }

  return data as MarketRecord | null;
}

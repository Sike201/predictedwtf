import { enrichMarketsWithOnChainStats } from "@/lib/market/enrich-markets-chain";
import { marketRecordToMarket } from "@/lib/market/market-record-adapter";
import { getSupabaseAdmin } from "@/lib/supabase/server-client";
import type { MarketRecord } from "@/lib/types/market-record";
import type { Market } from "@/lib/types/market";

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
  return enrichMarketsWithOnChainStats(markets);
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
    console.info(`${LP} detail page fetched market`, {
      slug: (data as MarketRecord).slug,
    });
  }

  return data as MarketRecord | null;
}

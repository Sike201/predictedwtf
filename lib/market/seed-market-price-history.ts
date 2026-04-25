import { PublicKey } from "@solana/web3.js";

import { getConnection } from "@/lib/solana/connection";
import { getSupabaseAdmin } from "@/lib/supabase/server-client";
import { recordMarketPriceSnapshotFromChain } from "@/lib/market/market-price-history";

const REPAIR = "[predicted][chart-history-repair]";

function logRepair(
  event:
    | "market_has_zero_rows"
    | "seed_insert_start"
    | "seed_insert_ok"
    | "seed_insert_fail",
  payload: Record<string, unknown>,
): void {
  console.info(REPAIR, { event, ...payload });
}

/**
 * Ensures at least one `market_price_history` row for a live market with a pool.
 * Tries real bootstrap txs from `markets` first, then a deterministic synthetic key.
 */
export async function seedMarketPriceHistoryIfEmpty(
  slug: string,
): Promise<
  | { ok: true; seeded: false; reason: string }
  | { ok: true; seeded: true; txSignature: string }
  | { ok: false; error: string }
> {
  const sb = getSupabaseAdmin();
  if (!sb) {
    return { ok: false, error: "Supabase not configured" };
  }

  const { data: row, error: mErr } = await sb
    .from("markets")
    .select(
      "id, slug, status, pool_address, yes_mint, no_mint, market_engine, seed_liquidity_tx, pool_init_tx, created_tx",
    )
    .eq("slug", slug)
    .eq("status", "live")
    .maybeSingle();

  if (mErr || !row) {
    return { ok: true, seeded: false, reason: "market_not_found_or_not_live" };
  }

  const market = row as {
    id: string;
    slug: string;
    pool_address: string | null;
    yes_mint: string | null;
    no_mint: string | null;
    market_engine?: string | null;
    seed_liquidity_tx: string | null;
    pool_init_tx: string | null;
    created_tx: string | null;
  };

  if (!market.pool_address || !market.yes_mint || !market.no_mint) {
    return { ok: true, seeded: false, reason: "pool_not_configured" };
  }

  const { count, error: cErr } = await sb
    .from("market_price_history")
    .select("*", { count: "exact", head: true })
    .eq("market_id", market.id);

  if (cErr) {
    logRepair("seed_insert_fail", { slug, phase: "count", error: cErr.message });
    return { ok: false, error: cErr.message };
  }

  if ((count ?? 0) > 0) {
    return { ok: true, seeded: false, reason: "already_has_rows" };
  }

  logRepair("market_has_zero_rows", {
    slug,
    marketId: market.id,
  });

  let pairAddress: PublicKey;
  let yesMint: PublicKey;
  let noMint: PublicKey;
  try {
    pairAddress = new PublicKey(market.pool_address);
    yesMint = new PublicKey(market.yes_mint);
    noMint = new PublicKey(market.no_mint);
  } catch {
    logRepair("seed_insert_fail", { slug, phase: "invalid_pool_keys" });
    return { ok: false, error: "Invalid pool addresses" };
  }

  const connection = getConnection();
  const engineHint =
    market.market_engine === "PM_AMM" ? "PM_AMM" : "GAMM";
  const candidates = [
    market.seed_liquidity_tx,
    market.pool_init_tx,
    market.created_tx,
  ].filter((s): s is string => typeof s === "string" && s.length > 0);

  const trySig = async (txSignature: string, source: string) => {
    logRepair("seed_insert_start", { slug, marketId: market.id, txSignature, source });
    const result = await recordMarketPriceSnapshotFromChain({
      marketId: market.id,
      txSignature,
      connection,
      pairAddress,
      yesMint,
      noMint,
      marketEngineHint: engineHint,
    });
    if (result.ok) {
      logRepair("seed_insert_ok", {
        slug,
        marketId: market.id,
        txSignature,
        source,
      });
      return true;
    }
    logRepair("seed_insert_fail", {
      slug,
      marketId: market.id,
      txSignature,
      source,
      error: result.error,
    });
    return false;
  };

  for (const sig of candidates) {
    const ok = await trySig(sig, "markets_row_tx");
    if (ok) {
      return { ok: true, seeded: true, txSignature: sig };
    }
  }

  const synthetic = `predicted_bootstrap_seed:${market.id}`;
  logRepair("seed_insert_start", {
    slug,
    marketId: market.id,
    txSignature: synthetic,
    source: "synthetic_fallback",
  });
  const fallback = await recordMarketPriceSnapshotFromChain({
    marketId: market.id,
    txSignature: synthetic,
    connection,
    pairAddress,
    yesMint,
    noMint,
    marketEngineHint: engineHint,
  });

  if (!fallback.ok) {
    logRepair("seed_insert_fail", {
      slug,
      marketId: market.id,
      txSignature: synthetic,
      source: "synthetic_fallback",
      error: fallback.error,
    });
    return { ok: false, error: fallback.error };
  }

  logRepair("seed_insert_ok", {
    slug,
    marketId: market.id,
    txSignature: synthetic,
    source: "synthetic_fallback",
  });
  return { ok: true, seeded: true, txSignature: synthetic };
}

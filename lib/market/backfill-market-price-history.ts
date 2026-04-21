import { PublicKey } from "@solana/web3.js";

import { recordMarketPriceSnapshotFromTxPostState } from "@/lib/market/market-price-history";
import { getConnection } from "@/lib/solana/connection";
import { fetchPoolOnchainActivity } from "@/lib/solana/fetch-pool-onchain-activity";
import { getSupabaseAdmin } from "@/lib/supabase/server-client";

const REPAIR = "[predicted][chart-history-repair]";

function logRepair(
  event:
    | "repair_start"
    | "repair_inserted_count"
    | "repair_done"
    | "repair_fail"
    | "market_needs_repair",
  payload: Record<string, unknown>,
): void {
  console.info(REPAIR, event, payload);
}

/**
 * Upserts `market_price_history` rows from on-chain pair activity, using **post-tx**
 * vault balances per signature (not the live pool read).
 */
export async function backfillMarketPriceHistoryFromOnchainActivity(params: {
  slug: string;
  /** Max signatures from getSignaturesForAddress (capped in fetchPoolOnchainActivity). */
  limit?: number;
}): Promise<
  | {
      ok: true;
      attempted: number;
      inserted: number;
      skipped: number;
      failed: number;
      errors: string[];
    }
  | { ok: false; error: string }
> {
  const sb = getSupabaseAdmin();
  if (!sb) {
    return { ok: false, error: "Supabase not configured" };
  }

  const { data: row, error: mErr } = await sb
    .from("markets")
    .select("id, slug, status, pool_address, yes_mint, no_mint")
    .eq("slug", params.slug.trim())
    .eq("status", "live")
    .maybeSingle();

  if (mErr || !row) {
    return { ok: false, error: mErr?.message ?? "market_not_found_or_not_live" };
  }

  const market = row as {
    id: string;
    pool_address: string | null;
    yes_mint: string | null;
    no_mint: string | null;
  };

  if (!market.pool_address || !market.yes_mint || !market.no_mint) {
    return { ok: false, error: "pool_not_configured" };
  }

  let pairAddress: PublicKey;
  let yesMint: PublicKey;
  let noMint: PublicKey;
  try {
    pairAddress = new PublicKey(market.pool_address);
    yesMint = new PublicKey(market.yes_mint);
    noMint = new PublicKey(market.no_mint);
  } catch {
    return { ok: false, error: "Invalid pool addresses" };
  }

  const connection = getConnection();
  const limit = params.limit ?? 80;

  logRepair("repair_start", {
    slug: params.slug,
    marketId: market.id,
    limit,
  });

  let entries;
  try {
    entries = await fetchPoolOnchainActivity(connection, {
      pairAddress,
      yesMint,
      noMint,
      limit,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logRepair("repair_fail", { slug: params.slug, phase: "fetch_activity", error: msg });
    return { ok: false, error: msg };
  }

  /** Oldest first — replays history in time order (RPC returns newest-first). */
  const sigs = [...entries]
    .reverse()
    .map((e) => e.signature)
    .filter((s, i, a) => a.indexOf(s) === i);

  let inserted = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const txSignature of sigs) {
    const result = await recordMarketPriceSnapshotFromTxPostState({
      marketId: market.id,
      txSignature,
      connection,
      pairAddress,
      yesMint,
      noMint,
    });

    if (!result.ok) {
      failed += 1;
      const short = `${txSignature.slice(0, 8)}…:${result.error}`;
      errors.push(short);
      if (errors.length <= 12) {
        logRepair("repair_fail", {
          slug: params.slug,
          txSignature,
          error: result.error,
        });
      }
      continue;
    }

    if (result.volumeVerify.isNewSnapshotRow) {
      inserted += 1;
    } else {
      skipped += 1;
    }
  }

  logRepair("repair_inserted_count", {
    slug: params.slug,
    marketId: market.id,
    inserted,
    skipped,
    failed,
    attempted: sigs.length,
  });

  logRepair("repair_done", {
    slug: params.slug,
    marketId: market.id,
    attempted: sigs.length,
    inserted,
    skipped,
    failed,
  });

  return {
    ok: true,
    attempted: sigs.length,
    inserted,
    skipped,
    failed,
    errors,
  };
}

/**
 * True when DB has almost no chart rows but the pair has multiple on-chain swap-like events.
 */
export async function marketNeedsChartHistoryRepair(params: {
  slug: string;
}): Promise<{
  needsRepair: boolean;
  dbRowCount: number;
  onChainSwapLike: number;
  onChainEntryCount: number;
}> {
  const sb = getSupabaseAdmin();
  if (!sb) {
    return {
      needsRepair: false,
      dbRowCount: 0,
      onChainSwapLike: 0,
      onChainEntryCount: 0,
    };
  }

  const { data: row, error: mErr } = await sb
    .from("markets")
    .select("id, pool_address, yes_mint, no_mint")
    .eq("slug", params.slug.trim())
    .eq("status", "live")
    .maybeSingle();

  if (mErr || !row?.pool_address || !row.yes_mint || !row.no_mint) {
    return {
      needsRepair: false,
      dbRowCount: 0,
      onChainSwapLike: 0,
      onChainEntryCount: 0,
    };
  }

  const market = row as {
    id: string;
    pool_address: string;
    yes_mint: string;
    no_mint: string;
  };

  const { count: dbRowCount = 0 } = await sb
    .from("market_price_history")
    .select("*", { count: "exact", head: true })
    .eq("market_id", market.id);

  const connection = getConnection();
  const yesPk = new PublicKey(market.yes_mint);
  const noPk = new PublicKey(market.no_mint);
  const pairPk = new PublicKey(market.pool_address);

  let entries: Awaited<ReturnType<typeof fetchPoolOnchainActivity>> = [];
  try {
    entries = await fetchPoolOnchainActivity(connection, {
      pairAddress: pairPk,
      yesMint: yesPk,
      noMint: noPk,
      limit: 40,
    });
  } catch {
    return {
      needsRepair: false,
      dbRowCount: dbRowCount ?? 0,
      onChainSwapLike: 0,
      onChainEntryCount: 0,
    };
  }

  const SWAP_LABEL = /^(BUY|SELL) (YES|NO)$/;
  const swapLike = entries.filter((e) => SWAP_LABEL.test(e.label));
  const needsRepair =
    (dbRowCount ?? 0) <= 1 && swapLike.length >= 2;

  if (needsRepair) {
    logRepair("market_needs_repair", {
      slug: params.slug,
      marketId: market.id,
      dbRowCount,
      onChainSwapLike: swapLike.length,
      onChainEntryCount: entries.length,
    });
  }

  return {
    needsRepair,
    dbRowCount: dbRowCount ?? 0,
    onChainSwapLike: swapLike.length,
    onChainEntryCount: entries.length,
  };
}

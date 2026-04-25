import { PublicKey } from "@solana/web3.js";

import { recordMarketPriceSnapshotFromTxPostState } from "@/lib/market/market-price-history";
import { getConnection } from "@/lib/solana/connection";
import { fetchPoolOnchainActivity } from "@/lib/solana/fetch-pool-onchain-activity";
import { getSupabaseAdmin } from "@/lib/supabase/server-client";

export const CHART_REPAIR_LOG = "[predicted][chart-repair]";

function logChartRepair(
  event:
    | "latestPersistedTs"
    | "latestOrderBookTradeTs"
    | "missingPointsDetected"
    | "append_missing_points_count"
    | "repair_done",
  payload: Record<string, unknown>,
): void {
  console.info(CHART_REPAIR_LOG, event, payload);
}

export type ChartGapRepairResult =
  | {
      ok: true;
      marketId: string;
      latestPersistedTsIso: string | null;
      latestPersistedMs: number | null;
      latestOrderBookTradeTsIso: string | null;
      latestOrderBookTradeMs: number | null;
      missingPointsDetected: boolean;
      appendMissingPointsCount: number;
      skipped: number;
      failed: number;
    }
  | { ok: false; error: string };

/**
 * When on-chain activity is newer than the latest `market_price_history` row, append
 * missing snapshots for those txs only (idempotent upserts per tx_signature).
 */
export async function repairChartGapFromOnchainActivity(params: {
  slug: string;
  /** Max signatures scanned from pair (newest-first page). */
  limit?: number;
}): Promise<ChartGapRepairResult> {
  const sb = getSupabaseAdmin();
  if (!sb) {
    return { ok: false, error: "Supabase not configured" };
  }

  const slug = params.slug.trim();
  const { data: row, error: mErr } = await sb
    .from("markets")
    .select("id, slug, status, pool_address, yes_mint, no_mint, market_engine, usdc_mint")
    .eq("slug", slug)
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
    market_engine?: string | null;
    usdc_mint?: string | null;
  };

  if (!market.pool_address || !market.yes_mint || !market.no_mint) {
    return { ok: false, error: "pool_not_configured" };
  }

  const { data: lastRow } = await sb
    .from("market_price_history")
    .select("snapshot_ts")
    .eq("market_id", market.id)
    .order("snapshot_ts", { ascending: false })
    .limit(1)
    .maybeSingle();

  const latestPersistedMs = lastRow?.snapshot_ts
    ? Date.parse(String((lastRow as { snapshot_ts: string }).snapshot_ts))
    : null;
  const latestPersistedTsIso =
    latestPersistedMs != null && Number.isFinite(latestPersistedMs)
      ? new Date(latestPersistedMs).toISOString()
      : null;

  logChartRepair("latestPersistedTs", {
    slug,
    marketId: market.id,
    latestPersistedTsIso,
    latestPersistedMs,
  });

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
  const limit = params.limit ?? 100;

  const engine = market.market_engine === "PM_AMM" ? "PM_AMM" : "GAMM";
  let collateralPk: PublicKey | undefined;
  if (engine === "PM_AMM" && market.usdc_mint) {
    try {
      collateralPk = new PublicKey(market.usdc_mint);
    } catch {
      collateralPk = undefined;
    }
  }

  let entries: Awaited<ReturnType<typeof fetchPoolOnchainActivity>>;
  try {
    entries = await fetchPoolOnchainActivity(connection, {
      pairAddress,
      yesMint,
      noMint,
      limit,
      ...(engine === "PM_AMM" && collateralPk
        ? { marketEngine: "PM_AMM" as const, collateralMint: collateralPk }
        : {}),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }

  if (entries.length === 0) {
    logChartRepair("latestOrderBookTradeTs", {
      slug,
      marketId: market.id,
      latestOrderBookTradeTsIso: null,
      latestOrderBookTradeMs: null,
    });
    logChartRepair("missingPointsDetected", {
      slug,
      missingPointsDetected: false,
      reason: "no_on_chain_entries",
    });
    logChartRepair("append_missing_points_count", { slug, count: 0 });
    logChartRepair("repair_done", {
      slug,
      marketId: market.id,
      appendMissingPointsCount: 0,
      skipped: 0,
      failed: 0,
    });
    return {
      ok: true,
      marketId: market.id,
      latestPersistedTsIso,
      latestPersistedMs,
      latestOrderBookTradeTsIso: null,
      latestOrderBookTradeMs: null,
      missingPointsDetected: false,
      appendMissingPointsCount: 0,
      skipped: 0,
      failed: 0,
    };
  }

  const newest = entries[0]!;
  const latestOrderBookTradeMs = newest.blockTimeMs;
  const latestOrderBookTradeTsIso = new Date(latestOrderBookTradeMs).toISOString();

  logChartRepair("latestOrderBookTradeTs", {
    slug,
    marketId: market.id,
    latestOrderBookTradeTsIso,
    latestOrderBookTradeMs,
    newestSignature: newest.signature,
  });

  const baselineMs =
    latestPersistedMs != null && Number.isFinite(latestPersistedMs)
      ? latestPersistedMs
      : 0;

  const toBackfill = entries.filter((e) => e.blockTimeMs > baselineMs);
  const missingPointsDetected =
    toBackfill.length > 0 &&
    latestOrderBookTradeMs > baselineMs;

  logChartRepair("missingPointsDetected", {
    slug,
    marketId: market.id,
    missingPointsDetected,
    onChainNewerThanDb: latestOrderBookTradeMs > baselineMs,
    candidateTxCount: toBackfill.length,
    baselineMs,
  });

  if (!missingPointsDetected) {
    logChartRepair("append_missing_points_count", { slug, count: 0 });
    logChartRepair("repair_done", {
      slug,
      marketId: market.id,
      appendMissingPointsCount: 0,
      skipped: 0,
      failed: 0,
    });
    return {
      ok: true,
      marketId: market.id,
      latestPersistedTsIso,
      latestPersistedMs,
      latestOrderBookTradeTsIso,
      latestOrderBookTradeMs,
      missingPointsDetected: false,
      appendMissingPointsCount: 0,
      skipped: 0,
      failed: 0,
    };
  }

  /** Oldest first among txs newer than DB (RPC list is newest-first). */
  const sigs = [...toBackfill]
    .reverse()
    .map((e) => e.signature)
    .filter((s, i, a) => a.indexOf(s) === i);

  let inserted = 0;
  let skipped = 0;
  let failed = 0;

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
      continue;
    }
    if (result.volumeVerify.isNewSnapshotRow) {
      inserted += 1;
    } else {
      skipped += 1;
    }
  }

  logChartRepair("append_missing_points_count", {
    slug,
    marketId: market.id,
    count: inserted,
    attempted: sigs.length,
    skipped,
    failed,
  });

  logChartRepair("repair_done", {
    slug,
    marketId: market.id,
    appendMissingPointsCount: inserted,
    skipped,
    failed,
  });

  return {
    ok: true,
    marketId: market.id,
    latestPersistedTsIso,
    latestPersistedMs,
    latestOrderBookTradeTsIso,
    latestOrderBookTradeMs,
    missingPointsDetected: true,
    appendMissingPointsCount: inserted,
    skipped,
    failed,
  };
}

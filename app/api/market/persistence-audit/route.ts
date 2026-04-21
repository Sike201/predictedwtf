import { PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";

import { coerceUsdVolumeFromDb } from "@/lib/market/coerce-db-numeric";
import { fetchPoolOnchainActivity } from "@/lib/solana/fetch-pool-onchain-activity";
import { getConnection } from "@/lib/solana/connection";
import { getSupabaseAdmin } from "@/lib/supabase/server-client";

export const runtime = "nodejs";

const SWAP_LABEL = /^(BUY|SELL) (YES|NO)$/;

type FirstStep =
  | "none_observed"
  | "no_supabase"
  | "market_not_found"
  | "pool_not_configured"
  | "on_chain_empty"
  | "gap_chain_sig_missing_from_market_price_history"
  | "rows_in_db_but_volume_cache_looks_stale_vs_activity"
  | "activity_db_aligned_no_gap";

function describeFirstFailingStep(params: {
  orderbookNonEmpty: boolean;
  dbRowCount: number;
  firstChainSigMissingFromDb: string | null;
  swapLikeOnChain: number;
  lastKnownVol: number;
}): { firstFailingStep: FirstStep; diagnosis: string } {
  const {
    orderbookNonEmpty,
    dbRowCount,
    firstChainSigMissingFromDb,
    swapLikeOnChain,
    lastKnownVol,
  } = params;

  if (!orderbookNonEmpty) {
    return {
      firstFailingStep: "on_chain_empty",
      diagnosis:
        "No recent signatures for the pair address — nothing to persist.",
    };
  }

  if (firstChainSigMissingFromDb) {
    return {
      firstFailingStep: "gap_chain_sig_missing_from_market_price_history",
      diagnosis:
        "Live trading is visible on-chain (order book RPC), but this signature is absent from market_price_history. The break is before or at POST /api/market/price-history persistence: client never called recordAfterTrade, request failed, slug/market mismatch, or upsert error — not UI header rendering.",
    };
  }

  if (swapLikeOnChain >= 2 && dbRowCount <= 1 && lastKnownVol > 0) {
    return {
      firstFailingStep: "rows_in_db_but_volume_cache_looks_stale_vs_activity",
      diagnosis:
        "Order book shows multiple swap-like rows but few/no price-history rows; or DB volume stayed flat. Check increment path: duplicate_snapshot_row skips, fetchSingleTxTradeVolumeUsd returning 0 (skipReason no_swap_notional), or incrementCachedVolumeUsdByRowId failing after upsert.",
    };
  }

  return {
    firstFailingStep: "activity_db_aligned_no_gap",
    diagnosis:
      "Recent on-chain rows appear reflected in market_price_history for sampled sigs. If volume still looks wrong, compare last_known_volume_usd to reconcile overwrites or partial volDelta application.",
  };
}

/**
 * GET ?slug= — dev-only: compare on-chain pool activity vs DB price history + cached volume.
 */
export async function GET(req: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json(
      { error: "persistence-audit is only available in development" },
      { status: 404 },
    );
  }

  const { searchParams } = new URL(req.url);
  const slug = searchParams.get("slug")?.trim();
  if (!slug) {
    return NextResponse.json({ error: "Missing slug" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  if (!sb) {
    return NextResponse.json(
      { error: "Supabase not configured", firstFailingStep: "no_supabase" },
      { status: 503 },
    );
  }

  const { data: row, error: mErr } = await sb
    .from("markets")
    .select(
      "id, slug, status, pool_address, yes_mint, no_mint, last_known_volume_usd, last_stats_updated_at",
    )
    .eq("slug", slug)
    .maybeSingle();

  if (mErr || !row) {
    return NextResponse.json(
      {
        error: "Market not found",
        slug,
        firstFailingStep: "market_not_found",
      },
      { status: 404 },
    );
  }

  const market = row as {
    id: string;
    slug: string;
    status: string;
    pool_address: string | null;
    yes_mint: string | null;
    no_mint: string | null;
    last_known_volume_usd: unknown;
    last_stats_updated_at: string | null;
  };

  const lastKnownVol = coerceUsdVolumeFromDb(market.last_known_volume_usd);

  if (
    market.status !== "live" ||
    !market.pool_address ||
    !market.yes_mint ||
    !market.no_mint
  ) {
    return NextResponse.json({
      summary: {
        firstFailingStep: "pool_not_configured" as const,
        diagnosis:
          "Market row exists but pool mints/address incomplete — price-history POST returns 404.",
      },
      market: {
        id: market.id,
        slug: market.slug,
        poolAddress: market.pool_address,
        lastKnownVolumeUsd: lastKnownVol,
        lastStatsUpdatedAt: market.last_stats_updated_at,
      },
    });
  }

  const { count: historyCount, error: cErr } = await sb
    .from("market_price_history")
    .select("*", { count: "exact", head: true })
    .eq("market_id", market.id);

  if (cErr) {
    return NextResponse.json(
      { error: cErr.message },
      { status: 500 },
    );
  }

  const { data: historyRows, error: hErr } = await sb
    .from("market_price_history")
    .select("tx_signature, snapshot_ts")
    .eq("market_id", market.id)
    .order("snapshot_ts", { ascending: false })
    .limit(40);

  if (hErr) {
    return NextResponse.json({ error: hErr.message }, { status: 500 });
  }

  const dbSigs = new Set(
    (historyRows ?? []).map(
      (r: { tx_signature: string }) => r.tx_signature,
    ),
  );

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
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        error: `fetchPoolOnchainActivity failed: ${msg}`,
        market: {
          id: market.id,
          poolAddress: market.pool_address,
        },
      },
      { status: 502 },
    );
  }

  const orderbookChainSigs = entries.map((e) => e.signature);
  const swapLike = entries.filter((e) => SWAP_LABEL.test(e.label));
  const orderbookNonEmpty = orderbookChainSigs.length > 0;

  /** Newest-on-chain first: first sig without a DB row is the persistence gap. */
  let firstChainSigMissingFromDb: string | null = null;
  for (const sig of orderbookChainSigs) {
    if (!dbSigs.has(sig)) {
      firstChainSigMissingFromDb = sig;
      break;
    }
  }

  /** If DB has sigs not in recent chain page, still OK — pagination. */
  const onChainNotInDb = orderbookChainSigs.filter((s) => !dbSigs.has(s));

  const { firstFailingStep, diagnosis } = describeFirstFailingStep({
    orderbookNonEmpty,
    dbRowCount: historyCount ?? 0,
    firstChainSigMissingFromDb,
    swapLikeOnChain: swapLike.length,
    lastKnownVol,
  });

  const payload = {
    summary: {
      firstFailingStep,
      diagnosis,
      expectedLivePoolVsStaleDb:
        "Pool reserves (client) update from direct RPC reads. market_price_history and last_known_volume_usd only update when POST /api/market/price-history succeeds (then increment when volDelta>0). If recordAfterTrade does not run or upsert fails, chain activity diverges from DB.",
    },
    market: {
      id: market.id,
      slug: market.slug,
      poolAddress: market.pool_address,
      lastKnownVolumeUsd: lastKnownVol,
      lastStatsUpdatedAt: market.last_stats_updated_at,
      writesUseThisMarketId: market.id,
    },
    counts: {
      orderbookEntriesLoaded: entries.length,
      orderbookSwapLikeLabels: swapLike.length,
      marketPriceHistoryRowCount: historyCount ?? 0,
    },
    comparison: {
      signaturesRecentOnChain: orderbookChainSigs.slice(0, 15),
      signaturesInDbSample: (historyRows ?? [])
        .slice(0, 15)
        .map((r: { tx_signature: string; snapshot_ts: string }) => ({
          tx: r.tx_signature,
          snapshot_ts: r.snapshot_ts,
        })),
      onChainSignaturesNotInMarketPriceHistoryTable: onChainNotInDb,
      /** First signature in newest-first RPC page that has no DB row — earliest persistence failure in time order. */
      firstMissingSignature: firstChainSigMissingFromDb,
    },
    /** Explicit side-by-side labels for chart vs order-book divergence (PART 1 report). */
    divergenceReport: {
      visibleOrderBookTxs: entries.map((e) => ({
        signature: e.signature,
        blockTimeIso: new Date(e.blockTimeMs).toISOString(),
        label: e.label,
        summary: e.summary,
      })),
      persistedChartSnapshotTxs: (historyRows ?? []).map(
        (r: { tx_signature: string; snapshot_ts: string }) => ({
          tx_signature: r.tx_signature,
          snapshot_ts: r.snapshot_ts,
        }),
      ),
      missingTxsInChartHistory: onChainNotInDb,
    },
    orderbookLabelsSample: entries.slice(0, 15).map((e) => ({
      signature: e.signature,
      label: e.label,
      summary: e.summary,
    })),
    checklist: {
      postPriceHistoryCalled:
        "Infer from gaps: if firstMissingSignature is set, POST either not invoked for that tx or failed before commit.",
      marketPriceHistoryRowInserted: dbSigs.size > 0 || (historyCount ?? 0) > 0,
      lastKnownVolumeIncremented:
        "Not directly derivable here; if rows exist but volume flat, inspect server logs for db_increment / no_swap_notional_in_tx.",
      sameMarketRowIdForWrites: `All upserts use market_id=${market.id} from slug lookup in POST /api/market/price-history.`,
    },
    chartPipeline: {
      queryKeyForHistoryApi: "slug (GET /api/market/price-history?slug=)",
      uiPasses: "useMarketPriceHistory({ slug: market.id }) — adapter sets market.id = markets.slug",
      slugRequested: slug,
      dbSlug: market.slug,
      marketRowId: market.id,
      identifiersMatch: slug === market.slug,
      marketPriceHistoryRowCount: historyCount ?? 0,
      chartReadsSameMarketAsPost:
        "fetchMarketPriceHistoryPoints(slug) filters markets.status=live and loads market_price_history.market_id — same as POST body.slug → row.id",
      ifChartEmptyButOrderbookBusy:
        firstChainSigMissingFromDb != null
          ? `First on-chain sig without DB row: ${firstChainSigMissingFromDb.slice(0, 12)}… — trace [predicted][chart-snapshot] api_enter POST + snapshot_upsert_*`
          : "No gap on this signature page; check older pages or recordAfterTrade not firing",
    },
  };

  console.info("[predicted][persistence-audit]", {
    slug,
    firstFailingStep,
    marketId: market.id,
    historyCount,
    orderbookCount: entries.length,
    missingFromDb: onChainNotInDb.length,
  });

  return NextResponse.json(payload);
}

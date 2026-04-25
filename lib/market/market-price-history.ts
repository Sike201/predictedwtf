import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";

import { logChartPersist } from "@/lib/market/chart-persist-log";
import { deriveMarketProbabilityFromPoolState } from "@/lib/market/derive-market-probability";
import {
  incrementCachedVolumeUsdByRowId,
  patchMarketCachedStatsByRowId,
} from "@/lib/market/patch-market-cached-stats";
import { logChartSnapshot } from "@/lib/market/chart-snapshot-log";
import type { VolumeTradeVerify } from "@/lib/market/volume-trade-verify";
import { getSupabaseAdmin } from "@/lib/supabase/server-client";
import { DEFAULT_OMNIPAIR_POOL_PARAMS } from "@/lib/solana/omnipair-params-hash";
import { deriveOmnipairLayout } from "@/lib/solana/omnipair-pda";
import { requireOmnipairProgramId } from "@/lib/solana/omnipair-program";
import { readPmammMarketPoolSnapshot } from "@/lib/solana/pmamm-program";
import { readOmnipairPoolState } from "@/lib/solana/read-omnipair-pool-state";
import { extractPostTxOmnipairVaultReserves } from "@/lib/solana/omnipair-tx-post-reserves";
import { fetchSingleTxTradeVolumeUsd } from "@/lib/solana/fetch-pool-onchain-activity";

const LP = "[predicted][market-price-history]";

function coerceHistoryTimeMs(ms: number): number {
  if (!Number.isFinite(ms)) return ms;
  const x = Math.trunc(ms);
  if (x > 0 && x < 1_000_000_000_000) return x * 1000;
  return x;
}

export type MarketPriceHistoryPoint = {
  t: number;
  p: number;
  reserveYes: string;
  reserveNo: string;
  txSignature: string;
};

async function resolveSnapshotTimeMs(
  connection: Connection,
  txSignature: string,
): Promise<number> {
  try {
    const tx = await connection.getTransaction(txSignature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    const bt = tx?.blockTime;
    if (typeof bt === "number" && Number.isFinite(bt)) {
      return bt * 1000;
    }
  } catch {
    /* fall through */
  }
  return Date.now();
}

type CommitOptions = {
  /** Backfill: only upsert chart rows; do not bump volume cache (avoids double-count). */
  skipVolumeIncrement?: boolean;
  /** Backfill: do not patch markets cached YES/NO mid on every historical row. */
  skipCachePricePatch?: boolean;
};

async function commitMarketPriceSnapshotFromReserves(params: {
  marketId: string;
  txSignature: string;
  connection: Connection;
  pairAddress: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
  reserveYes: bigint;
  reserveNo: bigint;
  snapshotMs: number;
  commitOptions?: CommitOptions;
}): Promise<
  { ok: true; volumeVerify: VolumeTradeVerify } | { ok: false; error: string }
> {
  const serverT0 = Date.now();
  const sb = getSupabaseAdmin();
  if (!sb) {
    return { ok: false, error: "Supabase not configured." };
  }

  const {
    marketId,
    txSignature,
    connection,
    yesMint,
    noMint,
    reserveYes,
    reserveNo,
    snapshotMs,
    commitOptions,
  } = params;

  const derived = deriveMarketProbabilityFromPoolState({
    reserveYes,
    reserveNo,
  });
  if (!derived) {
    logChartSnapshot("snapshot_upsert_fail", {
      marketId,
      txSignature,
      phase: "derive_yes_price_from_reserves",
      error: "Could not derive YES price from pool reserves.",
    });
    logChartPersist("snapshot_upsert_fail", {
      marketId,
      txSignature,
      phase: "derive_yes_price_from_reserves",
    });
    return { ok: false, error: "Could not derive YES price from pool reserves." };
  }

  const snapshotIso = new Date(snapshotMs).toISOString();
  const reserveYesStr = reserveYes.toString();
  const reserveNoStr = reserveNo.toString();
  const yesPrice = derived.yesProbability;

  const { data: existingSnap } = await sb
    .from("market_price_history")
    .select("tx_signature")
    .eq("market_id", marketId)
    .eq("tx_signature", txSignature)
    .maybeSingle();
  const isNewSnapshotRow = !existingSnap;

  const row = {
    market_id: marketId,
    tx_signature: txSignature,
    snapshot_ts: snapshotIso,
    reserve_yes: reserveYesStr,
    reserve_no: reserveNoStr,
    yes_price: yesPrice,
  };

  const { error } = await sb.from("market_price_history").upsert(row, {
    onConflict: "market_id,tx_signature",
  });

  if (error) {
    console.error(`${LP} upsert failed`, marketId, error.message);
    logChartSnapshot("snapshot_upsert_fail", {
      marketId,
      txSignature,
      isNewSnapshotRow,
      error: error.message,
    });
    logChartPersist("snapshot_upsert_fail", {
      marketId,
      txSignature,
      error: error.message,
    });
    console.info("[predicted][buy-volume-trace] snapshot_upsert", {
      ok: false,
      marketRowId: marketId,
      txSignature,
      isNewSnapshotRow,
      error: error.message,
    });
    return { ok: false, error: error.message };
  }

  if (isNewSnapshotRow) {
    logChartSnapshot("snapshot_upsert_ok", {
      marketId,
      txSignature,
      yesPrice,
      snapshot_ts: snapshotIso,
    });
    logChartPersist("snapshot_upsert_ok", {
      marketId,
      txSignature,
      yesPrice,
      snapshot_ts: snapshotIso,
    });
  } else {
    logChartSnapshot("snapshot_upsert_skip", {
      marketId,
      txSignature,
      reason: "duplicate_tx_signature_idempotent_upsert",
      note: "Row already existed; volume increment path skips duplicate",
    });
    logChartPersist("snapshot_upsert_skip", {
      marketId,
      txSignature,
      reason: "duplicate_tx_signature_idempotent_upsert",
    });
  }

  console.info("[predicted][buy-volume-trace] snapshot_upsert", {
    ok: true,
    marketRowId: marketId,
    txSignature,
    isNewSnapshotRow,
    note: isNewSnapshotRow
      ? "new_row_volume_increment_eligible"
      : "duplicate_tx_no_volume_increment",
  });

  if (!commitOptions?.skipCachePricePatch) {
    const cachePrices = await patchMarketCachedStatsByRowId(marketId, {
      yesPrice: derived.yesProbability,
      noPrice: derived.noProbability,
    });
    if (!cachePrices.ok) {
      console.warn(`${LP} cache price patch failed`, marketId, cachePrices.error);
    }
  }

  let volDelta = 0;
  let prevVol: number | null = null;
  let nextVol: number | null = null;
  let dbIncAttempted = false;
  let dbIncOk = true;
  let dbIncErr: string | undefined;
  let skipReason: string | undefined;

  const skipVol = commitOptions?.skipVolumeIncrement === true;

  if (skipVol) {
    skipReason = isNewSnapshotRow
      ? "backfill_skip_volume_increment"
      : "duplicate_snapshot_row";
  } else if (isNewSnapshotRow) {
    try {
      let volFetchParams: Parameters<typeof fetchSingleTxTradeVolumeUsd>[1] = {
        signature: txSignature,
        yesMint,
        noMint,
      };
      const { data: meRow } = await sb
        .from("markets")
        .select("market_engine, usdc_mint")
        .eq("id", marketId)
        .maybeSingle();
      const eng = (meRow as { market_engine?: string } | null)?.market_engine;
      const um = (meRow as { usdc_mint?: string | null } | null)?.usdc_mint;
      if (eng === "PM_AMM" && um) {
        try {
          volFetchParams = {
            ...volFetchParams,
            marketEngine: "PM_AMM",
            collateralMint: new PublicKey(um),
          };
        } catch {
          /* invalid usdc_mint */
        }
      }

      const detail = await fetchSingleTxTradeVolumeUsd(connection, volFetchParams);
      volDelta = detail.volumeUsd;
      const parseSource = detail.source;
      const classifiedAsPoolSwapStyle =
        parseSource === "omnipair_swap_ix" ||
        parseSource.startsWith("token_balance_") ||
        parseSource.startsWith("pmamm_swap");
      console.info("[predicted][buy-volume-trace] parsed_delta", {
        txSignature,
        marketRowId: marketId,
        parsedVolumeDeltaUsd: volDelta,
        parserSource: parseSource,
        txMissing: detail.txMissing,
        metaErr: detail.metaErr,
        classifiedAsPoolSwapStyle,
      });

      if (volDelta > 0) {
        dbIncAttempted = true;
        const inc = await incrementCachedVolumeUsdByRowId(marketId, volDelta);
        if (inc.ok && !inc.skipped) {
          prevVol = inc.before;
          nextVol = inc.after;
          dbIncOk = true;
          console.info("[predicted][buy-volume-trace] db_increment", {
            ok: true,
            marketRowId: marketId,
            txSignature,
            previousCachedVolumeUsd: prevVol,
            newCachedVolumeUsd: nextVol,
            parsedVolumeDeltaUsd: volDelta,
          });
        } else if (!inc.ok) {
          dbIncOk = false;
          dbIncErr = inc.error;
          console.warn("[predicted][buy-volume-trace] db_increment", {
            ok: false,
            marketRowId: marketId,
            txSignature,
            parsedVolumeDeltaUsd: volDelta,
            error: inc.error,
          });
        }
      } else {
        skipReason = "no_swap_notional_in_tx";
        console.warn("[predicted][buy-volume-trace] parsed_delta", {
          txSignature,
          marketRowId: marketId,
          parsedVolumeDeltaUsd: volDelta,
          skipReason,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`${LP} incremental volume parse failed`, marketId, msg);
      skipReason = `swap_parse_error:${msg}`;
    }
  } else {
    skipReason = "duplicate_snapshot_row";
    console.warn("[predicted][buy-volume-trace] snapshot_upsert", {
      marketRowId: marketId,
      txSignature,
      skipReason,
    });
  }

  const incrementalVolumeApplied = dbIncAttempted && dbIncOk;

  const volumeVerify: VolumeTradeVerify = {
    txSignature,
    isNewSnapshotRow,
    volumeDeltaParsedUsd: volDelta,
    previousLastKnownVolumeUsd: prevVol,
    newLastKnownVolumeUsd: nextVol,
    dbIncrementAttempted: dbIncAttempted,
    dbIncrementSucceeded: !dbIncAttempted || dbIncOk,
    dbIncrementError: dbIncErr,
    incrementalVolumeApplied,
    skipReason,
    serverProcessingMs: Date.now() - serverT0,
  };

  if (skipReason && !skipVol) {
    console.info("[predicted][volume-trade-increment-skip]", {
      txSignature,
      marketRowId: marketId,
      skipReason,
      parsedVolumeDeltaUsd: volDelta,
      isNewSnapshotRow,
    });
  }

  if (process.env.NODE_ENV === "development") {
    console.info(`${LP} recorded`, {
      txSignature,
      snapshot_ts: snapshotIso,
      reserveYes: reserveYesStr,
      reserveNo: reserveNoStr,
      yesPrice,
      incrementalVolumeApplied,
    });
  } else {
    console.info(`${LP} recorded`, {
      marketId: marketId.slice(0, 8),
      tx: txSignature.slice(0, 8),
      yesPrice,
    });
  }

  return { ok: true, volumeVerify };
}

/**
 * After a live trade: snapshot **current** pool reserves (post-trade state on RPC).
 */
export async function recordMarketPriceSnapshotFromChain(params: {
  marketId: string;
  txSignature: string;
  connection: Connection;
  pairAddress: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
  /** When set, skips DB lookup for `market_engine`. */
  marketEngineHint?: string;
}): Promise<
  { ok: true; volumeVerify: VolumeTradeVerify } | { ok: false; error: string }
> {
  const { marketId, txSignature, connection, pairAddress, yesMint, noMint } =
    params;

  let engine = params.marketEngineHint;
  if (engine == null) {
    const sb = getSupabaseAdmin();
    if (!sb) {
      return { ok: false, error: "Supabase not configured." };
    }
    const { data: engRow, error: engErr } = await sb
      .from("markets")
      .select("market_engine")
      .eq("id", marketId)
      .maybeSingle();
    if (engErr) {
      return { ok: false, error: engErr.message };
    }
    engine =
      (engRow as { market_engine?: string } | null)?.market_engine ?? "GAMM";
  }

  if (engine === "PM_AMM") {
    let pm;
    try {
      pm = await readPmammMarketPoolSnapshot(connection, pairAddress);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`${LP} read pmamm market failed`, marketId, msg);
      logChartSnapshot("snapshot_upsert_fail", {
        marketId,
        txSignature,
        phase: "read_pmamm_market",
        error: msg,
      });
      logChartPersist("snapshot_upsert_fail", {
        marketId,
        txSignature,
        phase: "read_pmamm_market",
        error: msg,
      });
      return {
        ok: false,
        error: "PM_AMM market state unavailable. Refresh and try again.",
      };
    }
    const snapshotMs = await resolveSnapshotTimeMs(connection, txSignature);
    return commitMarketPriceSnapshotFromReserves({
      marketId,
      txSignature,
      connection,
      pairAddress,
      yesMint,
      noMint,
      reserveYes: pm.reserveYes,
      reserveNo: pm.reserveNo,
      snapshotMs,
    });
  }

  let state;
  try {
    state = await readOmnipairPoolState(connection, {
      pairAddress,
      yesMint,
      noMint,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${LP} read pool failed`, marketId, msg);
    logChartSnapshot("snapshot_upsert_fail", {
      marketId,
      txSignature,
      phase: "read_omnipair_pool_state",
      error: msg,
    });
    logChartPersist("snapshot_upsert_fail", {
      marketId,
      txSignature,
      phase: "read_omnipair_pool_state",
      error: msg,
    });
    return { ok: false, error: msg };
  }

  const snapshotMs = await resolveSnapshotTimeMs(connection, txSignature);
  return commitMarketPriceSnapshotFromReserves({
    marketId,
    txSignature,
    connection,
    pairAddress,
    yesMint,
    noMint,
    reserveYes: state.reserveYes,
    reserveNo: state.reserveNo,
    snapshotMs,
  });
}

/**
 * Historical snapshot from **transaction meta** (post-state vault balances).
 * Used for backfill — skips volume increment and cached mid patch to avoid double-counting.
 */
export async function recordMarketPriceSnapshotFromTxPostState(params: {
  marketId: string;
  txSignature: string;
  connection: Connection;
  pairAddress: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
}): Promise<
  { ok: true; volumeVerify: VolumeTradeVerify } | { ok: false; error: string }
> {
  const { marketId, txSignature, connection, pairAddress, yesMint, noMint } =
    params;

  const programId = requireOmnipairProgramId();
  const layout = deriveOmnipairLayout(
    programId,
    yesMint,
    noMint,
    DEFAULT_OMNIPAIR_POOL_PARAMS,
  );
  if (!layout.pairAddress.equals(pairAddress)) {
    return {
      ok: false,
      error: "pool_address does not match derived Omnipair pair for these mints.",
    };
  }

  const tx = await connection.getParsedTransaction(txSignature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!tx?.meta) {
    return { ok: false, error: "Transaction not found or missing meta." };
  }

  const extracted = extractPostTxOmnipairVaultReserves(tx, layout);
  if (!extracted) {
    return { ok: false, error: "cannot_parse_post_vault_reserves" };
  }

  const yesIsToken0 = yesMint.equals(layout.token0Mint);
  const reserveYes = yesIsToken0 ? extracted.reserve0 : extracted.reserve1;
  const reserveNo = yesIsToken0 ? extracted.reserve1 : extracted.reserve0;
  const snapshotMs =
    tx.blockTime != null ? tx.blockTime * 1000 : Date.now();

  return commitMarketPriceSnapshotFromReserves({
    marketId,
    txSignature,
    connection,
    pairAddress,
    yesMint,
    noMint,
    reserveYes,
    reserveNo,
    snapshotMs,
    commitOptions: {
      skipVolumeIncrement: true,
      skipCachePricePatch: true,
    },
  });
}

export async function fetchMarketPriceHistoryPoints(
  slug: string,
): Promise<MarketPriceHistoryPoint[]> {
  const sb = getSupabaseAdmin();
  if (!sb) return [];

  const { data: market, error: mErr } = await sb
    .from("markets")
    .select("id, slug")
    .eq("slug", slug)
    .eq("status", "live")
    .maybeSingle();

  if (mErr || !market) {
    logChartSnapshot("market_lookup", {
      slug,
      ok: false,
      error: mErr?.message ?? "no_live_market_row",
      hint: "Chart GET requires status=live — same as POST snapshot path",
    });
    if (mErr) console.error(`${LP} market lookup failed`, slug, mErr.message);
    return [];
  }

  const marketId = (market as { id: string }).id;

  logChartSnapshot("market_lookup", {
    slug,
    marketId,
    ok: true,
    slugMatchesDbSlug: (market as { slug?: string }).slug ?? null,
  });

  const { data, error } = await sb
    .from("market_price_history")
    .select("tx_signature, snapshot_ts, reserve_yes, reserve_no, yes_price")
    .eq("market_id", marketId)
    .order("snapshot_ts", { ascending: true });

  if (error) {
    console.error(`${LP} fetch failed`, slug, error.message);
    logChartSnapshot("row_count_for_market", {
      slug,
      marketId,
      rowCount: 0,
      error: error.message,
    });
    return [];
  }

  const rows = (data ?? []) as Array<{
    tx_signature: string;
    snapshot_ts: string;
    reserve_yes: string;
    reserve_no: string;
    yes_price: number;
  }>;

  logChartSnapshot("row_count_for_market", {
    slug,
    marketId,
    rowCount: rows.length,
  });

  return rows.map((r) => ({
    t: coerceHistoryTimeMs(Date.parse(r.snapshot_ts)),
    p: r.yes_price,
    reserveYes: r.reserve_yes,
    reserveNo: r.reserve_no,
    txSignature: r.tx_signature,
  }));
}

/**
 * Rows strictly after `sinceMsExclusive` (by `snapshot_ts`), ascending.
 * Used for incremental chart refresh without reloading full history.
 */
export async function fetchMarketPriceHistoryPointsAfter(
  slug: string,
  sinceMsExclusive: number,
): Promise<MarketPriceHistoryPoint[]> {
  const sb = getSupabaseAdmin();
  if (!sb) return [];

  if (!Number.isFinite(sinceMsExclusive)) return [];

  const { data: market, error: mErr } = await sb
    .from("markets")
    .select("id, slug")
    .eq("slug", slug)
    .eq("status", "live")
    .maybeSingle();

  if (mErr || !market) {
    return [];
  }

  const marketId = (market as { id: string }).id;
  const iso = new Date(Math.trunc(sinceMsExclusive)).toISOString();

  const { data, error } = await sb
    .from("market_price_history")
    .select("tx_signature, snapshot_ts, reserve_yes, reserve_no, yes_price")
    .eq("market_id", marketId)
    .gt("snapshot_ts", iso)
    .order("snapshot_ts", { ascending: true });

  if (error) {
    console.error(`${LP} fetch after failed`, slug, error.message);
    return [];
  }

  const rows = (data ?? []) as Array<{
    tx_signature: string;
    snapshot_ts: string;
    reserve_yes: string;
    reserve_no: string;
    yes_price: number;
  }>;

  return rows.map((r) => ({
    t: coerceHistoryTimeMs(Date.parse(r.snapshot_ts)),
    p: r.yes_price,
    reserveYes: r.reserve_yes,
    reserveNo: r.reserve_no,
    txSignature: r.tx_signature,
  }));
}

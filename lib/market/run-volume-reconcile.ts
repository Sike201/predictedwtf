import { PublicKey } from "@solana/web3.js";

import { coerceUsdVolumeFromDb } from "@/lib/market/coerce-db-numeric";
import { patchMarketCachedStatsByRowId } from "@/lib/market/patch-market-cached-stats";
import { tryAcquireHeavyReconcileSlot } from "@/lib/market/reconcile-process-cooldown";
import { VOLUME_RECONCILE_TTL_MS } from "@/lib/market/volume-reconcile-ttl";
import { fetchPoolTotalSwapVolumeUsdWithStats } from "@/lib/solana/fetch-pool-onchain-activity";
import { getConnection } from "@/lib/solana/connection";
import { getSupabaseAdmin } from "@/lib/supabase/server-client";

export type VolumeReconcileOptions = {
  force?: boolean;
  /** Dev / logs only — e.g. `detail` | `homepage_batch` | `hover` */
  warmSource?: string;
};

/**
 * Background full swap-history volume reconcile for one market.
 * Respects `last_stats_updated_at` + TTL unless `force`.
 */
export async function runVolumeReconcileForSlug(
  slug: string,
  options?: VolumeReconcileOptions,
): Promise<{ httpStatus: number; body: Record<string, unknown> }> {
  const warmSource = options?.warmSource ?? "direct";
  const force = Boolean(options?.force);

  const sb = getSupabaseAdmin();
  if (!sb) {
    return {
      httpStatus: 503,
      body: { error: "Server storage not configured" },
    };
  }

  const { data: row, error } = await sb
    .from("markets")
    .select(
      "id, pool_address, yes_mint, no_mint, last_known_volume_usd, last_stats_updated_at",
    )
    .eq("slug", slug)
    .eq("status", "live")
    .maybeSingle();

  if (error || !row) {
    return { httpStatus: 404, body: { error: "Market not found" } };
  }

  if (!row.pool_address || !row.yes_mint || !row.no_mint) {
    console.info("[predicted][cache-warm] reconcile_skipped", {
      event: "no_pool",
      slug,
      warmSource,
      ts: Date.now(),
    });
    return { httpStatus: 200, body: { skipped: true, reason: "no_pool" } };
  }

  const cachedVol = coerceUsdVolumeFromDb(
    (row as { last_known_volume_usd?: unknown }).last_known_volume_usd,
  );
  const lastUpdatedRaw = (row as { last_stats_updated_at?: unknown })
    .last_stats_updated_at;
  const lastUpdatedMs =
    typeof lastUpdatedRaw === "string" ? Date.parse(lastUpdatedRaw) : 0;
  const ageMs =
    Date.now() - (Number.isFinite(lastUpdatedMs) ? lastUpdatedMs : 0);

  if (!force && ageMs < VOLUME_RECONCILE_TTL_MS) {
    console.info("[predicted][cache-warm] reconcile_skipped", {
      event: "ttl_fresh",
      slug,
      warmSource,
      ageMs,
      ttlMs: VOLUME_RECONCILE_TTL_MS,
      cachedVol,
      ts: Date.now(),
    });
    return {
      httpStatus: 200,
      body: {
        skipped: true,
        reason: "fresh",
        cachedVol,
        ageMs,
      },
    };
  }

  let pairAddress: PublicKey;
  let yesMint: PublicKey;
  let noMint: PublicKey;
  try {
    pairAddress = new PublicKey(row.pool_address as string);
    yesMint = new PublicKey(row.yes_mint as string);
    noMint = new PublicKey(row.no_mint as string);
  } catch {
    return {
      httpStatus: 400,
      body: { error: "Invalid on-chain addresses" },
    };
  }

  const slot = tryAcquireHeavyReconcileSlot(slug, force);
  if (!slot.acquired) {
    console.info("[predicted][cache-warm] reconcile_skipped", {
      event: "process_cooldown",
      slug,
      warmSource,
      remainingMs: slot.remainingMs,
      note: "heavy_scan_recent_same_process",
      ts: Date.now(),
    });
    return {
      httpStatus: 200,
      body: {
        skipped: true,
        reason: "process_cooldown",
        remainingMs: slot.remainingMs,
        cachedVol,
      },
    };
  }

  console.info("[predicted][cache-warm] reconcile_scan_start", {
    slug,
    warmSource,
    marketId: (row.id as string).slice(0, 8),
    cachedVol,
    statsAgeMs: ageMs,
    ts: Date.now(),
  });

  const t0 = Date.now();

  let scannedVol = 0;
  let signaturesScanned = 0;
  let swapsParsed = 0;

  try {
    const connection = getConnection();
    const stats = await fetchPoolTotalSwapVolumeUsdWithStats(connection, {
      pairAddress,
      yesMint,
      noMint,
    });
    scannedVol = Number.isFinite(stats.volumeUsd) ? stats.volumeUsd : 0;
    signaturesScanned = stats.signaturesScanned;
    swapsParsed = stats.swapsParsed;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const is429 =
      msg.includes("429") || msg.toLowerCase().includes("rate limit");
    console.warn("[predicted][cache-warm] reconcile_scan_error", {
      event: "scan_failed",
      slug,
      warmSource,
      is429,
      ms: Date.now() - t0,
      error: msg.slice(0, 200),
      ts: Date.now(),
    });
    console.warn("[predicted][volume-cache] reconcile_scan_error", {
      slug,
      warmSource,
      is429,
      error: msg,
      cachedVol,
      note: "cached_volume_preserved",
    });
    return {
      httpStatus: 200,
      body: {
        ok: false,
        error: msg,
        is429,
        cachedVol,
        note: "cached_volume_preserved",
      },
    };
  }

  const finalVol = Math.max(
    cachedVol,
    Number.isFinite(scannedVol) ? scannedVol : 0,
  );

  const patchResult = await patchMarketCachedStatsByRowId(row.id as string, {
    volumeUsd: finalVol,
  });

  const elapsedMs = Date.now() - t0;
  console.info("[predicted][cache-warm] reconcile_done", {
    event: "scan_ok",
    slug,
    warmSource,
    finalVol,
    ms: elapsedMs,
    patchOk: patchResult.ok,
    ts: Date.now(),
  });
  console.info("[predicted][volume-cache] reconcile_done", {
    slug,
    warmSource,
    marketId: (row.id as string).slice(0, 8),
    cachedBefore: cachedVol,
    scanned: scannedVol,
    finalVol,
    signaturesScanned,
    swapsParsed,
    ms: elapsedMs,
    patchOk: patchResult.ok,
  });

  return {
    httpStatus: 200,
    body: {
      ok: patchResult.ok,
      cachedBefore: cachedVol,
      scanned: scannedVol,
      finalVol,
      signaturesScanned,
      swapsParsed,
      ms: elapsedMs,
    },
  };
}

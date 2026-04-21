import { coerceUsdVolumeFromDb } from "@/lib/market/coerce-db-numeric";
import { getSupabaseAdmin } from "@/lib/supabase/server-client";

const LOG = "[predicted][market-cached-stats]";

export type CachedStatsPatch = {
  yesPrice?: number;
  noPrice?: number;
  volumeUsd?: number;
};

function clampProb(p: number): number {
  if (!Number.isFinite(p)) return 0.5;
  return Math.max(0, Math.min(1, p));
}

/**
 * Updates denormalized `markets` columns used for instant UI (feed cards, headers).
 */
export async function patchMarketCachedStatsByRowId(
  marketRowId: string,
  patch: CachedStatsPatch,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = getSupabaseAdmin();
  if (!sb) {
    return { ok: false, error: "Supabase not configured." };
  }

  const row: Record<string, unknown> = {
    last_stats_updated_at: new Date().toISOString(),
  };

  if (patch.yesPrice !== undefined) {
    row.last_known_yes_price = clampProb(patch.yesPrice);
  }
  if (patch.noPrice !== undefined) {
    row.last_known_no_price = clampProb(patch.noPrice);
  }
  if (patch.volumeUsd !== undefined) {
    row.last_known_volume_usd = Math.max(0, patch.volumeUsd);
  }

  const { data: updatedRows, error } = await sb
    .from("markets")
    .update(row)
    .eq("id", marketRowId)
    .select("id, last_known_volume_usd, last_stats_updated_at");

  if (error) {
    console.error(LOG, "update failed", marketRowId.slice(0, 8), error.message);
    if (process.env.NODE_ENV === "development") {
      console.error("[predicted][volume-trace] db_patch_error", {
        marketRowId,
        message: error.message,
        raw: String(error),
      });
    }
    return { ok: false, error: error.message };
  }

  const written = updatedRows?.[0] as
    | {
        id: string;
        last_known_volume_usd?: unknown;
        last_stats_updated_at?: string | null;
      }
    | undefined;

  if (process.env.NODE_ENV === "development") {
    console.info("[predicted][volume-trace] db_patch_row", {
      marketRowId,
      last_known_volume_usd: written?.last_known_volume_usd,
      coerced_volume: coerceUsdVolumeFromDb(written?.last_known_volume_usd),
      last_stats_updated_at: written?.last_stats_updated_at ?? null,
      patchKeys: Object.keys(row),
    });
  }

  return { ok: true };
}

/**
 * Read `last_known_volume_usd`, add `deltaUsd`, persist. Used for per-trade increments (no full chain scan).
 */
export async function incrementCachedVolumeUsdByRowId(
  marketRowId: string,
  deltaUsd: number,
): Promise<
  | { ok: true; before: number; after: number; skipped: boolean }
  | { ok: false; error: string }
> {
  if (!Number.isFinite(deltaUsd) || deltaUsd <= 0) {
    return { ok: true, before: 0, after: 0, skipped: true };
  }

  const sb = getSupabaseAdmin();
  if (!sb) {
    return { ok: false, error: "Supabase not configured." };
  }

  const { data, error } = await sb
    .from("markets")
    .select("last_known_volume_usd")
    .eq("id", marketRowId)
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message };
  }

  const before = coerceUsdVolumeFromDb(data?.last_known_volume_usd);
  const after = before + deltaUsd;

  const patch = await patchMarketCachedStatsByRowId(marketRowId, {
    volumeUsd: after,
  });
  if (!patch.ok) {
    return { ok: false, error: patch.error };
  }
  return { ok: true, before, after, skipped: false };
}

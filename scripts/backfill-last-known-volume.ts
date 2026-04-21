/**
 * One-time backfill: full on-chain swap-volume scan per market → `markets.last_known_volume_usd`.
 * Not used by the homepage render path (DB cache only there).
 *
 * Run from repo root (loads `.env.local` via Next env helper):
 *   npx tsx scripts/backfill-last-known-volume.ts
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { PublicKey } = await import("@solana/web3.js");
  const { getSupabaseAdmin } = await import("../lib/supabase/server-client");
  const { getConnection } = await import("../lib/solana/connection");
  const { fetchPoolTotalSwapVolumeUsdWithStats } = await import(
    "../lib/solana/fetch-pool-onchain-activity",
  );
  const { patchMarketCachedStatsByRowId } = await import(
    "../lib/market/patch-market-cached-stats",
  );

  const sb = getSupabaseAdmin();
  if (!sb) {
    console.error(
      "[backfill-volume] Supabase not configured (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)",
    );
    process.exit(1);
  }

  const { data, error } = await sb
    .from("markets")
    .select("id, slug, pool_address, yes_mint, no_mint")
    .eq("status", "live");

  if (error) {
    console.error("[backfill-volume] query failed", error.message);
    process.exit(1);
  }

  const rows = (data ?? []) as Array<{
    id: string;
    slug: string;
    pool_address: string | null;
    yes_mint: string | null;
    no_mint: string | null;
  }>;

  console.info("[backfill-volume] markets", rows.length);

  const connection = getConnection();

  for (const row of rows) {
    const pool = row.pool_address?.trim();
    const yes = row.yes_mint?.trim();
    const no = row.no_mint?.trim();
    if (!pool || !yes || !no) {
      console.warn("[backfill-volume] skip (missing pool mints)", row.slug);
      continue;
    }

    const stats = await fetchPoolTotalSwapVolumeUsdWithStats(connection, {
      pairAddress: new PublicKey(pool),
      yesMint: new PublicKey(yes),
      noMint: new PublicKey(no),
      maxSignatures: 50_000,
    });

    const volumeUsd = Number.isFinite(stats.volumeUsd)
      ? Math.max(0, stats.volumeUsd)
      : 0;

    const patch = await patchMarketCachedStatsByRowId(row.id, {
      volumeUsd,
    });

    console.info("[backfill-volume] done", {
      slug: row.slug,
      volumeUsd,
      signaturesScanned: stats.signaturesScanned,
      swapsParsed: stats.swapsParsed,
      ok: patch.ok,
    });
  }
}

main().catch((e) => {
  console.error("[backfill-volume] fatal", e);
  process.exit(1);
});

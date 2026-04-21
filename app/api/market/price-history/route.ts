import { PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";

import { logChartPersist } from "@/lib/market/chart-persist-log";
import { logChartSnapshot } from "@/lib/market/chart-snapshot-log";
import {
  fetchMarketPriceHistoryPoints,
  fetchMarketPriceHistoryPointsAfter,
  recordMarketPriceSnapshotFromChain,
} from "@/lib/market/market-price-history";
import { seedMarketPriceHistoryIfEmpty } from "@/lib/market/seed-market-price-history";
import { getConnection } from "@/lib/solana/connection";
import { getSupabaseAdmin } from "@/lib/supabase/server-client";

export const dynamic = "force-dynamic";

/**
 * GET ?slug= — ordered probability history for the chart (no synthetic fill).
 * GET ?slug=&sinceTs= — rows with snapshot_ts strictly after `sinceTs` (epoch ms); `mode: "incremental"`.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get("slug")?.trim();
  if (!slug) {
    return NextResponse.json({ error: "Missing slug" }, { status: 400 });
  }

  const sinceRaw = searchParams.get("sinceTs")?.trim();
  const sinceMs =
    sinceRaw != null && sinceRaw !== "" ? Number(sinceRaw) : Number.NaN;

  logChartSnapshot("api_enter", {
    method: "GET",
    slug,
    sinceTs: Number.isFinite(sinceMs) ? sinceMs : null,
  });

  if (Number.isFinite(sinceMs)) {
    const points = await fetchMarketPriceHistoryPointsAfter(slug, sinceMs);
    return NextResponse.json({
      points,
      mode: "incremental" as const,
    });
  }

  let points = await fetchMarketPriceHistoryPoints(slug);
  if (points.length === 0) {
    const repair = await seedMarketPriceHistoryIfEmpty(slug);
    if (repair.ok && repair.seeded) {
      points = await fetchMarketPriceHistoryPoints(slug);
    }
  }
  return NextResponse.json({
    points,
    mode: "full" as const,
  });
}

/**
 * POST { slug, txSignature } — after a confirmed trade: snapshot pool reserves + YES probability.
 */
export async function POST(req: Request) {
  let body: { slug?: string; txSignature?: string };
  try {
    body = (await req.json()) as { slug?: string; txSignature?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const slug = body.slug?.trim();
  const txSignature = body.txSignature?.trim();
  if (!slug || !txSignature) {
    return NextResponse.json(
      { error: "slug and txSignature are required" },
      { status: 400 },
    );
  }

  console.info("[predicted][buy-volume-trace] api_enter", {
    step: "post_body_ok",
    slug,
    txSignature,
  });
  logChartSnapshot("api_enter", {
    method: "POST",
    slug,
    txSignature,
  });

  const sb = getSupabaseAdmin();
  if (!sb) {
    return NextResponse.json(
      { error: "Server storage not configured" },
      { status: 503 },
    );
  }

  const { data: row, error } = await sb
    .from("markets")
    .select("id, pool_address, yes_mint, no_mint")
    .eq("slug", slug)
    .eq("status", "live")
    .maybeSingle();

  if (error || !row?.pool_address || !row.yes_mint || !row.no_mint) {
    console.warn("[predicted][buy-volume-trace] api_enter", {
      slug,
      txSignature,
      error: error?.message ?? "no_row",
    });
    return NextResponse.json(
      { error: "Market not found or pool not ready" },
      { status: 404 },
    );
  }

  console.info("[predicted][buy-volume-trace] api_enter", {
    slug,
    txSignature,
    marketRowId: row.id,
  });
  logChartPersist("market_lookup_ok", {
    slug,
    marketRowId: row.id,
    txSignature,
  });

  let pairAddress: PublicKey;
  let yesMint: PublicKey;
  let noMint: PublicKey;
  try {
    pairAddress = new PublicKey(row.pool_address);
    yesMint = new PublicKey(row.yes_mint);
    noMint = new PublicKey(row.no_mint);
  } catch {
    return NextResponse.json({ error: "Invalid on-chain addresses" }, { status: 400 });
  }

  const connection = getConnection();
  if (process.env.NODE_ENV === "development") {
    console.info("[predicted][volume-verify] trade_snapshot_post", {
      slug,
      marketRowId: row.id,
      txSignature,
    });
  }

  const result = await recordMarketPriceSnapshotFromChain({
    marketId: row.id,
    txSignature,
    connection,
    pairAddress,
    yesMint,
    noMint,
  });

  if (!result.ok) {
    console.warn("[predicted][buy-volume-trace] api_enter", {
      slug,
      txSignature,
      marketRowId: row.id,
      recordError: result.error,
    });
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  if (process.env.NODE_ENV === "development") {
    console.info("[predicted][volume-verify] trade_snapshot_ok", {
      slug,
      tx: txSignature,
      volumeVerify: result.volumeVerify,
    });
  }

  return NextResponse.json({
    ok: true,
    volumeVerify: result.volumeVerify,
  });
}

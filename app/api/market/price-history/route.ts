import { PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";

import {
  fetchMarketPriceHistoryPoints,
  recordMarketPriceSnapshotFromChain,
} from "@/lib/market/market-price-history";
import { getConnection } from "@/lib/solana/connection";
import { getSupabaseAdmin } from "@/lib/supabase/server-client";

export const dynamic = "force-dynamic";

/**
 * GET ?slug= — ordered probability history for the chart (no synthetic fill).
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get("slug")?.trim();
  if (!slug) {
    return NextResponse.json({ error: "Missing slug" }, { status: 400 });
  }

  const points = await fetchMarketPriceHistoryPoints(slug);
  return NextResponse.json({ points });
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
    return NextResponse.json(
      { error: "Market not found or pool not ready" },
      { status: 404 },
    );
  }

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
  const result = await recordMarketPriceSnapshotFromChain({
    marketId: row.id,
    txSignature,
    connection,
    pairAddress,
    yesMint,
    noMint,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}

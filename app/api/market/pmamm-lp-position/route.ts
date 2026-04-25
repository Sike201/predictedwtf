import { PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";

import { getConnection } from "@/lib/solana/connection";
import { readPmammLpSnapshot } from "@/lib/solana/pmamm-read-lp";
import { getSupabaseAdmin } from "@/lib/supabase/server-client";
import type { MarketRecord } from "@/lib/types/market-record";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const slug = searchParams.get("slug")?.trim();
    const userWallet = searchParams.get("userWallet")?.trim();
    if (!slug || !userWallet) {
      return NextResponse.json(
        { error: "Missing slug or userWallet" },
        { status: 400 },
      );
    }
    let user: PublicKey;
    try {
      user = new PublicKey(userWallet);
    } catch {
      return NextResponse.json({ error: "Invalid userWallet" }, { status: 400 });
    }

    const sb = getSupabaseAdmin();
    if (!sb) {
      return NextResponse.json(
        { error: "Supabase is not configured" },
        { status: 503 },
      );
    }

    const { data: row, error } = await sb
      .from("markets")
      .select("slug,status,pool_address,market_engine")
      .eq("slug", slug)
      .maybeSingle();

    if (error || !row || (row as MarketRecord).market_engine !== "PM_AMM") {
      return NextResponse.json(
        { error: "Market not found or not a pmAMM market" },
        { status: 404 },
      );
    }

    const pool = (row as MarketRecord).pool_address;
    if (!pool || row.status !== "live") {
      return NextResponse.json({ error: "Market pool unavailable" }, {
        status: 400,
      });
    }

    const connection = getConnection();
    const snap = await readPmammLpSnapshot({
      connection,
      marketPda: new PublicKey(pool),
      owner: user,
    });

    return NextResponse.json({
      lpPositionPda: snap?.lpPositionPda ?? null,
      userShares: snap ? snap.userShares.toString() : "0",
      totalLpShares: snap ? snap.totalLpShares.toString() : "0",
    });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to read pmAMM LP position";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

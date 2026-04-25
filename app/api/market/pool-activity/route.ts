import { PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";

import {
  compareVolumePipelineToOrderbookEntry,
  logVolumeVsOrderbookDev,
} from "@/lib/market/volume-orderbook-compare";
import { fetchPoolOnchainActivity } from "@/lib/solana/fetch-pool-onchain-activity";
import { getConnection } from "@/lib/solana/connection";
import { getSupabaseAdmin } from "@/lib/supabase/server-client";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 40;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const slug = searchParams.get("slug")?.trim();
    const limitRaw = searchParams.get("limit");
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, Number.parseInt(limitRaw ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
    );

    if (!slug) {
      return NextResponse.json({ error: "Missing slug" }, { status: 400 });
    }

    const sb = getSupabaseAdmin();
    if (!sb) {
      return NextResponse.json(
        { error: "Server data store unavailable" },
        { status: 503 },
      );
    }

    const { data, error } = await sb
      .from("markets")
      .select("id,slug,status,pool_address,yes_mint,no_mint,market_engine,usdc_mint")
      .eq("slug", slug)
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json({ error: "Market not found" }, { status: 404 });
    }

    const row = data as {
      id: string;
      status: string;
      pool_address: string | null;
      yes_mint: string | null;
      no_mint: string | null;
      market_engine?: string | null;
      usdc_mint?: string | null;
    };

    if (
      row.status !== "live" ||
      !row.pool_address ||
      !row.yes_mint ||
      !row.no_mint
    ) {
      return NextResponse.json(
        { error: "Market has no live pool on record" },
        { status: 404 },
      );
    }

    const connection = getConnection();
    const yesPk = new PublicKey(row.yes_mint);
    const noPk = new PublicKey(row.no_mint);
    const engine = row.market_engine === "PM_AMM" ? "PM_AMM" : "GAMM";
    let collateralPk: PublicKey | undefined;
    if (engine === "PM_AMM" && row.usdc_mint) {
      try {
        collateralPk = new PublicKey(row.usdc_mint);
      } catch {
        collateralPk = undefined;
      }
    }

    const entries = await fetchPoolOnchainActivity(connection, {
      pairAddress: new PublicKey(row.pool_address),
      yesMint: yesPk,
      noMint: noPk,
      limit,
      ...(engine === "PM_AMM" && collateralPk
        ? { marketEngine: "PM_AMM" as const, collateralMint: collateralPk }
        : {}),
    });

    if (process.env.NODE_ENV === "development" && entries.length > 0) {
      const swapLike =
        entries.find((e) => /^(BUY|SELL) (YES|NO)$/.test(e.label)) ??
        entries[0]!;
      try {
        const cmp = await compareVolumePipelineToOrderbookEntry({
          connection,
          marketId: row.id,
          yesMint: yesPk,
          noMint: noPk,
          sample: swapLike,
        });
        logVolumeVsOrderbookDev(cmp);
      } catch (e) {
        console.warn("[predicted][volume-vs-orderbook] compare_failed", {
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return NextResponse.json({
      pairAddress: row.pool_address,
      entries,
      limit,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[predicted][pool-activity] error", msg);
    return NextResponse.json(
      { error: "Failed to load pool activity" },
      { status: 500 },
    );
  }
}

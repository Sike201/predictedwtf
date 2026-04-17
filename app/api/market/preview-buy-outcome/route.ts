import { PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";

import { getConnection } from "@/lib/solana/connection";
import { parseUsdcHumanToBaseUnits } from "@/lib/solana/mint-market-positions";
import {
  estimateBuyOutcomeFinalExposure,
  type BuyOutcomeSide,
} from "@/lib/solana/buy-outcome-with-usdc";
import { getSupabaseAdmin } from "@/lib/supabase/server-client";

export const runtime = "nodejs";

type Body = {
  slug?: string;
  side?: string;
  usdcAmountHuman?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const slug = body.slug?.trim();
    const sideRaw = body.side?.trim().toLowerCase();
    const usdcAmountHuman = body.usdcAmountHuman?.trim() ?? "";

    if (!slug) {
      return NextResponse.json({ error: "Missing slug" }, { status: 400 });
    }
    if (sideRaw !== "yes" && sideRaw !== "no") {
      return NextResponse.json({ error: 'side must be "yes" or "no"' }, { status: 400 });
    }
    const side = sideRaw as BuyOutcomeSide;

    const usdcAtoms = parseUsdcHumanToBaseUnits(usdcAmountHuman);
    if (usdcAtoms <= 0n) {
      return NextResponse.json(
        { error: "Enter a devnet USDC amount greater than zero" },
        { status: 400 },
      );
    }

    const sb = getSupabaseAdmin();
    if (!sb) {
      return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
    }

    const { data: row, error } = await sb
      .from("markets")
      .select("slug,status,yes_mint,no_mint,pool_address")
      .eq("slug", slug)
      .maybeSingle();
    if (error || !row) {
      return NextResponse.json({ error: "Market not found" }, { status: 404 });
    }
    if (row.status !== "live" || !row.yes_mint || !row.no_mint || !row.pool_address) {
      return NextResponse.json(
        { error: "Market must be live with outcome mints and pool" },
        { status: 400 },
      );
    }

    const est = await estimateBuyOutcomeFinalExposure({
      connection: getConnection(),
      side,
      yesMint: new PublicKey(row.yes_mint),
      noMint: new PublicKey(row.no_mint),
      pairAddress: new PublicKey(row.pool_address),
      usdcAmountAtoms: usdcAtoms,
    });
    return NextResponse.json({ estimate: est });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not preview buy route" },
      { status: 502 },
    );
  }
}


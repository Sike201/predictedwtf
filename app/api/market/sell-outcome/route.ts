import { PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";

import {
  buildSellOutcomeForUsdcTransactionEngineSigned,
  planSellOutcomeForUsdc,
  type SellOutcomeSide,
} from "@/lib/solana/sell-outcome-for-usdc";
import { getConnection } from "@/lib/solana/connection";
import { loadMarketEngineAuthority } from "@/lib/solana/treasury";
import { getSupabaseAdmin } from "@/lib/supabase/server-client";

export const runtime = "nodejs";

async function loadLiveMarketRow(slug: string) {
  const sb = getSupabaseAdmin();
  if (!sb) {
    return { error: "Supabase is not configured" as const, status: 503 as const };
  }
  const { data: row, error } = await sb
    .from("markets")
    .select("slug,status,yes_mint,no_mint,pool_address")
    .eq("slug", slug)
    .maybeSingle();

  if (error || !row) {
    return { error: "Market not found" as const, status: 404 as const };
  }

  if (row.status !== "live" || !row.yes_mint || !row.no_mint || !row.pool_address) {
    return {
      error: "Market must be live with outcome mints and pool" as const,
      status: 400 as const,
    };
  }

  return { row };
}

/**
 * Dry-run the same routing math as POST (no engine signature / no tx bytes).
 * Query: slug, side, outcomeAmountHuman, userWallet — wallet needed for ATA balances.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const slug = searchParams.get("slug")?.trim();
    const sideRaw = searchParams.get("side")?.trim().toLowerCase();
    const outcomeAmountHuman = searchParams.get("outcomeAmountHuman")?.trim() ?? "";
    const userWallet = searchParams.get("userWallet")?.trim();

    if (!slug || !userWallet || !outcomeAmountHuman) {
      return NextResponse.json(
        { error: "Missing slug, userWallet, or outcomeAmountHuman" },
        { status: 400 },
      );
    }

    if (sideRaw !== "yes" && sideRaw !== "no") {
      return NextResponse.json(
        { error: 'side must be "yes" or "no" (token to sell)' },
        { status: 400 },
      );
    }
    const side = sideRaw as SellOutcomeSide;

    let user: PublicKey;
    try {
      user = new PublicKey(userWallet);
    } catch {
      return NextResponse.json({ error: "Invalid userWallet" }, { status: 400 });
    }

    const loaded = await loadLiveMarketRow(slug);
    if ("error" in loaded && loaded.error) {
      return NextResponse.json(
        { error: loaded.error },
        { status: loaded.status },
      );
    }

    const connection = getConnection();
    const plan = await planSellOutcomeForUsdc({
      connection,
      user,
      side,
      yesMint: new PublicKey(loaded.row.yes_mint),
      noMint: new PublicKey(loaded.row.no_mint),
      pairAddress: new PublicKey(loaded.row.pool_address),
      outcomeAmountHuman,
      marketSlug: slug,
    });

    return NextResponse.json({ plan });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sell preview failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

type Body = {
  slug?: string;
  userWallet?: string;
  outcomeAmountHuman?: string;
  side?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const slug = body.slug?.trim();
    const userWallet = body.userWallet?.trim();
    const outcomeAmountHuman = body.outcomeAmountHuman?.trim() ?? "";
    const sideRaw = body.side?.trim().toLowerCase();

    if (!slug || !userWallet) {
      return NextResponse.json(
        { error: "Missing slug or userWallet" },
        { status: 400 },
      );
    }

    if (sideRaw !== "yes" && sideRaw !== "no") {
      return NextResponse.json(
        { error: 'side must be "yes" or "no" (token to sell)' },
        { status: 400 },
      );
    }
    const side = sideRaw as SellOutcomeSide;

    let user: PublicKey;
    try {
      user = new PublicKey(userWallet);
    } catch {
      return NextResponse.json({ error: "Invalid userWallet" }, { status: 400 });
    }

    const engine = loadMarketEngineAuthority();
    if (!engine) {
      return NextResponse.json(
        {
          error:
            "Server missing MARKET_ENGINE_AUTHORITY_SECRET — required to sign custody USDC release.",
        },
        { status: 503 },
      );
    }

    const loaded = await loadLiveMarketRow(slug);
    if ("error" in loaded && loaded.error) {
      return NextResponse.json(
        { error: loaded.error },
        { status: loaded.status },
      );
    }
    const { row } = loaded;

    const connection = getConnection();

    console.info(
      "[predicted][sell-outcome-usdc] api: building",
      JSON.stringify({ slug, user: userWallet, side }),
    );

    const { serialized, log, recentBlockhash, lastValidBlockHeight } =
      await buildSellOutcomeForUsdcTransactionEngineSigned({
        connection,
        engine,
        user,
        side,
        yesMint: new PublicKey(row.yes_mint!),
        noMint: new PublicKey(row.no_mint!),
        pairAddress: new PublicKey(row.pool_address!),
        outcomeAmountHuman,
        marketSlug: slug,
      });

    console.info(
      "[predicted][sell-outcome-usdc] api: built",
      JSON.stringify({
        slug,
        routeKind: log.routeKind,
        estimatedUsdcOutAtoms: log.usdcOutAtoms,
        recentBlockhash,
        lastValidBlockHeight,
        serializedBytes: serialized.length,
      }),
    );

    return NextResponse.json({
      transaction: Buffer.from(serialized).toString("base64"),
      log,
      recentBlockhash,
      lastValidBlockHeight,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sell outcome failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

import { PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";

import {
  buildBuyOutcomeWithUsdcTransactionEngineSigned,
  type BuyOutcomeSide,
} from "@/lib/solana/buy-outcome-with-usdc";
import { parseUsdcHumanToBaseUnits } from "@/lib/solana/mint-market-positions";
import { getConnection } from "@/lib/solana/connection";
import { loadMarketEngineAuthority } from "@/lib/solana/treasury";
import { getSupabaseAdmin } from "@/lib/supabase/server-client";

export const runtime = "nodejs";

const MAX_USDC_ATOMS = 10_000_000_000_000n;

type Body = {
  slug?: string;
  userWallet?: string;
  usdcAmountHuman?: string;
  side?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const slug = body.slug?.trim();
    const userWallet = body.userWallet?.trim();
    const usdcAmountHuman = body.usdcAmountHuman?.trim() ?? "";
    const sideRaw = body.side?.trim().toLowerCase();

    if (!slug || !userWallet) {
      return NextResponse.json(
        { error: "Missing slug or userWallet" },
        { status: 400 },
      );
    }

    if (sideRaw !== "yes" && sideRaw !== "no") {
      return NextResponse.json(
        { error: 'side must be "yes" or "no"' },
        { status: 400 },
      );
    }
    const side = sideRaw as BuyOutcomeSide;

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
            "Server missing MARKET_ENGINE_AUTHORITY_SECRET — required to mint outcomes.",
        },
        { status: 503 },
      );
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

    const usdcAtoms = parseUsdcHumanToBaseUnits(usdcAmountHuman);
    if (usdcAtoms <= 0n) {
      return NextResponse.json(
        { error: "Enter a devnet USDC amount greater than zero" },
        { status: 400 },
      );
    }

    if (usdcAtoms > MAX_USDC_ATOMS) {
      return NextResponse.json({ error: "Amount exceeds cap" }, { status: 400 });
    }

    const connection = getConnection();

    console.info(
      "[predicted][buy-outcome-usdc] api: building transaction",
      JSON.stringify({ slug, user: userWallet, side: sideRaw }),
    );

    const { serialized, log, recentBlockhash, lastValidBlockHeight } =
      await buildBuyOutcomeWithUsdcTransactionEngineSigned({
        connection,
        engine,
        user,
        side,
        yesMint: new PublicKey(row.yes_mint),
        noMint: new PublicKey(row.no_mint),
        pairAddress: new PublicKey(row.pool_address),
        usdcAmountAtoms: usdcAtoms,
        marketSlug: slug,
      });

    console.info(
      "[predicted][buy-outcome-usdc] api: transaction built",
      JSON.stringify({
        slug,
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
    const message = e instanceof Error ? e.message : "Buy outcome failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

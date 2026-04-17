import { PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";

import {
  buildMintPositionsTransactionEngineSigned,
  parseUsdcHumanToBaseUnits,
} from "@/lib/solana/mint-market-positions";
import { getConnection } from "@/lib/solana/connection";
import { loadMarketEngineAuthority } from "@/lib/solana/treasury";
import { getSupabaseAdmin } from "@/lib/supabase/server-client";

export const runtime = "nodejs";

const MAX_USDC_ATOMS = 10_000_000_000_000n; // 10M USDC (6 dp) — safety cap

type Body = {
  slug?: string;
  userWallet?: string;
  usdcAmountHuman?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const slug = body.slug?.trim();
    const userWallet = body.userWallet?.trim();
    const usdcAmountHuman = body.usdcAmountHuman?.trim() ?? "";

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

    const engine = loadMarketEngineAuthority();
    if (!engine) {
      return NextResponse.json(
        {
          error:
            "Server missing MARKET_ENGINE_AUTHORITY_SECRET — cannot co-sign outcome mints.",
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
      .select(
        "slug,status,yes_mint,no_mint",
      )
      .eq("slug", slug)
      .maybeSingle();

    if (error || !row) {
      return NextResponse.json({ error: "Market not found" }, { status: 404 });
    }

    if (row.status !== "live" || !row.yes_mint || !row.no_mint) {
      return NextResponse.json(
        { error: "Market must be live with outcome mints" },
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

    const { serialized, outcomeMintAtoms } =
      await buildMintPositionsTransactionEngineSigned({
        connection,
        engine,
        user,
        yesMint: new PublicKey(row.yes_mint),
        noMint: new PublicKey(row.no_mint),
        usdcAmountAtoms: usdcAtoms,
      });

    return NextResponse.json({
      transaction: Buffer.from(serialized).toString("base64"),
      outcomeMintAtoms: outcomeMintAtoms.toString(),
      usdcAtoms: usdcAtoms.toString(),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Mint positions failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

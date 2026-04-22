import { PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";

import {
  buildLeverageNoFromUsdcTransactionEngineSigned,
  buildLeverageYesFromUsdcTransactionEngineSigned,
} from "@/lib/solana/omnipair-leverage-from-usdc";
import { parseUsdcHumanToBaseUnits } from "@/lib/solana/mint-market-positions";
import { getConnection } from "@/lib/solana/connection";
import {
  isMarketRecordResolved,
  isMarketRowBlockedForNewBuys,
  MARKET_RESOLVED_TRADING_ERROR,
  MARKET_RESOLVING_TRADING_ERROR,
} from "@/lib/market/market-trading-blocked";
import { loadMarketEngineAuthority } from "@/lib/solana/treasury";
import { getSupabaseAdmin } from "@/lib/supabase/server-client";
import type { MarketRecord } from "@/lib/types/market-record";

export const runtime = "nodejs";

const MAX_USDC_ATOMS = 10_000_000_000_000n;

type Body = {
  slug?: string;
  userWallet?: string;
  usdcAmountHuman?: string;
  side?: string;
  leverageSlider01?: number;
  slippageBps?: number;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const slug = body.slug?.trim();
    const userWallet = body.userWallet?.trim();
    const usdcAmountHuman = body.usdcAmountHuman?.trim() ?? "";
    const sideRaw = body.side?.trim().toLowerCase();
    const leverageSlider01 =
      typeof body.leverageSlider01 === "number" &&
      Number.isFinite(body.leverageSlider01)
        ? body.leverageSlider01
        : 1;
    const slippageBps =
      typeof body.slippageBps === "number" && Number.isFinite(body.slippageBps)
        ? Math.min(5000, Math.max(0, Math.floor(body.slippageBps)))
        : 150;

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
      .select(
        "slug,status,resolution_status,resolve_after,expiry_ts,yes_mint,no_mint,pool_address",
      )
      .eq("slug", slug)
      .maybeSingle();

    if (error || !row) {
      return NextResponse.json({ error: "Market not found" }, { status: 404 });
    }

    const rec = row as MarketRecord;
    if (isMarketRowBlockedForNewBuys(rec)) {
      return NextResponse.json(
        {
          error: isMarketRecordResolved(row)
            ? MARKET_RESOLVED_TRADING_ERROR
            : MARKET_RESOLVING_TRADING_ERROR,
        },
        { status: 400 },
      );
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
    const pairAddress = new PublicKey(row.pool_address);
    const yesMint = new PublicKey(row.yes_mint);
    const noMint = new PublicKey(row.no_mint);

    if (sideRaw === "yes") {
      const built = await buildLeverageYesFromUsdcTransactionEngineSigned({
        connection,
        engine,
        user,
        pairAddress,
        yesMint,
        noMint,
        usdcAmountAtoms: usdcAtoms,
        slippageBps,
        leverageSlider01,
      });

      const serialized = built.transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      });

    console.info(
      "[predicted][leverage-submit][api]",
      "tx_built_yes",
      JSON.stringify({
        slug,
        user: userWallet,
        log: built.log,
        recentBlockhash: built.recentBlockhash,
        lastValidBlockHeight: built.lastValidBlockHeight,
      }),
    );

      return NextResponse.json({
        transaction: Buffer.from(serialized).toString("base64"),
        log: built.log,
        recentBlockhash: built.recentBlockhash,
        lastValidBlockHeight: built.lastValidBlockHeight,
      });
    }

    const built = await buildLeverageNoFromUsdcTransactionEngineSigned({
      connection,
      engine,
      user,
      pairAddress,
      yesMint,
      noMint,
      usdcAmountAtoms: usdcAtoms,
      slippageBps,
      leverageSlider01,
    });

    const serialized = built.transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });

    console.info(
      "[predicted][leverage-submit][api]",
      "tx_built_no",
      JSON.stringify({
        slug,
        user: userWallet,
        log: built.log,
        recentBlockhash: built.recentBlockhash,
        lastValidBlockHeight: built.lastValidBlockHeight,
      }),
    );

    return NextResponse.json({
      transaction: Buffer.from(serialized).toString("base64"),
      log: built.log,
      recentBlockhash: built.recentBlockhash,
      lastValidBlockHeight: built.lastValidBlockHeight,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Leverage failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

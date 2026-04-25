import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";

import { pmammBuildDepositLiquidityUserTransaction } from "@/lib/engines/pmamm";
import { buildProvideLiquidityWithUsdcTransactionEngineSigned } from "@/lib/solana/provide-liquidity-usdc";
import { parseUsdcHumanToBaseUnits } from "@/lib/solana/mint-market-positions";
import { getConnection } from "@/lib/solana/connection";
import { loadMarketEngineAuthority } from "@/lib/solana/treasury";
import {
  isMarketRecordResolved,
  isMarketRowBlockedForNewBuys,
  MARKET_RESOLVED_TRADING_ERROR,
  MARKET_RESOLVING_TRADING_ERROR,
} from "@/lib/market/market-trading-blocked";
import { getSupabaseAdmin } from "@/lib/supabase/server-client";
import type { MarketRecord } from "@/lib/types/market-record";
import { readOmnipairPoolState } from "@/lib/solana/read-omnipair-pool-state";

export const runtime = "nodejs";

const MAX_USDC_ATOMS = 10_000_000_000_000n;

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
        "slug,status,resolution_status,resolve_after,expiry_ts,yes_mint,no_mint,pool_address,market_engine",
      )
      .eq("slug", slug)
      .maybeSingle();

    if (error || !row) {
      return NextResponse.json({ error: "Market not found" }, { status: 404 });
    }

    if (isMarketRowBlockedForNewBuys(row as MarketRecord)) {
      return NextResponse.json(
        {
          error: isMarketRecordResolved(row)
            ? MARKET_RESOLVED_TRADING_ERROR
            : MARKET_RESOLVING_TRADING_ERROR,
        },
        { status: 400 },
      );
    }

    if (
      row.status !== "live" ||
      !row.yes_mint ||
      !row.no_mint ||
      !row.pool_address
    ) {
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
    const rec = row as MarketRecord;

    if (rec.market_engine === "PM_AMM") {
      const tx = await pmammBuildDepositLiquidityUserTransaction({
        connection,
        user,
        marketPda: new PublicKey(rec.pool_address!),
        amountAtoms: new BN(usdcAtoms.toString()),
      });
      const serialized = tx.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      });
      console.info(
        "[predicted][lp-action]",
        JSON.stringify({
          slug,
          action: "deposit_pmamm",
          usdcAmountAtoms: usdcAtoms.toString(),
          user: userWallet,
        }),
      );
      return NextResponse.json({
        transaction: Buffer.from(serialized).toString("base64"),
        log: { engine: "PM_AMM" },
        recentBlockhash: tx.recentBlockhash ?? undefined,
        lastValidBlockHeight: undefined,
      });
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

    const pairAddress = new PublicKey(row.pool_address);
    const yesMint = new PublicKey(row.yes_mint);
    const noMint = new PublicKey(row.no_mint);

    const poolStateBefore = await readOmnipairPoolState(connection, {
      pairAddress,
      yesMint,
      noMint,
    });

    console.info(
      "[predicted][lp-action]",
      JSON.stringify({
        slug,
        action: "deposit",
        usdcAmountAtoms: usdcAtoms.toString(),
        user: userWallet,
        poolStateBefore: {
          pair: poolStateBefore.pairAddress,
          reserveYes: poolStateBefore.reserveYes.toString(),
          reserveNo: poolStateBefore.reserveNo.toString(),
        },
        poolStateAfter: null,
        note: "after state pending tx confirmation; client may refresh + log",
      }),
    );

    const { serialized, log, recentBlockhash, lastValidBlockHeight } =
      await buildProvideLiquidityWithUsdcTransactionEngineSigned({
        connection,
        engine,
        user,
        yesMint,
        noMint,
        pairAddress,
        usdcAmountAtoms: usdcAtoms,
        marketSlug: slug,
      });

    console.info(
      "[predicted][lp-action] tx built",
      JSON.stringify({ slug, user: userWallet, recentBlockhash }),
    );

    return NextResponse.json({
      transaction: Buffer.from(serialized).toString("base64"),
      log,
      recentBlockhash,
      lastValidBlockHeight,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Provide liquidity failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

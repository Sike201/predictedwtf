import { PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import { NextResponse } from "next/server";

import {
  isMarketRecordResolved,
  isMarketRowBlockedForNewBuys,
  MARKET_RESOLVED_TRADING_ERROR,
  MARKET_RESOLVING_TRADING_ERROR,
} from "@/lib/market/market-trading-blocked";
import { getSupabaseAdmin } from "@/lib/supabase/server-client";
import type { MarketRecord } from "@/lib/types/market-record";
import { getConnection } from "@/lib/solana/connection";
import { readOmnipairPoolState } from "@/lib/solana/read-omnipair-pool-state";
import { loadMarketEngineAuthority } from "@/lib/solana/treasury";
import {
  buildWithdrawOmnipairLiquidityToUsdcTransactionEngineSigned,
  planWithdrawOmnipairLiquidityToUsdc,
  readUserOmnipairLpBalance,
} from "@/lib/solana/withdraw-omnipair-liquidity-to-usdc";

export const runtime = "nodejs";

const MAX_LP_ATOMS = 10_000_000_000_000_000n;

function parseLpHumanToAtoms(raw: string, decimals: number): bigint {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  if (!cleaned || cleaned === ".") return 0n;
  const [wholeRaw, fracRaw = ""] = cleaned.split(".");
  const whole = wholeRaw || "0";
  const fracPadded = (fracRaw + "0".repeat(decimals)).slice(0, decimals);
  return (
    BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fracPadded || "0")
  );
}

function parseLiquidityIn(params: {
  liquidityHuman: string;
  liquidityAtomsStr: string | undefined;
  lpDecimals: number;
}): bigint {
  const raw = params.liquidityAtomsStr?.trim();
  if (raw && /^\d+$/.test(raw)) {
    return BigInt(raw);
  }
  return parseLpHumanToAtoms(params.liquidityHuman, params.lpDecimals);
}

type Body = {
  slug?: string;
  userWallet?: string;
  liquidityHuman?: string;
  /** Exact omLP atoms (string bigint). Preferred over human to avoid rounding. */
  liquidityAtoms?: string;
};

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const slug = searchParams.get("slug")?.trim();
    const userWallet = searchParams.get("userWallet")?.trim();
    const liquidityHuman = searchParams.get("liquidityHuman")?.trim() ?? "";
    const liquidityAtoms = searchParams.get("liquidityAtoms")?.trim() ?? "";

    if (!slug || !userWallet || (!liquidityHuman && !liquidityAtoms)) {
      return NextResponse.json(
        {
          error:
            "Missing slug, userWallet, or liquidity amount (human or liquidityAtoms)",
        },
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
        "slug,status,resolution_status,resolve_after,expiry_ts,yes_mint,no_mint,pool_address",
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

    const connection = getConnection();
    const pairAddress = new PublicKey(row.pool_address);
    const yesMint = new PublicKey(row.yes_mint);
    const noMint = new PublicKey(row.no_mint);

    const poolState = await readOmnipairPoolState(connection, {
      pairAddress,
      yesMint,
      noMint,
    });
    const lpMint = new PublicKey(poolState.lpMint);
    const lpDecimals = (await getMint(connection, lpMint)).decimals;
    const liquidityIn = parseLiquidityIn({
      liquidityHuman,
      liquidityAtomsStr: liquidityAtoms || undefined,
      lpDecimals,
    });

    if (liquidityIn <= 0n) {
      return NextResponse.json(
        { error: "Enter an omLP amount greater than zero" },
        { status: 400 },
      );
    }
    if (liquidityIn > MAX_LP_ATOMS) {
      return NextResponse.json({ error: "Amount exceeds cap" }, { status: 400 });
    }

    const { amount: userLpBal } = await readUserOmnipairLpBalance(
      connection,
      user,
      lpMint,
    );
    if (liquidityIn > userLpBal) {
      return NextResponse.json(
        { error: "Amount exceeds your omLP balance. Refresh and try Max." },
        { status: 400 },
      );
    }

    const { plan, removeLog } = await planWithdrawOmnipairLiquidityToUsdc({
      connection,
      user,
      yesMint,
      noMint,
      pairAddress,
      liquidityIn,
      marketSlug: slug,
      liquidityHuman,
      lpDecimals,
    });

    return NextResponse.json({ plan, removeLog });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Withdraw liquidity preview failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const slug = body.slug?.trim();
    const userWallet = body.userWallet?.trim();
    const liquidityHuman = body.liquidityHuman?.trim() ?? "";
    const liquidityAtoms = body.liquidityAtoms?.trim() ?? "";

    if (!slug || !userWallet) {
      return NextResponse.json(
        { error: "Missing slug or userWallet" },
        { status: 400 },
      );
    }
    if (!liquidityHuman && !liquidityAtoms) {
      return NextResponse.json(
        { error: "Missing liquidityHuman or liquidityAtoms" },
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
            "Server missing MARKET_ENGINE_AUTHORITY_SECRET — required to redeem to USDC.",
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

    const connection = getConnection();
    const pairAddress = new PublicKey(row.pool_address);
    const yesMint = new PublicKey(row.yes_mint);
    const noMint = new PublicKey(row.no_mint);

    const poolState = await readOmnipairPoolState(connection, {
      pairAddress,
      yesMint,
      noMint,
    });
    const lpMint = new PublicKey(poolState.lpMint);
    const lpDecimals = (await getMint(connection, lpMint)).decimals;
    const liquidityIn = parseLiquidityIn({
      liquidityHuman,
      liquidityAtomsStr: liquidityAtoms || undefined,
      lpDecimals,
    });

    if (liquidityIn <= 0n) {
      return NextResponse.json(
        { error: "Enter an omLP amount greater than zero" },
        { status: 400 },
      );
    }
    if (liquidityIn > MAX_LP_ATOMS) {
      return NextResponse.json({ error: "Amount exceeds cap" }, { status: 400 });
    }

    const { amount: userLpBal } = await readUserOmnipairLpBalance(
      connection,
      user,
      lpMint,
    );
    if (liquidityIn > userLpBal) {
      return NextResponse.json(
        { error: "Amount exceeds your omLP balance. Refresh and try Max." },
        { status: 400 },
      );
    }

    const { serialized, log, recentBlockhash, lastValidBlockHeight } =
      await buildWithdrawOmnipairLiquidityToUsdcTransactionEngineSigned({
        connection,
        engine,
        user,
        yesMint,
        noMint,
        pairAddress,
        liquidityIn,
        marketSlug: slug,
        liquidityHuman: liquidityHuman || undefined,
        lpDecimals,
      });

    console.info(
      "[predicted][lp-action]",
      JSON.stringify({
        slug,
        action: "withdraw_usdc",
        user: userWallet,
        liquidityIn: liquidityIn.toString(),
        usdcOutAtoms: log.redeem.usdcOutAtoms,
        recentBlockhash,
      }),
    );

    return NextResponse.json({
      transaction: Buffer.from(serialized).toString("base64"),
      log,
      recentBlockhash,
      lastValidBlockHeight,
    });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Withdraw liquidity failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

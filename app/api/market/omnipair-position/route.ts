import { PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";

import { deriveMarketProbabilityFromPoolState } from "@/lib/market/derive-market-probability";
import { getConnection } from "@/lib/solana/connection";
import { decodeOmnipairPairAccount } from "@/lib/solana/decode-omnipair-accounts";
import { summarizeLeverageRiskDisplay } from "@/lib/solana/omnipair-leverage-health";
import { readOmnipairUserPositionSnapshot } from "@/lib/solana/read-omnipair-position";
import { getSupabaseAdmin } from "@/lib/supabase/server-client";

export const runtime = "nodejs";

function atomsString(n: bigint): string {
  return n.toString();
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const slug = searchParams.get("slug")?.trim();
    const wallet = searchParams.get("wallet")?.trim();

    if (!slug) {
      return NextResponse.json({ error: "Missing slug" }, { status: 400 });
    }
    if (!wallet) {
      return NextResponse.json({ error: "Missing wallet" }, { status: 400 });
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
      .select("pool_address,yes_mint,no_mint,market_engine")
      .eq("slug", slug)
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json({ error: "Market not found" }, { status: 404 });
    }

    const row = data as {
      pool_address: string | null;
      yes_mint: string | null;
      no_mint: string | null;
      market_engine?: string | null;
    };

    if (row.market_engine === "PM_AMM") {
      return NextResponse.json({
        snapshot: null,
        userPositionPda: null,
        note: "PM_AMM markets do not use Omnipair lending positions.",
      });
    }

    if (!row.pool_address || !row.yes_mint || !row.no_mint) {
      return NextResponse.json(
        { error: "Market has no Omnipair pool on record", snapshot: null },
        { status: 200 },
      );
    }

    let owner: PublicKey;
    try {
      owner = new PublicKey(wallet);
    } catch {
      return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
    }

    const connection = getConnection();
    const pairAddress = new PublicKey(row.pool_address);
    const yesMint = new PublicKey(row.yes_mint);
    const noMint = new PublicKey(row.no_mint);

    const snapshot = await readOmnipairUserPositionSnapshot({
      connection,
      pairAddress,
      yesMint,
      noMint,
      owner,
    });

    if (!snapshot) {
      return NextResponse.json({
        snapshot: null,
        userPositionPda: null,
        note:
          "No UserPosition account for this wallet — no deposited collateral / debt on-chain.",
      });
    }

    const pairAccount = await connection.getAccountInfo(pairAddress, "confirmed");
    if (!pairAccount?.data) {
      return NextResponse.json(
        { error: "Pair account missing on-chain" },
        { status: 500 },
      );
    }
    const pairDecoded = decodeOmnipairPairAccount(Buffer.from(pairAccount.data));
    const yesIsToken0 = yesMint.equals(pairDecoded.token0);
    const reserveYes = yesIsToken0 ? pairDecoded.reserve0 : pairDecoded.reserve1;
    const reserveNo = yesIsToken0 ? pairDecoded.reserve1 : pairDecoded.reserve0;
    const spot = deriveMarketProbabilityFromPoolState({ reserveYes, reserveNo });

    const risk = summarizeLeverageRiskDisplay({
      position: snapshot,
      pair: pairDecoded,
    });

    return NextResponse.json({
      snapshot: {
        userPositionPda: snapshot.userPositionPda.toBase58(),
        yesMint: snapshot.yesMint.toBase58(),
        noMint: snapshot.noMint.toBase58(),
        token0Mint: snapshot.token0Mint.toBase58(),
        token1Mint: snapshot.token1Mint.toBase58(),
        yesIsToken0: snapshot.yesIsToken0,
        collateralYesAtoms: atomsString(snapshot.collateralYesAtoms),
        collateralNoAtoms: atomsString(snapshot.collateralNoAtoms),
        debtYesAtoms: atomsString(snapshot.debtYesAtoms),
        debtNoAtoms: atomsString(snapshot.debtNoAtoms),
        collateral0Atoms: atomsString(snapshot.collateral0Atoms),
        collateral1Atoms: atomsString(snapshot.collateral1Atoms),
        debt0Shares: atomsString(snapshot.debt0Shares),
        debt1Shares: atomsString(snapshot.debt1Shares),
        liquidationCfYesBps: snapshot.yesIsToken0
          ? snapshot.raw.collateral0LiquidationCfBps
          : snapshot.raw.collateral1LiquidationCfBps,
        liquidationCfNoBps: snapshot.yesIsToken0
          ? snapshot.raw.collateral1LiquidationCfBps
          : snapshot.raw.collateral0LiquidationCfBps,
        liquidationCf0Bps: snapshot.raw.collateral0LiquidationCfBps,
        liquidationCf1Bps: snapshot.raw.collateral1LiquidationCfBps,
        healthFactorApprox: risk.healthFactorApprox,
        liquidationRiskLabel: risk.riskLabel,
        spotYesProbability: spot?.yesProbability ?? null,
        spotNoProbability: spot?.noProbability ?? null,
      },
      protocolNote:
        "Lending positions are fully on-chain. Health uses spot pool reserves as a coarse estimate; the Omnipair program applies EMA-based pessimistic factors on-chain.",
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to read position";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

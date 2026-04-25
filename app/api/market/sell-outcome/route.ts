import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";

import {
  buildSellOutcomeForUsdcTransactionEngineSigned,
  planSellOutcomeForUsdc,
  type SellOutcomePlan,
  type SellOutcomeSide,
} from "@/lib/solana/sell-outcome-for-usdc";
import {
  pmammBuildClaimWinningsTransaction,
  pmammBuildSellOutcomeTransaction,
} from "@/lib/engines/pmamm";
import { parsePmammOutcomeHumanToAtoms } from "@/lib/solana/pmamm-amounts";
import { getConnection } from "@/lib/solana/connection";
import {
  buildResolvedWinnerRedeemTransactionEngineSigned,
  planResolvedWinnerRedeem,
} from "@/lib/solana/resolved-winner-redeem-usdc";
import { loadMarketEngineAuthority } from "@/lib/solana/treasury";
import {
  isMarketRowBlockedForSells,
  MARKET_RESOLVING_TRADING_ERROR,
} from "@/lib/market/market-trading-blocked";
import { getSupabaseAdmin } from "@/lib/supabase/server-client";
import type { MarketRecord } from "@/lib/types/market-record";

export const runtime = "nodejs";

function winningOutcomeForResolved(
  rec: MarketRecord,
): "yes" | "no" | null {
  if (rec.resolution_status !== "resolved") return null;
  const v = rec.resolved_outcome?.trim().toLowerCase() ?? "";
  if (v === "yes" || v === "no") return v;
  return null;
}

async function loadLiveMarketRow(slug: string) {
  const sb = getSupabaseAdmin();
  if (!sb) {
    return { error: "Supabase is not configured" as const, status: 503 as const };
  }
  const { data: row, error } = await sb
    .from("markets")
    .select(
      "slug,status,resolution_status,resolved_outcome,resolve_after,expiry_ts,yes_mint,no_mint,pool_address,market_engine",
    )
    .eq("slug", slug)
    .maybeSingle();

  if (error || !row) {
    return { error: "Market not found" as const, status: 404 as const };
  }

  const rec = row as MarketRecord;
  if (isMarketRowBlockedForSells(rec)) {
    return {
      error: MARKET_RESOLVING_TRADING_ERROR,
      status: 400 as const,
    };
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
    const rec = loaded.row as MarketRecord;
    if (rec.market_engine === "PM_AMM") {
      const atoms = parsePmammOutcomeHumanToAtoms(outcomeAmountHuman);
      if (atoms <= 0n) {
        return NextResponse.json(
          { error: "Enter an outcome amount greater than zero" },
          { status: 400 },
        );
      }
      if (rec.resolution_status === "resolved") {
        const win = winningOutcomeForResolved(rec);
        if (win === null || side !== win) {
          return NextResponse.json(
            {
              error:
                win === null
                  ? "Market is resolved but the winning outcome is not set in the record."
                  : "After resolution, only the winning outcome can be redeemed.",
            },
            { status: 400 },
          );
        }
        const plan: SellOutcomePlan = {
          routeKind: "resolved_winner_redeem",
          reserveYes: "0",
          reserveNo: "0",
          requestedCapOutcomeAtoms: atoms.toString(),
          eligiblePairedBurnOutcomeAtoms: "0",
          pairedBurnOutcomeAtoms: "0",
          custodyUsdcAtoms: "0",
          usdcOutAtoms: atoms.toString(),
          rebalanceSwapAmountIn: "0",
          leftoverYesAtoms: "0",
          leftoverNoAtoms: "0",
          uiSummary: "pmAMM claim winnings (post-resolution).",
          winningBurnOutcomeAtoms: atoms.toString(),
        };
        return NextResponse.json({ plan });
      }
      const plan: SellOutcomePlan = {
        routeKind: "fallback_pool_swap",
        reserveYes: "0",
        reserveNo: "0",
        requestedCapOutcomeAtoms: atoms.toString(),
        eligiblePairedBurnOutcomeAtoms: "0",
        pairedBurnOutcomeAtoms: "0",
        custodyUsdcAtoms: "0",
        usdcOutAtoms: "0",
        rebalanceSwapAmountIn: "0",
        leftoverYesAtoms: "0",
        leftoverNoAtoms: "0",
        fallbackSwapAmountIn: atoms.toString(),
        fallbackOppositeMinOut: "0",
        uiSummary: "pmAMM swap outcome → USDC.",
      };
      return NextResponse.json({ plan });
    }

    if (rec.resolution_status === "resolved") {
      const win = winningOutcomeForResolved(rec);
      if (win === null) {
        return NextResponse.json(
          {
            error:
              "Market is resolved but the winning outcome is not set in the record.",
          },
          { status: 400 },
        );
      }
      if (side !== win) {
        return NextResponse.json(
          {
            error:
              "After resolution, only the winning outcome can be redeemed. The losing side has no value.",
          },
          { status: 400 },
        );
      }
      const r = await planResolvedWinnerRedeem({
        connection,
        user,
        side,
        winningOutcome: win,
        yesMint: new PublicKey(rec.yes_mint!),
        noMint: new PublicKey(rec.no_mint!),
        outcomeAmountHuman,
        marketSlug: slug,
      });
      const plan: SellOutcomePlan = {
        ...r,
        fallbackSwapAmountIn: undefined,
        fallbackOppositeMinOut: undefined,
      };
      return NextResponse.json({ plan });
    }

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

    const loaded = await loadLiveMarketRow(slug);
    if ("error" in loaded && loaded.error) {
      return NextResponse.json(
        { error: loaded.error },
        { status: loaded.status },
      );
    }
    const { row } = loaded;
    const rec = row as MarketRecord;

    const connection = getConnection();

    console.info(
      "[predicted][sell-outcome-usdc] api: building",
      JSON.stringify({ slug, user: userWallet, side }),
    );

    if (rec.market_engine === "PM_AMM") {
      const marketPk = new PublicKey(rec.pool_address!);
      const atoms = parsePmammOutcomeHumanToAtoms(outcomeAmountHuman);
      if (atoms <= 0n) {
        return NextResponse.json(
          { error: "Enter an outcome amount greater than zero" },
          { status: 400 },
        );
      }
      const win = winningOutcomeForResolved(rec);
      if (rec.resolution_status === "resolved") {
        if (win === null) {
          return NextResponse.json(
            {
              error:
                "Market is resolved but the winning outcome is not set in the record.",
            },
            { status: 400 },
          );
        }
        if (side !== win) {
          return NextResponse.json(
            {
              error:
                "After resolution, only the winning outcome can be redeemed. The losing side has no value.",
            },
            { status: 400 },
          );
        }
        const tx = await pmammBuildClaimWinningsTransaction({
          connection,
          user,
          marketPda: marketPk,
          amount: new BN(atoms.toString()),
        });
        const serialized = tx.serialize({
          requireAllSignatures: false,
          verifySignatures: false,
        });
        return NextResponse.json({
          transaction: Buffer.from(serialized).toString("base64"),
          log: {
            routeKind: "resolved_winner_redeem" as const,
            engine: "PM_AMM",
            usdcOutAtoms: atoms.toString(),
          },
          recentBlockhash: tx.recentBlockhash ?? undefined,
          lastValidBlockHeight: undefined,
        });
      }

      const tx = await pmammBuildSellOutcomeTransaction({
        connection,
        user,
        marketPda: marketPk,
        sellSide: side,
        amountInAtoms: new BN(atoms.toString()),
        minOut: new BN(0),
      });
      const serialized = tx.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      });
      return NextResponse.json({
        transaction: Buffer.from(serialized).toString("base64"),
        log: {
          routeKind: "fallback_pool_swap" as const,
          engine: "PM_AMM",
        },
        recentBlockhash: tx.recentBlockhash ?? undefined,
        lastValidBlockHeight: undefined,
      });
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

    const win = winningOutcomeForResolved(rec);
    if (rec.resolution_status === "resolved") {
      if (win === null) {
        return NextResponse.json(
          {
            error:
              "Market is resolved but the winning outcome is not set in the record.",
          },
          { status: 400 },
        );
      }
      if (side !== win) {
        return NextResponse.json(
          {
            error:
              "After resolution, only the winning outcome can be redeemed. The losing side has no value.",
          },
          { status: 400 },
        );
      }
      const { serialized, log, recentBlockhash, lastValidBlockHeight } =
        await buildResolvedWinnerRedeemTransactionEngineSigned({
          connection,
          engine,
          user,
          side,
          winningOutcome: win,
          yesMint: new PublicKey(rec.yes_mint!),
          noMint: new PublicKey(rec.no_mint!),
          poolAddress: new PublicKey(rec.pool_address!),
          outcomeAmountHuman,
          marketSlug: slug,
        });

      console.info(
        "[predicted][sell-outcome-usdc] api: built (resolved)",
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
    }

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

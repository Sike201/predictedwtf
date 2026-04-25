import { NextResponse } from "next/server";
import { createMarketPipeline } from "@/lib/market/create-market";
import type { MarketDraft, MarketEngine } from "@/lib/types/market";

export const runtime = "nodejs";

type CreateBody = {
  draft?: MarketDraft;
  creatorWallet?: string;
  resolverWallet?: string;
  category?: string;
  yesCondition?: string;
  noCondition?: string;
  imageDataUrl?: string;
  engine?: MarketEngine;
  /** Human USDC (6 dp) for pmAMM initial `deposit_liquidity` only. */
  initialLiquidityUsdc?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as CreateBody;
    const draft = body.draft;
    const creatorWallet = body.creatorWallet?.trim();

    console.info("[predicted][api/create] POST", {
      hasDraft: Boolean(draft),
      hasCreatorWallet: Boolean(creatorWallet),
      hasImage: Boolean(body.imageDataUrl?.trim?.()),
    });

    if (!draft || !creatorWallet) {
      return NextResponse.json(
        { error: "Missing draft or creatorWallet" },
        { status: 400 },
      );
    }

    const result = await createMarketPipeline({
      draft,
      creatorWallet,
      resolverWallet: body.resolverWallet,
      category: body.category,
      yesCondition: body.yesCondition,
      noCondition: body.noCondition,
      imageDataUrl: body.imageDataUrl,
      engine: body.engine,
      initialLiquidityUsdc: body.initialLiquidityUsdc,
    });

    if (!result.ok) {
      console.error("[predicted][api/create] pipeline failed", {
        error: result.error,
        stage: result.stage,
        missingProgramId: result.missingProgramId,
      });
      return NextResponse.json(
        {
          error: result.error,
          stage: result.stage,
          missingProgramId: result.missingProgramId,
          outcomeAtaContext: result.outcomeAtaContext,
        },
        { status: 502 },
      );
    }

    if (result.pmammAwaitingUserDeposit) {
      console.info("[predicted][api/create] pmAMM awaiting user deposit", {
        slug: result.market.slug,
      });
      return NextResponse.json({
        market: result.market,
        phase: "pmamm_await_user_deposit",
        depositTransaction: result.pmammAwaitingUserDeposit.depositTransactionBase64,
      });
    }

    if (!result.market?.slug) {
      console.error(
        "[predicted][api/create] success but market missing slug",
        result,
      );
    } else {
      console.info("[predicted][api/create] success", { slug: result.market.slug });
    }
    return NextResponse.json({ market: result.market });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Create market failed";
    console.error("[predicted][api/create] exception", e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

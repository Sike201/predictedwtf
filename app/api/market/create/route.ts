import { NextResponse } from "next/server";
import { createMarketPipeline } from "@/lib/market/create-market";
import type { MarketDraft } from "@/lib/types/market";

export const runtime = "nodejs";

type CreateBody = {
  draft?: MarketDraft;
  creatorWallet?: string;
  resolverWallet?: string;
  category?: string;
  yesCondition?: string;
  noCondition?: string;
  imageDataUrl?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as CreateBody;
    const draft = body.draft;
    const creatorWallet = body.creatorWallet?.trim();

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
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error,
          stage: result.stage,
          missingProgramId: result.missingProgramId,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({ market: result.market });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Create market failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

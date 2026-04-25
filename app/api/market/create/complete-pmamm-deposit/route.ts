import { NextResponse } from "next/server";

import { completePmammUserDepositPipeline } from "@/lib/market/create-market";

export const runtime = "nodejs";

type Body = {
  slug?: string;
  creatorWallet?: string;
  depositSignature?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const slug = body.slug?.trim();
    const creatorWallet = body.creatorWallet?.trim();
    const depositSignature = body.depositSignature?.trim();

    if (!slug || !creatorWallet || !depositSignature) {
      return NextResponse.json(
        { error: "Missing slug, creatorWallet, or depositSignature." },
        { status: 400 },
      );
    }

    const result = await completePmammUserDepositPipeline({
      slug,
      creatorWallet,
      depositSignature,
    });

    if (!result.ok) {
      console.error("[predicted][api/complete-pmamm-deposit] failed", {
        error: result.error,
        stage: result.stage,
      });
      return NextResponse.json(
        {
          error: result.error,
          stage: result.stage,
          ...("missingProgramId" in result && result.missingProgramId
            ? { missingProgramId: result.missingProgramId }
            : {}),
        },
        { status: 502 },
      );
    }

    return NextResponse.json({ market: result.market });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Complete deposit failed";
    console.error("[predicted][api/complete-pmamm-deposit] exception", e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

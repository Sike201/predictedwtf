import { NextResponse } from "next/server";

import { repairChartGapFromOnchainActivity } from "@/lib/market/chart-gap-repair";

export const runtime = "nodejs";

/**
 * POST { slug } — append `market_price_history` rows for on-chain txs newer than latest DB snapshot.
 */
export async function POST(req: Request) {
  let body: { slug?: string; limit?: number };
  try {
    body = (await req.json()) as { slug?: string; limit?: number };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const slug = body.slug?.trim();
  if (!slug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  const result = await repairChartGapFromOnchainActivity({
    slug,
    limit: body.limit ?? 100,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  return NextResponse.json(result);
}

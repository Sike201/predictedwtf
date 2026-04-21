import { NextResponse } from "next/server";

import {
  backfillMarketPriceHistoryFromOnchainActivity,
  marketNeedsChartHistoryRepair,
} from "@/lib/market/backfill-market-price-history";
import { seedMarketPriceHistoryIfEmpty } from "@/lib/market/seed-market-price-history";

export const runtime = "nodejs";

const REPAIR = "[predicted][chart-history-repair]";

/**
 * POST { slug, mode?: "seed" | "backfill" | "auto" }
 * - seed: first row only (existing behavior)
 * - backfill: replay on-chain signatures into market_price_history (tx-meta reserves)
 * - auto: run backfill when marketNeedsChartHistoryRepair heuristic matches
 */
export async function POST(req: Request) {
  let body: { slug?: string; mode?: "seed" | "backfill" | "auto" };
  try {
    body = (await req.json()) as { slug?: string; mode?: "seed" | "backfill" | "auto" };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const slug = body.slug?.trim();
  if (!slug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  const mode = body.mode ?? "auto";

  try {
    if (mode === "seed") {
      const result = await seedMarketPriceHistoryIfEmpty(slug);
      if (!result.ok) {
        console.info(REPAIR, "repair_fail", { slug, mode, error: result.error });
        return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
      }
      return NextResponse.json({
        ok: true,
        mode: "seed",
        seeded: result.seeded,
        ...(result.seeded
          ? { txSignature: result.txSignature }
          : { reason: result.reason }),
      });
    }

    if (mode === "backfill") {
      console.info(REPAIR, "repair_start", { slug, mode: "backfill" });
      const result = await backfillMarketPriceHistoryFromOnchainActivity({
        slug,
        limit: 80,
      });
      if (!result.ok) {
        console.info(REPAIR, "repair_fail", { slug, error: result.error });
        return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
      }
      return NextResponse.json({
        mode: "backfill",
        ...result,
      });
    }

    /** auto */
    const check = await marketNeedsChartHistoryRepair({ slug });
    if (!check.needsRepair) {
      return NextResponse.json({
        ok: true,
        mode: "auto",
        ran: false,
        reason: "heuristic_no_repair_needed",
        ...check,
      });
    }

    console.info(REPAIR, "repair_start", { slug, mode: "auto", ...check });
    const bf = await backfillMarketPriceHistoryFromOnchainActivity({
      slug,
      limit: 80,
    });
    if (!bf.ok) {
      console.info(REPAIR, "repair_fail", { slug, error: bf.error });
      return NextResponse.json(
        { ok: false, error: bf.error, check },
        { status: 500 },
      );
    }

    return NextResponse.json({
      mode: "auto",
      ran: true,
      check,
      ...bf,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.info(REPAIR, "repair_fail", { slug, mode, error: msg });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

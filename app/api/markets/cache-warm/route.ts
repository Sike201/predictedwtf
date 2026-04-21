import { NextResponse } from "next/server";

import {
  HOMEPAGE_CACHE_WARM_MAX,
  HOMEPAGE_CACHE_WARM_STAGGER_MS,
} from "@/lib/market/homepage-cache-warm";
import { runVolumeReconcileForSlug } from "@/lib/market/run-volume-reconcile";

export const maxDuration = 60;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * POST { slugs: string[], reason?: string }
 * Background TTL-gated volume reconcile for several markets (non-blocking for callers).
 * Does not run heavy scans for fresh rows; staggers work to reduce RPC burst.
 */
export async function POST(req: Request) {
  let body: { slugs?: unknown; reason?: unknown };
  try {
    body = (await req.json()) as { slugs?: unknown; reason?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw = body.slugs;
  const slugs = Array.isArray(raw)
    ? raw
        .filter((s): s is string => typeof s === "string" && s.length > 0)
        .slice(0, HOMEPAGE_CACHE_WARM_MAX)
    : [];
  const reason =
    typeof body.reason === "string" && body.reason.length > 0
      ? body.reason
      : "homepage_batch";

  if (slugs.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, results: [] });
  }

  const batchT0 = Date.now();
  console.info("[predicted][cache-warm] batch_queued", {
    event: "cache_warm_batch",
    reason,
    count: slugs.length,
    slugs,
    ts: batchT0,
  });

  const results: Array<{
    slug: string;
    skipped?: boolean;
    ok?: boolean;
    durationMs?: number;
    skipReason?: string;
  }> = [];

  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i]!;
    const oneT0 = Date.now();
    const { httpStatus, body: json } = await runVolumeReconcileForSlug(slug, {
      warmSource: reason,
    });
    const durationMs = Date.now() - oneT0;
    const skipReason =
      typeof (json as { reason?: unknown }).reason === "string"
        ? ((json as { reason: string }).reason as string)
        : undefined;

    results.push({
      slug,
      skipped: Boolean((json as { skipped?: boolean }).skipped),
      ok: httpStatus < 400 && (json as { ok?: boolean }).ok !== false,
      durationMs,
      skipReason,
    });

    if (i < slugs.length - 1) {
      await sleep(HOMEPAGE_CACHE_WARM_STAGGER_MS);
    }
  }

  console.info("[predicted][cache-warm] batch_done", {
    event: "cache_warm_batch",
    reason,
    processed: results.length,
    totalMs: Date.now() - batchT0,
    ts: Date.now(),
  });

  return NextResponse.json({
    ok: true,
    processed: results.length,
    results,
    serverTs: Date.now(),
  });
}

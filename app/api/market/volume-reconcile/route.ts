import { NextResponse } from "next/server";

import { runVolumeReconcileForSlug } from "@/lib/market/run-volume-reconcile";

export const maxDuration = 60;

/**
 * POST { slug, force?, warmSource? } — full on-chain swap-volume scan (background).
 * Uses `last_stats_updated_at` TTL unless `force`.
 */
export async function POST(req: Request) {
  let body: { slug?: string; force?: boolean; warmSource?: string };
  try {
    body = (await req.json()) as {
      slug?: string;
      force?: boolean;
      warmSource?: string;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const slug = body.slug?.trim();
  if (!slug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  const { httpStatus, body: json } = await runVolumeReconcileForSlug(slug, {
    force: body.force,
    warmSource: body.warmSource ?? "api_volume_reconcile",
  });
  return NextResponse.json(json, { status: httpStatus });
}

import { PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";

import { buildMarketResolveMessageV1 } from "@/lib/market/resolve-message";
import { TRUSTED_RESOLVER_ADDRESS } from "@/lib/market/trusted-resolver";
import { verifyTrustedResolverMessageSignature } from "@/lib/market/verify-resolver-signature";
import { getSupabaseAdmin } from "@/lib/supabase/server-client";
import type { OutcomeSide } from "@/lib/types/market";
import { pmammBuildResolveMarketTransaction } from "@/lib/engines/pmamm";
import { getConnection } from "@/lib/solana/connection";
import { loadMarketEngineAuthority } from "@/lib/solana/treasury";

export const runtime = "nodejs";

const LOG = "[predicted][resolve]";

type Body = {
  slug?: string;
  winningOutcome?: string;
  /** Exact UTF-8 string that was signed (must match `buildMarketResolveMessageV1`). */
  message?: string;
  /** base64 ed25519 detached signature (64 bytes) from the trusted resolver wallet. */
  signature?: string;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const slug = body.slug?.trim();
  const sideRaw = body.winningOutcome?.trim().toLowerCase();
  const message = body.message?.trim() ?? "";
  const signature = body.signature?.trim() ?? "";

  const winningOutcome: OutcomeSide | null =
    sideRaw === "yes" || sideRaw === "no" ? sideRaw : null;

  console.info(LOG, "resolve_attempt", { slug, winningOutcome, hasSignature: Boolean(signature) });

  if (!slug || !winningOutcome || !message || !signature) {
    console.info(LOG, "resolve_rejected", {
      reason: "missing_fields",
      slug: slug ?? null,
    });
    return NextResponse.json(
      { error: "Missing slug, winningOutcome, message, or signature" },
      { status: 400 },
    );
  }

  const expected = buildMarketResolveMessageV1(slug, winningOutcome);
  if (message !== expected) {
    console.info(LOG, "resolve_rejected", { reason: "message_mismatch", slug });
    return NextResponse.json(
      { error: "Message does not match slug/outcome" },
      { status: 400 },
    );
  }

  if (!verifyTrustedResolverMessageSignature(message, signature)) {
    console.info(LOG, "resolve_rejected", {
      reason: "bad_signature",
      slug,
      trusted: TRUSTED_RESOLVER_ADDRESS,
    });
    return NextResponse.json(
      { error: "Invalid signature — only the trusted resolver can resolve." },
      { status: 403 },
    );
  }

  const sb = getSupabaseAdmin();
  if (!sb) {
    return NextResponse.json(
      { error: "Server not configured" },
      { status: 503 },
    );
  }

  const { data: row, error: qErr } = await sb
    .from("markets")
    .select(
      "id,slug,status,resolution_status,resolve_after,expiry_ts,resolver_wallet,market_engine,pool_address",
    )
    .eq("slug", slug)
    .maybeSingle();

  if (qErr || !row) {
    console.info(LOG, "resolve_rejected", { reason: "market_not_found", slug });
    return NextResponse.json({ error: "Market not found" }, { status: 404 });
  }

  if (row.status !== "live") {
    console.info(LOG, "resolve_rejected", { reason: "not_live", slug });
    return NextResponse.json(
      { error: "Only live markets can be resolved" },
      { status: 400 },
    );
  }

  if (row.resolution_status === "resolved") {
    console.info(LOG, "resolve_rejected", { reason: "already_resolved", slug });
    return NextResponse.json(
      { error: "Market is already resolved" },
      { status: 400 },
    );
  }

  if ((row as { resolver_wallet: string }).resolver_wallet !== TRUSTED_RESOLVER_ADDRESS) {
    console.info(LOG, "resolve_rejected", { reason: "resolver_mismatch", slug });
    return NextResponse.json(
      { error: "Market resolver is not the trusted resolver" },
      { status: 400 },
    );
  }

  const afterIso = (row as { resolve_after?: string; expiry_ts?: string })
    .resolve_after;
  const expiryIso = (row as { resolve_after?: string; expiry_ts?: string })
    .expiry_ts;
  const resolveAfterMs = new Date(afterIso ?? expiryIso ?? "").getTime();
  const earlyResolveUsed =
    Number.isFinite(resolveAfterMs) && Date.now() < resolveAfterMs;

  const recRow = row as {
    id: string;
    market_engine?: string | null;
    pool_address?: string | null;
  };
  if (recRow.market_engine === "PM_AMM") {
    const treasury = loadMarketEngineAuthority();
    if (!treasury) {
      return NextResponse.json(
        {
          error:
            "Server missing MARKET_ENGINE_AUTHORITY_SECRET — required for pmAMM resolve_market.",
        },
        { status: 503 },
      );
    }
    const pool = recRow.pool_address?.trim();
    if (!pool) {
      return NextResponse.json(
        { error: "pmAMM market missing on-chain address" },
        { status: 400 },
      );
    }
    const connection = getConnection();
    try {
      const tx = await pmammBuildResolveMarketTransaction({
        connection,
        authority: treasury.publicKey,
        marketPda: new PublicKey(pool),
        winningSide: winningOutcome,
      });
      tx.partialSign(treasury);
      const sig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
      });
      await connection.confirmTransaction(sig, "confirmed");
      console.info(LOG, "pmamm_resolve_market_ok", { slug, signature: sig });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(LOG, "pmamm_resolve_market_failed", { slug, msg, e });
      return NextResponse.json(
        {
          error: `pmAMM on-chain resolve failed: ${msg}`,
        },
        { status: 502 },
      );
    }
  }

  const resolvedAt = new Date().toISOString();

  const { error: upErr } = await sb
    .from("markets")
    .update({
      resolution_status: "resolved",
      resolved_outcome: winningOutcome,
      resolved_at: resolvedAt,
    })
    .eq("id", (row as { id: string }).id)
    .eq("resolution_status", "active");

  if (upErr) {
    console.error(LOG, "resolve_rejected", { reason: "db_error", err: upErr.message });
    return NextResponse.json(
      { error: "Failed to save resolution" },
      { status: 500 },
    );
  }

  console.info(LOG, "resolve_success", {
    slug,
    winningOutcome,
    resolvedAt,
    marketId: (row as { id: string }).id,
  });
  console.info(LOG, "early_resolve_used", {
    slug,
    early_resolve_used: earlyResolveUsed,
  });
  console.info("[predicted][market-status]", "entered_resolved", {
    slug,
    winningOutcome,
    resolvedAt,
  });

  return NextResponse.json({
    ok: true,
    slug,
    winningOutcome,
    resolvedAt,
    earlyResolveUsed,
  });
}

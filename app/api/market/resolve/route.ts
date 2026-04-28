import {
  PublicKey,
  SendTransactionError,
  type Connection,
} from "@solana/web3.js";
import { NextResponse } from "next/server";

import { buildMarketResolveMessageV1 } from "@/lib/market/resolve-message";
import { TRUSTED_RESOLVER_ADDRESS } from "@/lib/market/trusted-resolver";
import { verifyTrustedResolverMessageSignature } from "@/lib/market/verify-resolver-signature";
import { getSupabaseAdmin } from "@/lib/supabase/server-client";
import type { OutcomeSide } from "@/lib/types/market";
import { pmammBuildResolveMarketTransaction } from "@/lib/engines/pmamm";
import { getPmammMarketAddressFromRow } from "@/lib/solana/pmamm-market-address-from-row";
import { getConnection, getSolanaRpcUrl } from "@/lib/solana/connection";
import { requirePmammProgramId } from "@/lib/solana/pmamm-config";
import {
  friendlyMessageForPmammResolveRpcFailure,
  logPmammResolveMarketInstructionAccounts,
  validatePmammMarketAccountBeforeResolve,
  PMAMM_RESOLVE_ERROR_CODE,
} from "@/lib/solana/pmamm-resolve-validation";
import { loadMarketEngineAuthority } from "@/lib/solana/treasury";
import { transactionExplorerUrl } from "@/lib/utils/solana-explorer";

export const runtime = "nodejs";

const LOG = "[predicted][resolve]";

async function formatPmammResolveRpcFailure(connection: Connection, e: unknown): Promise<string> {
  let tail = "";
  if (e instanceof SendTransactionError) {
    try {
      const logs = await e.getLogs(connection);
      if (logs?.length) tail = ` RpcSimulationLogs: ${JSON.stringify(logs)}`;
    } catch {
      /* noop — explorer/message fallback stays usable */
    }
  }
  const basis =
    e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
  return `${basis}${tail}`;
}

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
      "id,slug,status,resolution_status,resolve_after,expiry_ts,resolver_wallet,market_engine,pool_address,pmamm_market_id,pmamm_market_address,market_address,yes_mint,no_mint,onchain_program_id,created_tx",
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
    pmamm_market_id?: string | null;
    pmamm_market_address?: string | null;
    market_address?: string | null;
    yes_mint?: string | null;
    no_mint?: string | null;
    onchain_program_id?: string | null;
    created_tx?: string | null;
  };
  if (recRow.market_engine === "PM_AMM") {
    const treasury = loadMarketEngineAuthority();
    if (!treasury) {
      return NextResponse.json(
        {
          error:
            "Server missing MARKET_ENGINE_AUTHORITY_SECRET — required for pmAMM resolve_market (must be the same keypair as initialize_market authority).",
        },
        { status: 503 },
      );
    }

    let programId: PublicKey;
    try {
      programId = requirePmammProgramId();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        {
          error: `pmAMM program id not configured: ${msg}`,
          errorCode: PMAMM_RESOLVE_ERROR_CODE.PROGRAM_ENV_MISMATCH,
        },
        { status: 503 },
      );
    }

    const chainProg = recRow.onchain_program_id?.trim();
    if (chainProg && chainProg !== programId.toBase58()) {
      console.warn(LOG, "pmamm_program_id_env_mismatch_row", {
        slug,
        envProgramId: programId.toBase58(),
        rowOnchainProgramId: chainProg,
      });
    }

    console.info(LOG, "pmamm_resolve_supabase_row_snapshot", {
      slug,
      db_uuid: recRow.id,
      engine: recRow.market_engine,
      pool_address: recRow.pool_address ?? null,
      pmamm_market_address: recRow.pmamm_market_address ?? null,
      market_address: recRow.market_address ?? null,
      pmamm_market_id: recRow.pmamm_market_id ?? null,
      yes_mint: recRow.yes_mint ?? null,
      no_mint: recRow.no_mint ?? null,
      onchain_program_id: recRow.onchain_program_id ?? null,
      created_tx: recRow.created_tx ?? null,
    });

    const addrPick = getPmammMarketAddressFromRow(
      {
        pmamm_market_address: recRow.pmamm_market_address,
        market_address: recRow.market_address,
        pool_address: recRow.pool_address,
        pmamm_market_id: recRow.pmamm_market_id,
        market_engine: recRow.market_engine,
      },
      programId,
    );
    if (!addrPick.ok) {
      console.error(LOG, "pmamm_resolve_no_address", { slug, reason: addrPick.reason });
      return NextResponse.json(
        {
          error: addrPick.reason,
          errorCode: PMAMM_RESOLVE_ERROR_CODE.INVALID_MARKET_ACCOUNT,
        },
        { status: 400 },
      );
    }

    const marketPda = addrPick.marketPda;
    const connection = getConnection();
    const rpcUrl = getSolanaRpcUrl();

    console.info(LOG, "pmamm_resolve_address_choice", {
      slug,
      source_field: addrPick.source,
      resolve_market_pubkey: marketPda.toBase58(),
      rpc_http_url: rpcUrl,
      NEXT_PUBLIC_NETWORK: process.env.NEXT_PUBLIC_NETWORK ?? null,
      NEXT_PUBLIC_PMAMM_PROGRAM_ID: process.env.NEXT_PUBLIC_PMAMM_PROGRAM_ID ?? null,
      program_id: programId.toBase58(),
    });

    const validated = await validatePmammMarketAccountBeforeResolve(connection, programId, marketPda, {
      slug: slug!,
      addressSource: addrPick.source,
      rpcUrl,
      networkEnv: process.env.NEXT_PUBLIC_NETWORK,
      pmammProgramIdEnv: process.env.NEXT_PUBLIC_PMAMM_PROGRAM_ID,
      supabaseSnapshot: {
        market_engine: recRow.market_engine ?? null,
        pool_address: recRow.pool_address ?? null,
        pmamm_market_address: recRow.pmamm_market_address ?? null,
        market_address: recRow.market_address ?? null,
        pmamm_market_id: recRow.pmamm_market_id ?? null,
        yes_mint: recRow.yes_mint ?? null,
        no_mint: recRow.no_mint ?? null,
        onchain_program_id: recRow.onchain_program_id ?? null,
      },
      createdTxSignature: recRow.created_tx ?? null,
    });

    if (!validated.ok) {
      const status =
        validated.errorCode === PMAMM_RESOLVE_ERROR_CODE.PROGRAM_ENV_MISMATCH
          ? 503
          : 400;
      console.error(LOG, "pmamm_resolve_validation_failed", {
        slug,
        errorCode: validated.errorCode,
        developerDetail: validated.developerDetail,
      });
      return NextResponse.json(
        {
          error: validated.message,
          errorCode: validated.errorCode,
          ...(process.env.NODE_ENV === "development"
            ? {
                developerDetail: validated.developerDetail,
                discriminatorReceivedHex: validated.discriminatorReceivedHex,
              }
            : {}),
        },
        { status },
      );
    }

    if (validated.warnings.length > 0) {
      console.warn(LOG, "pmamm_resolve_validation_warnings", {
        slug,
        warnings: validated.warnings,
      });
    }

    if (
      validated.authority &&
      !validated.authority.equals(treasury.publicKey)
    ) {
      console.error(LOG, "pmamm_resolve_authority_mismatch", {
        slug,
        serverAuthority: treasury.publicKey.toBase58(),
        marketAuthority: validated.authority.toBase58(),
        authority_check_skipped: false,
      });
      return NextResponse.json(
        {
          error:
            "MARKET_ENGINE_AUTHORITY must match this market's on-chain authority (same wallet used when initialize_market ran). Update MARKET_ENGINE_AUTHORITY_SECRET.",
          errorCode: PMAMM_RESOLVE_ERROR_CODE.AUTHORITY_MISMATCH,
        },
        { status: 503 },
      );
    }
    if (!validated.authority) {
      console.warn(LOG, "pmamm_resolve_authority_skipped", {
        slug,
        reason:
          "Could not read market authority (discriminator/IDL mismatch). Proceeding with on-chain resolve; program will reject wrong signer.",
      });
    }

    try {
      const tx = await pmammBuildResolveMarketTransaction({
        connection,
        authority: treasury.publicKey,
        marketPda,
        winningSide: winningOutcome,
      });
      tx.partialSign(treasury);
      logPmammResolveMarketInstructionAccounts({
        tx,
        programId,
        slug: slug!,
        walletLabel: "MARKET_ENGINE_AUTHORITY (resolve_signer)",
      });
      const sig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
      });
      await connection.confirmTransaction(sig, "confirmed");
      console.info(LOG, "pmamm_resolve_market_ok", {
        slug,
        signature: sig,
        explorer_tx: transactionExplorerUrl(sig),
      });
    } catch (e) {
      const rawDetail = await formatPmammResolveRpcFailure(connection, e);
      const friendlyOnly = friendlyMessageForPmammResolveRpcFailure(rawDetail);
      const error =
        friendlyOnly !== rawDetail
          ? friendlyOnly
          : `pmAMM on-chain resolve failed: ${rawDetail.slice(0, 500)}`;
      console.error(LOG, "pmamm_resolve_market_failed", {
        slug,
        rawDetail,
        friendlyUi: friendlyOnly,
        e,
      });
      return NextResponse.json(
        {
          error,
          errorCode: PMAMM_RESOLVE_ERROR_CODE.INVALID_MARKET_ACCOUNT,
          ...(process.env.NODE_ENV === "development" ? { developerDetail: rawDetail } : {}),
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

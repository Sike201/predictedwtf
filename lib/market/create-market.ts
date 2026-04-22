import { PublicKey } from "@solana/web3.js";
import { getSupabaseAdmin } from "@/lib/supabase/server-client";
import { pinMarketImageToIpfs } from "@/lib/storage/pinata";
import {
  type PipelineFailureStage,
  PipelineStageError,
  formatUnknownError,
  isPipelineStageError,
} from "@/lib/market/pipeline-errors";
import {
  createMockOutcomeMints,
  getAuthorityAtasForOutcomeMints,
  getLatestSignatureForAddress,
  mintOutcomeToken,
} from "@/lib/solana/create-outcome-mints";
import { recordMarketPriceSnapshotFromChain } from "@/lib/market/market-price-history";
import { seedMarketPriceHistoryIfEmpty } from "@/lib/market/seed-market-price-history";
import { DEMO_LIQUIDITY_ATOMICS } from "@/lib/solana/seed-market-liquidity";
import { getConnection } from "@/lib/solana/connection";
import {
  type InitOmnipairMarketResult,
  deriveOmnipairMarketAccounts,
  initializeOmnipairMarket,
} from "@/lib/solana/init-omnipair-market";
import { getOmnipairProgramId } from "@/lib/solana/omnipair-program";
import { seedMarketLiquidity } from "@/lib/solana/seed-market-liquidity";
import { loadMarketEngineAuthority } from "@/lib/solana/treasury";
import {
  extractMissingProgramIdFromSolanaError,
  formatMissingDeployedProgramMessage,
} from "@/lib/solana/trace-transaction-programs";
import {
  formatMarketEndTimeIsoForDatabase,
  isDateOnlyUtcCalendarInput,
  logMarketExpiryWrite,
  resolveMarketExpiryInputForDatabase,
} from "@/lib/market/utc-instant";
import { classifyMarketCategoryWithGrok } from "@/lib/market/grok-classify-market-category";
import { TRUSTED_RESOLVER_ADDRESS } from "@/lib/market/trusted-resolver";
import type { MarketRecord, MarketStatus } from "@/lib/types/market-record";
import type { MarketDraft } from "@/lib/types/market";

const LP = "[predicted][pipeline]";
const CREATE_LIFECYCLE_LOG = "[predicted][create-market-lifecycle]";

function solanaPipelineStage(
  stage: PipelineFailureStage,
  msg: string,
  cause: unknown,
): PipelineStageError {
  return new PipelineStageError(stage, msg, {
    cause,
    missingProgramId: extractMissingProgramIdFromSolanaError(cause),
  });
}

export type CreateMarketInput = {
  draft: MarketDraft;
  creatorWallet: string;
  resolverWallet?: string;
  /** Ignored for storage; category is set by Grok from `draft.question` (fallback `predicted`). */
  category?: string;
  yesCondition?: string;
  noCondition?: string;
  /** Base64 data URL — uploaded to Pinata before insert. */
  imageDataUrl?: string;
};

export type CreateMarketResult =
  | { ok: true; market: MarketRecord }
  | {
      ok: false;
      error: string;
      /** Present when failure happened inside a tracked devnet step. */
      stage?: PipelineFailureStage;
      /** On-chain: program account not found / load failure (from simulation logs). */
      missingProgramId?: string;
    };

function makeSlug(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `${base || "market"}-${Date.now().toString(36)}`;
}

function splitYesNo(draft: MarketDraft, yes?: string, no?: string) {
  if (yes?.trim() && no?.trim()) return { yes: yes.trim(), no: no.trim() };
  const lines = draft.resolutionRules.split(/\n+/).filter(Boolean);
  const y =
    lines.find((l) => /^yes\s*:/i.test(l))?.replace(/^yes\s*:/i, "").trim() ??
    draft.suggestedRules[0] ??
    "Resolves YES per rules above.";
  const n =
    lines.find((l) => /^no\s*:/i.test(l))?.replace(/^no\s*:/i, "").trim() ??
    draft.suggestedRules[1] ??
    "Otherwise NO.";
  return { yes: y, no: n };
}

async function markStatus(id: string, status: MarketStatus): Promise<void> {
  const sb = getSupabaseAdmin();
  if (!sb) return;
  await sb.from("markets").update({ status }).eq("id", id);
}

/**
 * Full pipeline: Pinata (optional) → Supabase `creating` → YES/NO mints → Omnipair init → seed liquidity → `live`.
 * `MOCK_CHAIN=1` only for emergency dry runs (mock addresses + dummy program PDAs).
 */
export async function createMarketPipeline(
  input: CreateMarketInput,
): Promise<CreateMarketResult> {
  const sb = getSupabaseAdmin();
  if (!sb) {
    return {
      ok: false,
      error: "Supabase is not configured (SUPABASE_URL / SERVICE_ROLE_KEY).",
    };
  }

  let creator: PublicKey;
  try {
    creator = new PublicKey(input.creatorWallet.trim());
  } catch {
    return { ok: false, error: "Invalid creator wallet address." };
  }

  let trustedResolver: PublicKey;
  try {
    trustedResolver = new PublicKey(TRUSTED_RESOLVER_ADDRESS.trim());
  } catch {
    return { ok: false, error: "Invalid TRUSTED_RESOLVER_ADDRESS configuration." };
  }

  const { yes, no } = splitYesNo(
    input.draft,
    input.yesCondition,
    input.noCondition,
  );
  const slug = makeSlug(input.draft.question);
  const draftExpiryRaw = input.draft.expiry;
  const expiryResolved = resolveMarketExpiryInputForDatabase({
    draftExpiry: draftExpiryRaw,
    title: input.draft.question,
  });
  const parsedBeforeFormat = expiryResolved.finalInput;
  const expiryTs = formatMarketEndTimeIsoForDatabase(expiryResolved.finalInput);
  const interpretedAsDateOnly = isDateOnlyUtcCalendarInput(draftExpiryRaw.trim());
  logMarketExpiryWrite({
    slug,
    draft_expiry_input: draftExpiryRaw,
    parsed_before_format: parsedBeforeFormat,
    interpreted_as_date_only: interpretedAsDateOnly,
    used_title_utc_time: expiryResolved.usedTitleUtcTime,
    title_derived_cutoff: expiryResolved.titleDerivedCutoff,
    final_expiry_ts: expiryTs,
    final_resolve_after: expiryTs,
  });
  const category = await classifyMarketCategoryWithGrok({
    question: input.draft.question,
    slug,
  });

  let imageCid: string | null = null;
  try {
    console.info(`${LP} BEFORE pinata (upload or skip)`);
    if (input.imageDataUrl?.trim()) {
      imageCid = await pinMarketImageToIpfs(input.imageDataUrl);
      console.info(`${LP} AFTER pinata`, imageCid);
    } else {
      console.info(`${LP} AFTER pinata (skipped — no imageDataUrl)`);
    }
  } catch (e) {
    const msg = formatUnknownError(e);
    console.error(`${LP} pinata failed`, msg, e);
    return {
      ok: false,
      error: msg,
      stage: "FAILED_AT_PINATA",
    };
  }

  const row = {
    slug,
    title: input.draft.question,
    description: input.draft.description,
    category,
    creator_wallet: creator.toBase58(),
    resolver_wallet: trustedResolver.toBase58(),
    resolution_source: input.draft.resolutionSource,
    resolution_rules: input.draft.resolutionRules,
    yes_condition: yes,
    no_condition: no,
    expiry_ts: expiryTs,
    resolve_after: expiryTs,
    resolution_status: "active" as const,
    status: "creating" as const,
    image_cid: imageCid,
  };
  console.info(
    CREATE_LIFECYCLE_LOG,
    "row_before_insert",
    JSON.stringify({
      slug,
      category,
      draft_expiry_input: draftExpiryRaw,
      derived_expiry_ts: expiryTs,
      derived_resolve_after: expiryTs,
      resolution_status: "active",
    }),
  );

  let inserted: { id: string };
  try {
    console.info(`${LP} BEFORE Supabase insert (status=creating)`);
    const { data, error: insertErr } = await sb
      .from("markets")
      .insert(row)
      .select()
      .single();

    if (insertErr || !data) {
      throw new Error(insertErr?.message ?? "Failed to insert market draft.");
    }
    inserted = data as { id: string };
    const insertedRow = data as MarketRecord;
    console.info(`${LP} market inserted with slug`, {
      slug,
      id: inserted.id,
      status: "creating",
    });
    console.info(
      CREATE_LIFECYCLE_LOG,
      "insert_row",
      JSON.stringify({
        slug: insertedRow.slug,
        draft_expiry_input: draftExpiryRaw,
        expiry_ts: insertedRow.expiry_ts,
        resolve_after: insertedRow.resolve_after,
        resolution_status: insertedRow.resolution_status,
        created_at: insertedRow.created_at,
        status: insertedRow.status,
      }),
    );
  } catch (e) {
    const msg = formatUnknownError(e);
    console.error(`${LP} Supabase insert failed`, msg, e);
    return {
      ok: false,
      error: msg,
      stage: "FAILED_AT_SUPABASE_INSERT",
    };
  }

  const marketId = inserted.id;
  const connection = getConnection();

  try {
    const mockChain = process.env.MOCK_CHAIN === "1";
    const programId = getOmnipairProgramId();

    let yesMint: PublicKey;
    let noMint: PublicKey;
    let poolAddress: PublicKey;
    let mintYesTx: string | null = null;
    let mintNoTx: string | null = null;
    let poolInitTx: string | null = null;
    let seedTx: string | null = null;
    let createdTxSig: string | null = null;
    let authorityYesAta: PublicKey | null = null;
    let authorityNoAta: PublicKey | null = null;

    if (mockChain) {
      console.info(`${LP} MOCK_CHAIN=1 — stub chain steps`);
      const m = createMockOutcomeMints();
      yesMint = m.yesMint;
      noMint = m.noMint;
      authorityYesAta = m.authorityYesAta;
      authorityNoAta = m.authorityNoAta;
      poolAddress = deriveOmnipairMarketAccounts(
        programId,
        yesMint,
        noMint,
      ).pairAddress;
      console.warn(
        `${LP} MOCK_CHAIN=1 — fake mints and PDAs; not real devnet assets.`,
      );
    } else {
      const treasury = loadMarketEngineAuthority();
      if (!treasury) {
        throw new PipelineStageError(
          "FAILED_AT_PRECONDITION",
          "Set MARKET_ENGINE_AUTHORITY_SECRET for server-side minting and pool setup.",
        );
      }
      if (process.env.OMNIPAIR_EXECUTE_INIT !== "true") {
        throw new PipelineStageError(
          "FAILED_AT_PRECONDITION",
          "Set OMNIPAIR_EXECUTE_INIT=true for full on-chain pool + liquidity (or MOCK_CHAIN=1 only for dry runs).",
        );
      }
      console.info(`${LP} on-chain tx program env`, {
        NEXT_PUBLIC_OMNIPAIR_PROGRAM_ID:
          process.env.NEXT_PUBLIC_OMNIPAIR_PROGRAM_ID?.trim() ?? "(unset)",
        OMNIPAIR_TEAM_TREASURY:
          process.env.OMNIPAIR_TEAM_TREASURY?.trim() ?? "(unset)",
      });

      try {
        console.info(`${LP} BEFORE YES mint creation`);
        yesMint = await mintOutcomeToken({
          connection,
          payer: treasury,
          mintAuthority: treasury.publicKey,
        });
        mintYesTx = await getLatestSignatureForAddress(connection, yesMint);
        console.info(`${LP} AFTER YES mint`, {
          yesMint: yesMint.toBase58(),
          mintYesTx,
        });
      } catch (e) {
        const msg = formatUnknownError(e);
        console.error(`${LP} YES mint failed`, msg, e);
        throw solanaPipelineStage("FAILED_AT_YES_MINT", msg, e);
      }

      try {
        console.info(`${LP} BEFORE NO mint creation`);
        noMint = await mintOutcomeToken({
          connection,
          payer: treasury,
          mintAuthority: treasury.publicKey,
        });
        mintNoTx = await getLatestSignatureForAddress(connection, noMint);
        console.info(`${LP} AFTER NO mint`, {
          noMint: noMint.toBase58(),
          mintNoTx,
        });
      } catch (e) {
        const msg = formatUnknownError(e);
        console.error(`${LP} NO mint failed`, msg, e);
        throw solanaPipelineStage("FAILED_AT_NO_MINT", msg, e);
      }

      try {
        console.info(`${LP} BEFORE outcome ATAs (engine authority)`);
        const atas = await getAuthorityAtasForOutcomeMints({
          connection,
          payer: treasury,
          mintAuthority: treasury.publicKey,
          yesMint,
          noMint,
        });
        authorityYesAta = atas.authorityYesAta;
        authorityNoAta = atas.authorityNoAta;
        console.info(`${LP} AFTER outcome ATAs`, {
          authorityYesAta: authorityYesAta.toBase58(),
          authorityNoAta: authorityNoAta.toBase58(),
        });
      } catch (e) {
        const msg = formatUnknownError(e);
        console.error(`${LP} outcome ATA setup failed`, msg, e);
        throw solanaPipelineStage("FAILED_AT_OUTCOME_ATA", msg, e);
      }

      /** Omnipair path: bootstrap mint happens inside `initializeOmnipairMarket` as tx2 (after pre-init). */
      let init: InitOmnipairMarketResult;

      try {
        console.info(`${LP} BEFORE Omnipair pool init`);
        init = await initializeOmnipairMarket({
          connection,
          payer: treasury,
          yesMint,
          noMint,
          authorityYesAta: authorityYesAta!,
          authorityNoAta: authorityNoAta!,
          bootstrapPerSide: DEMO_LIQUIDITY_ATOMICS,
        });
        poolAddress = init.pairAddress;
        poolInitTx = init.initializeSignature;
        seedTx = init.bootstrapLiquiditySignature;
        createdTxSig = init.initializeSignature;
        console.info(`${LP} AFTER Omnipair pool init`, {
          pair: poolAddress.toBase58(),
          poolInitTx,
        });
      } catch (e) {
        if (isPipelineStageError(e)) throw e;
        const msg = formatUnknownError(e);
        console.error(`${LP} Omnipair pool init failed (unexpected)`, msg, e);
        throw solanaPipelineStage("FAILED_AT_OMNIPAIR_INIT", msg, e);
      }

      try {
        console.info(`${LP} BEFORE liquidity seed (post-init hook)`);
        const seed = await seedMarketLiquidity({
          connection,
          authority: treasury,
          init,
          authorityYesAta: authorityYesAta!,
          authorityNoAta: authorityNoAta!,
        });
        console.info(`${LP} AFTER liquidity seed`, {
          seed_liquidity_tx: seedTx,
          pool_init_signature: seed.signature,
          omnipair_tx1_pre_init: init.preInitializeSignature,
        });
      } catch (e) {
        if (isPipelineStageError(e)) throw e;
        const msg = formatUnknownError(e);
        console.error(`${LP} liquidity seed failed (unexpected)`, msg, e);
        throw solanaPipelineStage("FAILED_AT_LIQUIDITY_SEED", msg, e);
      }
    }

    try {
      console.info(`${LP} BEFORE Supabase final update (status=live)`);
      const { data: live, error: upErr } = await sb
        .from("markets")
        .update({
          yes_mint: yesMint.toBase58(),
          no_mint: noMint.toBase58(),
          pool_address: poolAddress.toBase58(),
          status: "live",
          created_tx: createdTxSig ?? poolInitTx ?? seedTx,
          mint_yes_tx: mintYesTx,
          mint_no_tx: mintNoTx,
          pool_init_tx: poolInitTx,
          seed_liquidity_tx: seedTx,
          last_known_yes_price: 0.5,
          last_known_no_price: 0.5,
          last_known_volume_usd: 0,
          last_stats_updated_at: new Date().toISOString(),
        })
        .eq("id", marketId)
        .select()
        .single();

      if (upErr || !live) {
        throw new Error(upErr?.message ?? "Failed to finalize market.");
      }
      const liveRow = live as MarketRecord;
      console.info(`${LP} market updated to live`, {
        id: marketId,
        slug: liveRow.slug,
      });
      console.info(
        CREATE_LIFECYCLE_LOG,
        "final_live_row",
        JSON.stringify({
          slug: liveRow.slug,
          draft_expiry_input: draftExpiryRaw,
          expiry_ts: liveRow.expiry_ts,
          resolve_after: liveRow.resolve_after,
          resolution_status: liveRow.resolution_status,
          created_at: liveRow.created_at,
          status: liveRow.status,
        }),
      );

      if (!mockChain) {
        const seedSig = seedTx ?? poolInitTx ?? createdTxSig;
        if (seedSig) {
          try {
            const snap = await recordMarketPriceSnapshotFromChain({
              marketId: (live as MarketRecord).id,
              txSignature: seedSig,
              connection,
              pairAddress: poolAddress,
              yesMint,
              noMint,
            });
            if (!snap.ok) {
              console.warn(`${LP} initial market_price_history failed`, snap.error);
              const repair = await seedMarketPriceHistoryIfEmpty(
                (live as MarketRecord).slug,
              );
              if (repair.ok && repair.seeded) {
                console.info(
                  `${LP} chart history repaired via seed after failed snapshot`,
                );
              } else if (!repair.ok) {
                console.warn(`${LP} chart seed failed`, repair.error);
              }
            }
          } catch (e) {
            console.warn(
              `${LP} initial market_price_history exception`,
              formatUnknownError(e),
            );
            try {
              const repair = await seedMarketPriceHistoryIfEmpty(
                (live as MarketRecord).slug,
              );
              if (repair.ok && repair.seeded) {
                console.info(
                  `${LP} chart history repaired via seed after exception`,
                );
              } else if (!repair.ok) {
                console.warn(`${LP} chart seed failed`, repair.error);
              }
            } catch {
              /* ignore */
            }
          }
        } else {
          const repair = await seedMarketPriceHistoryIfEmpty(
            (live as MarketRecord).slug,
          );
          if (repair.ok && repair.seeded) {
            console.info(
              `${LP} chart history seeded (no bootstrap tx sig on record)`,
            );
          } else if (!repair.ok) {
            console.warn(`${LP} chart seed failed`, repair.error);
          }
        }
      }

      return { ok: true, market: live as MarketRecord };
    } catch (e) {
      const msg = formatUnknownError(e);
      console.error(`${LP} Supabase final update failed`, msg, e);
      throw new PipelineStageError("FAILED_AT_SUPABASE_FINAL", msg, {
        cause: e,
      });
    }
  } catch (e) {
    let stage: PipelineFailureStage | undefined;
    let message: string;

    if (isPipelineStageError(e)) {
      stage = e.stage;
      message = e.message;
      console.error(`${LP} pipeline aborted`, stage, message, e.cause ?? "");
    } else {
      message = formatUnknownError(e);
      console.error(`${LP} pipeline aborted (untyped)`, message, e);
    }

    const missingProgramId =
      (isPipelineStageError(e) && e.missingProgramId) ||
      extractMissingProgramIdFromSolanaError(e);
    const errorMessage = missingProgramId
      ? `${formatMissingDeployedProgramMessage(missingProgramId)} — ${message}`
      : message;

    await markStatus(marketId, "failed");
    return {
      ok: false,
      error: errorMessage,
      stage,
      missingProgramId: missingProgramId ?? undefined,
    };
  }
}

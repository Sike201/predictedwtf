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
import type { MarketRecord, MarketStatus } from "@/lib/types/market-record";
import type { MarketDraft } from "@/lib/types/market";

const LP = "[predicted][pipeline]";

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

function parseExpiryIso(expiry: string): string {
  const d = new Date(expiry);
  if (Number.isNaN(d.getTime())) {
    return new Date(Date.now() + 365 * 864e5).toISOString();
  }
  return d.toISOString();
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

  const resolver =
    input.resolverWallet?.trim() || process.env.DEFAULT_RESOLVER_WALLET?.trim();
  let resolverPk: PublicKey;
  try {
    resolverPk = resolver ? new PublicKey(resolver) : creator;
  } catch {
    return { ok: false, error: "Invalid resolver wallet address." };
  }

  const { yes, no } = splitYesNo(
    input.draft,
    input.yesCondition,
    input.noCondition,
  );
  const slug = makeSlug(input.draft.question);
  const expiryTs = parseExpiryIso(input.draft.expiry);
  const category = input.category?.trim() || "predicted";

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
    resolver_wallet: resolverPk.toBase58(),
    resolution_source: input.draft.resolutionSource,
    resolution_rules: input.draft.resolutionRules,
    yes_condition: yes,
    no_condition: no,
    expiry_ts: expiryTs,
    status: "creating" as const,
    image_cid: imageCid,
  };

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
    console.info(`${LP} market inserted with slug`, {
      slug,
      id: inserted.id,
      status: "creating",
    });
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
        })
        .eq("id", marketId)
        .select()
        .single();

      if (upErr || !live) {
        throw new Error(upErr?.message ?? "Failed to finalize market.");
      }
      console.info(`${LP} market updated to live`, {
        id: marketId,
        slug: (live as MarketRecord).slug,
      });

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
            }
          } catch (e) {
            console.warn(
              `${LP} initial market_price_history exception`,
              formatUnknownError(e),
            );
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

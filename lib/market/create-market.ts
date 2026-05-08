import { BN } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { PublicKey, SystemProgram } from "@solana/web3.js";
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
  collectSolanaErrorDiagnostics,
  extractMissingProgramIdFromSolanaError,
  formatMissingDeployedProgramMessage,
  formatPmammInstructionFormatMismatchMessage,
  solanaDiagnosticsIndicateInstructionDeserializeFailure,
} from "@/lib/solana/trace-transaction-programs";
import {
  isNativeSolInsufficientMessage,
  isSplTokenInsufficientFundsMessage,
} from "@/lib/market/tx-user-message";
import {
  formatMarketEndTimeIsoForDatabase,
  isDateOnlyUtcCalendarInput,
  logMarketExpiryWrite,
  resolveMarketExpiryInputForDatabase,
} from "@/lib/market/utc-instant";
import { classifyMarketCategoryWithGrok } from "@/lib/market/grok-classify-market-category";
import {
  TRUSTED_RESOLVER_ADDRESS,
  getServerTrustedResolverAddressStrict,
} from "@/lib/market/trusted-resolver";
import type { MarketRecord, MarketStatus } from "@/lib/types/market-record";
import type { MarketDraft, MarketEngine } from "@/lib/types/market";
import { DEVNET_USDC_MINT } from "@/lib/solana/assets";
import {
  createPmammProgram,
  fetchPmammMarketAccount,
  pmammBuildDepositLiquidityUserTransaction,
  pmammBuildInitializeMarketTransaction,
} from "@/lib/solana/pmamm-program";
import { pmammMarketIdBnFromSeed } from "@/lib/solana/pmamm-market-id";
import { derivePmammLpPda } from "@/lib/solana/pmamm-pda";
import { assertPmammDepositTxFromCreator } from "@/lib/solana/pmamm-verify-user-deposit-tx";
import { logPmammMarketAccountRawLayoutProbe } from "@/lib/solana/pmamm-market-raw-layout";
import { getPmammCollateralMint, requirePmammProgramId } from "@/lib/solana/pmamm-config";
import { parsePmammInitialLiquidityUsdcInput } from "@/lib/market/pmamm-initial-liquidity";
import { validatePmammCollateralMint } from "@/lib/solana/pmamm-validate-collateral";
import {
  preflightPmammInitialLpUsdc,
  readPmammDepositorUsdcBalance,
} from "@/lib/solana/pmamm-initial-lp-preflight";
import { coerceUsdVolumeFromDb } from "@/lib/market/coerce-db-numeric";
import {
  groupMetaFromQuestion,
  normalizeOutcomeLabel,
  normalizeStoredGroupKey,
} from "@/lib/market/group-feed-markets";

const LP = "[predicted][pipeline]";
const CREATE_LIFECYCLE_LOG = "[predicted][create-market-lifecycle]";
const EXPECTED_PMAMM_CREATE_RESOLVER =
  "AayL4RVTNeqTRi4YaAWcMmv6pfx4ctNLwYUVyCEfgt7s";

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
  /** On-chain engine (default Omnipair GAMM). */
  engine?: MarketEngine;
  /**
   * Human USDC string (6 dp) for pmAMM `deposit_liquidity` seed; ignored for GAMM.
   * Empty uses default 1000 USDC.
   */
  initialLiquidityUsdc?: string;
};

export type CreateMarketResult =
  | {
      ok: true;
      market: MarketRecord;
      /** Same event/outcome already exists (live or creating); skip chain setup. */
      reusedExisting?: boolean;
      /** Creator must sign and submit this tx (pmAMM create only). */
      pmammAwaitingUserDeposit?: {
        depositTransactionBase64: string;
      };
    }
  | {
      ok: false;
      error: string;
      /** Present when failure happened inside a tracked devnet step. */
      stage?: PipelineFailureStage;
      /** On-chain: program account not found / load failure (from simulation logs). */
      missingProgramId?: string;
      /** `FAILED_AT_OUTCOME_ATA` — engine ATA / mint / program debugging context. */
      outcomeAtaContext?: Record<string, string>;
      /** Development + PM_AMM only: resolver env snapshot for browser debugging. */
      pmammResolverDebug?: PmammResolverCreateDevDebug;
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

function dbStatusRank(s: MarketStatus): number {
  if (s === "live") return 0;
  if (s === "creating") return 1;
  return 2;
}

function pickBestDuplicateMarketRecord(rows: MarketRecord[]): MarketRecord {
  return [...rows].sort((a, b) => {
    const ra = dbStatusRank(a.status);
    const rb = dbStatusRank(b.status);
    if (ra !== rb) return ra - rb;
    const va = coerceUsdVolumeFromDb(a.last_known_volume_usd);
    const vb = coerceUsdVolumeFromDb(b.last_known_volume_usd);
    if (vb !== va) return vb - va;
    return Date.parse(b.created_at) - Date.parse(a.created_at);
  })[0]!;
}

async function findReusedWinnerMarketIfDuplicate(
  sb: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  question: string,
): Promise<MarketRecord | null> {
  const incoming = groupMetaFromQuestion(question);
  if (!incoming) return null;
  const { data, error } = await sb
    .from("markets")
    .select("*")
    .in("status", ["live", "creating"]);
  if (error || !data?.length) return null;
  const rows = data as MarketRecord[];
  const wantK = normalizeStoredGroupKey(incoming.groupKey);
  const matches = rows.filter((r) => {
    if (r.event_group_key?.trim() && r.outcome_label?.trim()) {
      return (
        normalizeStoredGroupKey(r.event_group_key) === wantK &&
        normalizeOutcomeLabel(r.outcome_label) ===
          normalizeOutcomeLabel(incoming.outcomeLabel)
      );
    }
    const meta = groupMetaFromQuestion(r.title);
    return (
      meta != null &&
      normalizeStoredGroupKey(meta.groupKey) === wantK &&
      normalizeOutcomeLabel(meta.outcomeLabel) ===
        normalizeOutcomeLabel(incoming.outcomeLabel)
    );
  });
  if (matches.length === 0) return null;
  return pickBestDuplicateMarketRecord(matches);
}

async function findReusedGroupedMarketIfDuplicate(
  sb: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  draft: MarketDraft,
): Promise<MarketRecord | null> {
  const egk = draft.eventGroupKey?.trim();
  const ol = draft.outcomeLabel?.trim();
  if (egk && ol) {
    const wantK = normalizeStoredGroupKey(egk);
    const wantL = normalizeOutcomeLabel(ol);
    const { data, error } = await sb
      .from("markets")
      .select("*")
      .in("status", ["live", "creating"]);
    if (error || !data?.length) return null;
    const rows = data as MarketRecord[];
    const matches = rows.filter((r) => {
      if (!r.event_group_key?.trim() || !r.outcome_label?.trim()) return false;
      return (
        normalizeStoredGroupKey(r.event_group_key) === wantK &&
        normalizeOutcomeLabel(r.outcome_label) === wantL
      );
    });
    if (matches.length === 0) return null;
    return pickBestDuplicateMarketRecord(matches);
  }
  return findReusedWinnerMarketIfDuplicate(sb, draft.question);
}

async function markStatus(id: string, status: MarketStatus): Promise<void> {
  const sb = getSupabaseAdmin();
  if (!sb) return;
  await sb.from("markets").update({ status }).eq("id", id);
}

/** Dev-only JSON for `/api/market/create` when pmAMM fails (no secrets). */
export type PmammResolverCreateDevDebug = {
  rawEnvTrustedResolver: string | null;
  nextPublicTrustedResolver: string | null;
  importedTrustedResolverConstant: string;
  strictResolverHelper: string | null;
  resolverPkPassedToBuilder: string | null;
  marketEngine: MarketEngine;
  decoded_resolver_arg: string | null;
  postInitOnChainResolver: string | null;
  /** pmAMM program `market_id` u64 string; null if not derived yet. */
  market_id: string | null;
  market_pda: string | null;
  slug: string;
  stage: PipelineFailureStage | string;
};

function makePmammResolverDevDebug(
  engine: MarketEngine,
  slug: string,
  stage: PipelineFailureStage | string,
  extras: {
    market_id?: string | null;
    market_pda?: string | null;
    resolverPkPassedToBuilder?: string | null;
    decoded_resolver_arg?: string | null;
    postInitOnChainResolver?: string | null;
  } = {},
): PmammResolverCreateDevDebug | undefined {
  if (process.env.NODE_ENV !== "development") return undefined;
  if (engine !== "PM_AMM") return undefined;
  let strictResolverHelper: string | null = null;
  try {
    strictResolverHelper = getServerTrustedResolverAddressStrict().toBase58();
  } catch {
    strictResolverHelper = null;
  }
  let resolverPkPassedToBuilder = extras.resolverPkPassedToBuilder ?? null;
  if (resolverPkPassedToBuilder == null) {
    try {
      resolverPkPassedToBuilder = getServerTrustedResolverAddressStrict().toBase58();
    } catch {
      resolverPkPassedToBuilder = null;
    }
  }
  return {
    rawEnvTrustedResolver: process.env.TRUSTED_RESOLVER_ADDRESS ?? null,
    nextPublicTrustedResolver:
      process.env.NEXT_PUBLIC_TRUSTED_RESOLVER_ADDRESS ?? null,
    importedTrustedResolverConstant: TRUSTED_RESOLVER_ADDRESS,
    strictResolverHelper,
    resolverPkPassedToBuilder,
    marketEngine: engine,
    decoded_resolver_arg: extras.decoded_resolver_arg ?? null,
    postInitOnChainResolver: extras.postInitOnChainResolver ?? null,
    market_id: extras.market_id ?? null,
    market_pda: extras.market_pda ?? null,
    slug,
    stage,
  };
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

  const reused = await findReusedGroupedMarketIfDuplicate(sb, input.draft);
  if (reused) {
    console.info(`${LP} reuse existing row for grouped outcome`, {
      slug: reused.slug,
      title: reused.title,
    });
    return { ok: true, market: reused, reusedExisting: true };
  }

  const { yes, no } = splitYesNo(
    input.draft,
    input.yesCondition,
    input.noCondition,
  );
  const slug = makeSlug(input.draft.question);
  const engine: MarketEngine =
    input.engine === "PM_AMM" ? "PM_AMM" : "GAMM";

  let trustedResolver: PublicKey;
  try {
    if (engine === "PM_AMM") {
      trustedResolver = getServerTrustedResolverAddressStrict();
    } else {
      trustedResolver = new PublicKey(TRUSTED_RESOLVER_ADDRESS.trim());
    }
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : "Invalid TRUSTED_RESOLVER_ADDRESS configuration.";
    return { ok: false, error: msg };
  }

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
    market_engine: engine,
    ...(input.draft.eventGroupKey?.trim()
      ? {
          event_group_key: normalizeStoredGroupKey(input.draft.eventGroupKey.trim()),
          event_title: input.draft.eventTitle?.trim() ?? null,
          outcome_label: input.draft.outcomeLabel?.trim() ?? null,
          outcome_type: input.draft.outcomeType?.trim() ?? null,
          group_order:
            typeof input.draft.groupOrder === "number"
              ? input.draft.groupOrder
              : null,
        }
      : {}),
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
  let pmammResolverDevDebug: PmammResolverCreateDevDebug | undefined;
  let pmammMarketIdStr: string | null = null;

  try {
    const mockChain = process.env.MOCK_CHAIN === "1";
    let omnipairProgramPk: PublicKey | null = null;

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

    if (engine === "PM_AMM") {
      if (mockChain) {
        throw new PipelineStageError(
          "FAILED_AT_PRECONDITION",
          "PM_AMM markets require a live chain (disable MOCK_CHAIN).",
        );
      }
      if (process.env.PMAMM_EXECUTE_INIT !== "true") {
        throw new PipelineStageError(
          "FAILED_AT_PRECONDITION",
          "Set PMAMM_EXECUTE_INIT=true to create pmAMM markets on devnet.",
        );
      }
      const treasury = loadMarketEngineAuthority();
      if (!treasury) {
        throw new PipelineStageError(
          "FAILED_AT_PRECONDITION",
          "Set MARKET_ENGINE_AUTHORITY_SECRET (pmAMM market authority).",
        );
      }
      const collateralMintPk = getPmammCollateralMint();
      const liqParsed = parsePmammInitialLiquidityUsdcInput(
        input.initialLiquidityUsdc,
      );
      if (!liqParsed.ok) {
        throw new PipelineStageError("FAILED_AT_PRECONDITION", liqParsed.error);
      }
      const pmammInitialLiquidityAtoms = liqParsed.atoms;
      console.info(`${LP} pmAMM initial liquidity (creator-funded deposit)`, {
        humanInput: liqParsed.humanForLog,
        usdcAtoms: pmammInitialLiquidityAtoms.toString(),
        connectedCreator: creator.toBase58(),
        initAuthority: "MARKET_ENGINE_AUTHORITY (server) for initialize_market only",
      });
      const marketIdBn = pmammMarketIdBnFromSeed(`${slug}:${marketId}`);
      pmammMarketIdStr = marketIdBn.toString();
      const endTsSec = Math.floor(new Date(expiryTs).getTime() / 1000);
      const nowSec = Math.floor(Date.now() / 1000);
      if (!Number.isFinite(endTsSec) || endTsSec <= nowSec + 300) {
        throw new PipelineStageError(
          "FAILED_AT_PRECONDITION",
          "pmAMM requires market end time at least 5 minutes in the future (on-chain rule).",
        );
      }
      const onChainName = slug.slice(0, 64).trim() || "market";
      console.info(`${LP} BEFORE pmAMM initialize_market`, {
        marketId: pmammMarketIdStr,
        endTs: endTsSec,
      });
      let pmammDebugResolverPk: string | null = null;
      let pmammDebugDecodedResolver: string | null = null;
      let pmammDebugMarketPda: string | null = null;
      let pmammDebugPostInitResolver: string | null = null;
      try {
        const resolverPk = getServerTrustedResolverAddressStrict();
        pmammDebugResolverPk = resolverPk.toBase58();
        if (resolverPk.toBase58() !== EXPECTED_PMAMM_CREATE_RESOLVER) {
          throw new Error(
            `Wrong resolver passed to pmAMM init: ${resolverPk.toBase58()}`,
          );
        }
        const rawEnvTrusted = process.env.TRUSTED_RESOLVER_ADDRESS;
        if (resolverPk.toBase58() !== (rawEnvTrusted?.trim() ?? "")) {
          console.error(
            "[predicted][pmamm-create] TRUSTED* env snapshot (resolver preflight failed)",
            Object.fromEntries(
              Object.entries(process.env).filter(([k]) => k.includes("TRUSTED")),
            ),
          );
          throw new Error(
            `Wrong resolver passed to pmAMM init: expected ${process.env.TRUSTED_RESOLVER_ADDRESS}, got ${resolverPk.toBase58()}`,
          );
        }

        console.info(
          "[predicted][pmamm-create] before_pmammBuildInitializeMarketTransaction",
          {
            rawEnvTrustedResolver: process.env.TRUSTED_RESOLVER_ADDRESS,
            nextPublicTrustedResolver:
              process.env.NEXT_PUBLIC_TRUSTED_RESOLVER_ADDRESS,
            importedTrustedResolverConstant: TRUSTED_RESOLVER_ADDRESS,
            strictResolverHelper: getServerTrustedResolverAddressStrict().toBase58(),
            resolverPkPassedToBuilder: resolverPk.toBase58(),
            marketEngine: engine,
            slug,
            market_id: pmammMarketIdStr,
          },
        );
        console.info(
          "[predicted][pmamm-create] process.env keys containing TRUSTED",
          Object.fromEntries(
            Object.entries(process.env).filter(([k]) => k.includes("TRUSTED")),
          ),
        );

        await validatePmammCollateralMint(connection, collateralMintPk);
        const built = await pmammBuildInitializeMarketTransaction({
          connection,
          authority: treasury.publicKey,
          resolver: resolverPk,
          marketId: marketIdBn,
          endTs: new BN(endTsSec),
          name: onChainName,
        });
        built.transaction.partialSign(treasury);
        pmammDebugDecodedResolver = built.decodedInitializeMarketResolverArg;
        pmammDebugMarketPda = built.marketPda.toBase58();
        console.info("[predicted][pmamm-create] market PDA for init", {
          marketPdaForInit: pmammDebugMarketPda,
          market_id: pmammMarketIdStr,
          slug,
        });
        const sim = await connection.simulateTransaction(built.transaction);
        if (sim.value.err) {
          const rawLogs = sim.value.logs;
          const logs =
            rawLogs == null ? "" : Array.isArray(rawLogs) ? rawLogs.join("\n") : String(rawLogs);
          throw solanaPipelineStage(
            "FAILED_AT_PMAMM_INIT",
            `InitializeMarket simulation failed (${JSON.stringify(sim.value.err)}). ${logs}`,
            sim,
          );
        }
        const sigI = await connection.sendRawTransaction(
          built.transaction.serialize(),
          { skipPreflight: false },
        );
        await connection.confirmTransaction(sigI, "confirmed");
        poolInitTx = sigI;
        createdTxSig = sigI;
        yesMint = built.yesMint;
        noMint = built.noMint;
        poolAddress = built.marketPda;

        const programForRead = createPmammProgram(connection, SystemProgram.programId);
        console.info("[predicted][pmamm-create] market PDA fetched after init", {
          marketPdaFetchedAfterInit: poolAddress.toBase58(),
          market_id: pmammMarketIdStr,
          slug,
        });
        const rawAcc = await connection.getAccountInfo(poolAddress, "confirmed");
        if (rawAcc?.data) {
          const u8 = Buffer.from(rawAcc.data as Buffer | Uint8Array);
          const pmPid = requirePmammProgramId().toBase58();
          logPmammMarketAccountRawLayoutProbe({
            label: "post_initialize_market",
            rawData: u8,
            nextPublicPmammProgramId:
              process.env.NEXT_PUBLIC_PMAMM_PROGRAM_ID?.trim() ?? null,
            anchorProgramId: pmPid,
          });
        }
        const freshMarket = await fetchPmammMarketAccount(programForRead, poolAddress);
        pmammDebugPostInitResolver = freshMarket.resolver.toBase58();
        const expectedStrictResolverBs58 = resolverPk.toBase58();
        console.log("[pmAMM post-init] on-chain resolver =", freshMarket.resolver.toBase58());
        console.log("[pmAMM post-init] expected resolver =", expectedStrictResolverBs58);
        console.log("[pmAMM post-init] on-chain authority =", freshMarket.authority.toBase58());

        if (freshMarket.resolver.toBase58() !== expectedStrictResolverBs58) {
          const got = freshMarket.resolver.toBase58();
          const auth = freshMarket.authority.toBase58();
          const zeroDefault = PublicKey.default.toBase58();
          const hints: string[] = [];
          hints.push(
            "Check the initialize_market transaction logs for msg!(\"initialize_market ...\") lines — if stored resolver is correct on-chain but the client reads zero/default, the IDL field order or copied lib/engines/idl/pm_amm.json is out of sync with the deployed program.",
          );
          hints.push(
            "If logs show stored resolver as default while the arg was non-zero, the initialize_market instruction layout may not match the chain binary (wrong IDL / old client).",
          );
          if (got === auth) {
            hints.push(
              "Got equals authority — resolver arg was likely default() on-chain (instruction args mismatch) or the program still maps resolver incorrectly.",
            );
          }
          if (got === zeroDefault) {
            hints.push(
              "Got all-zero pubkey — often wrong decode offset (stale IDL vs account) or resolver bytes never serialized; compare raw slice resolver above with Anchor decode.",
            );
          }
          const namePrefix = Buffer.alloc(32);
          namePrefix.write(onChainName.slice(0, 32));
          const namePrefixAsPubkey = new PublicKey(namePrefix).toBase58();
          if (got === namePrefixAsPubkey) {
            hints.push(
              "Got equals the first 32 bytes of the market name interpreted as a Pubkey — the active deployed program/account layout likely still has `resolver` after `name`, while this app/IDL reads `resolver` before `name`. Redeploy the rebuilt program to the same RPC/cluster the app uses, or point the app to the cluster you deployed.",
            );
          }
          throw new PipelineStageError(
            "FAILED_AT_PMAMM_INIT",
            `Resolver mismatch after pmAMM init: expected ${expectedStrictResolverBs58}, got ${got}, authority ${auth}.${hints.length ? " " + hints.join(" ") : ""}`,
          );
        }
      } catch (e) {
        const st: PipelineFailureStage | string = isPipelineStageError(e)
          ? e.stage
          : "FAILED_AT_PMAMM_INIT";
        pmammResolverDevDebug = makePmammResolverDevDebug(engine, slug, st, {
          market_id: pmammMarketIdStr,
          market_pda: pmammDebugMarketPda,
          resolverPkPassedToBuilder: pmammDebugResolverPk,
          decoded_resolver_arg: pmammDebugDecodedResolver,
          postInitOnChainResolver: pmammDebugPostInitResolver,
        });
        if (isPipelineStageError(e)) throw e;
        throw solanaPipelineStage("FAILED_AT_PMAMM_INIT", formatUnknownError(e), e);
      }
      let depositTransactionBase64: string;
      try {
        await preflightPmammInitialLpUsdc({
          connection,
          collateralMint: collateralMintPk,
          collateralDecimals: 6,
          depositor: creator,
          requiredAtoms: pmammInitialLiquidityAtoms,
          role: "CREATOR_WALLET",
        });
        const programPk = requirePmammProgramId();
        const userCollateralAta = getAssociatedTokenAddressSync(
          collateralMintPk,
          creator,
          false,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        );
        const lpReceiverPda = derivePmammLpPda(
          poolAddress,
          creator,
          programPk,
        );
        let userBalAtoms = 0n;
        try {
          const { balanceAtoms } = await readPmammDepositorUsdcBalance({
            connection,
            collateralMint: collateralMintPk,
            depositor: creator,
          });
          userBalAtoms = balanceAtoms;
        } catch {
          userBalAtoms = 0n;
        }
        console.info(`${LP} pmAMM deposit_liquidity tx (unsigned, creator signs)`, {
          connectedWallet: creator.toBase58(),
          initialLpDepositor: creator.toBase58(),
          usdcSourceAta: userCollateralAta.toBase58(),
          lpReceiver: lpReceiverPda.toBase58(),
          requiredUsdcAtoms: pmammInitialLiquidityAtoms.toString(),
          userUsdcBalanceAtoms: userBalAtoms.toString(),
          collateralDecimals: 6,
        });
        const depTx = await pmammBuildDepositLiquidityUserTransaction({
          connection,
          user: creator,
          marketPda: poolAddress,
          amountAtoms: new BN(pmammInitialLiquidityAtoms.toString()),
        });
        depositTransactionBase64 = Buffer.from(
          depTx.serialize({
            requireAllSignatures: false,
            verifySignatures: false,
          }),
        ).toString("base64");
      } catch (e) {
        const st: PipelineFailureStage | string = isPipelineStageError(e)
          ? e.stage
          : "FAILED_AT_PMAMM_DEPOSIT";
        pmammResolverDevDebug = makePmammResolverDevDebug(engine, slug, st, {
          market_id: pmammMarketIdStr,
          market_pda: poolAddress.toBase58(),
        });
        if (isPipelineStageError(e)) throw e;
        const diag = collectSolanaErrorDiagnostics(e);
        let msg = formatUnknownError(e);
        if (isSplTokenInsufficientFundsMessage(diag)) {
          msg =
            "Insufficient USDC in the creator wallet to build the initial liquidity deposit.";
        } else if (isNativeSolInsufficientMessage(diag)) {
          msg =
            "Not enough SOL in the creator wallet to pay fees for the liquidity deposit.";
        }
        throw solanaPipelineStage("FAILED_AT_PMAMM_DEPOSIT", msg, e);
      }

      try {
        const { data: creatingRow, error: midErr } = await sb
          .from("markets")
          .update({
            yes_mint: yesMint.toBase58(),
            no_mint: noMint.toBase58(),
            pool_address: poolAddress.toBase58(),
            status: "creating",
            created_tx: createdTxSig ?? poolInitTx,
            mint_yes_tx: null,
            mint_no_tx: null,
            pool_init_tx: poolInitTx,
            seed_liquidity_tx: null,
            market_engine: engine,
            onchain_program_id: requirePmammProgramId().toBase58(),
            pmamm_market_address: poolAddress.toBase58(),
            usdc_mint: getPmammCollateralMint().toBase58(),
            pmamm_market_id: pmammMarketIdStr,
          })
          .eq("id", marketId)
          .select()
          .single();

        if (midErr || !creatingRow) {
          throw new PipelineStageError(
            "FAILED_AT_SUPABASE_FINAL",
            midErr?.message ??
              "Failed to persist market after pmAMM initialize_market.",
          );
        }
        console.info(`${LP} pmAMM pipeline paused for user-signed deposit`, {
          slug: (creatingRow as MarketRecord).slug,
          creator: creator.toBase58(),
        });
        return {
          ok: true,
          market: creatingRow as MarketRecord,
          pmammAwaitingUserDeposit: { depositTransactionBase64 },
        };
      } catch (e) {
        if (isPipelineStageError(e)) throw e;
        throw new PipelineStageError("FAILED_AT_SUPABASE_FINAL", formatUnknownError(e), {
          cause: e,
        });
      }
    } else if (mockChain) {
      omnipairProgramPk = getOmnipairProgramId();
      console.info(`${LP} MOCK_CHAIN=1 — stub chain steps`);
      const m = createMockOutcomeMints();
      yesMint = m.yesMint;
      noMint = m.noMint;
      authorityYesAta = m.authorityYesAta;
      authorityNoAta = m.authorityNoAta;
      poolAddress = deriveOmnipairMarketAccounts(
        omnipairProgramPk,
        yesMint,
        noMint,
      ).pairAddress;
      console.warn(
        `${LP} MOCK_CHAIN=1 — fake mints and PDAs; not real devnet assets.`,
      );
    } else {
      omnipairProgramPk = getOmnipairProgramId();
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
        if (isPipelineStageError(e) && e.stage === "FAILED_AT_OUTCOME_ATA") {
          console.error(
            `${LP} outcome ATA setup failed (structured)`,
            e.outcomeAtaContext,
            e,
          );
          throw e;
        }
        const msg = formatUnknownError(e);
        console.error(`${LP} outcome ATA setup failed`, msg, e);
        throw new PipelineStageError("FAILED_AT_OUTCOME_ATA", msg, { cause: e });
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
          market_engine: engine,
          onchain_program_id: (
            omnipairProgramPk ?? getOmnipairProgramId()
          ).toBase58(),
          pmamm_market_address: null,
          usdc_mint: DEVNET_USDC_MINT.toBase58(),
          pmamm_market_id: pmammMarketIdStr,
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
                marketEngineHint: "GAMM",
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
    const configuredPmammPid =
      process.env.NEXT_PUBLIC_PMAMM_PROGRAM_ID?.trim() ?? "";
    const decodeFail = solanaDiagnosticsIndicateInstructionDeserializeFailure(e);
    const pmammInitStage =
      isPipelineStageError(e) && e.stage === "FAILED_AT_PMAMM_INIT";
    const isPmammInstructionFormatMismatch =
      decodeFail &&
      ((missingProgramId &&
        missingProgramId === configuredPmammPid) ||
        pmammInitStage);
    const errorMessage = isPmammInstructionFormatMismatch
      ? `${formatPmammInstructionFormatMismatchMessage()} — ${message}`
      : missingProgramId
        ? `${formatMissingDeployedProgramMessage(missingProgramId)} — ${message}`
        : message;
    const outcomeAtaContext =
      isPipelineStageError(e) && e.stage === "FAILED_AT_OUTCOME_ATA"
        ? e.outcomeAtaContext
        : undefined;

    if (engine === "PM_AMM" && process.env.NODE_ENV === "development") {
      pmammResolverDevDebug =
        pmammResolverDevDebug ??
        makePmammResolverDevDebug(
          engine,
          slug,
          stage ?? "FAILED_AT_PRECONDITION",
          {
            market_id: pmammMarketIdStr,
          },
        );
    }
    if (pmammResolverDevDebug && stage) {
      pmammResolverDevDebug = { ...pmammResolverDevDebug, stage };
    }

    await markStatus(marketId, "failed");
    return {
      ok: false,
      error: errorMessage,
      stage,
      missingProgramId: missingProgramId ?? undefined,
      outcomeAtaContext,
      ...(pmammResolverDevDebug ? { pmammResolverDebug: pmammResolverDevDebug } : {}),
    };
  }
}

export type CompletePmammDepositInput = {
  slug: string;
  creatorWallet: string;
  depositSignature: string;
};

/**
 * After the creator signs and submits `deposit_liquidity`, persist `live` + seed tx and chart data.
 */
export async function completePmammUserDepositPipeline(
  input: CompletePmammDepositInput,
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

  const slug = input.slug.trim();
  const depositSignature = input.depositSignature.trim();
  if (!slug || !depositSignature) {
    return { ok: false, error: "Missing slug or deposit signature." };
  }

  const { data: row, error: fetchErr } = await sb
    .from("markets")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (fetchErr || !row) {
    return { ok: false, error: "Market not found." };
  }

  const rec = row as MarketRecord;
  if (rec.market_engine !== "PM_AMM") {
    return { ok: false, error: "This market is not a pmAMM market." };
  }
  if (rec.creator_wallet.trim() !== creator.toBase58()) {
    return {
      ok: false,
      error: "Connected wallet must match the market creator.",
    };
  }
  if (!rec.pool_address || !rec.yes_mint || !rec.no_mint) {
    return { ok: false, error: "Market is missing on-chain pool data." };
  }

  if (rec.status === "live") {
    if (rec.seed_liquidity_tx === depositSignature) {
      return { ok: true, market: rec };
    }
    return { ok: false, error: "Market is already live with a different deposit." };
  }

  if (rec.status !== "creating") {
    return {
      ok: false,
      error: "Market is not waiting for the initial liquidity deposit.",
    };
  }

  if (rec.seed_liquidity_tx) {
    return {
      ok: false,
      error: "Initial liquidity deposit was already recorded.",
    };
  }

  const connection = getConnection();
  const marketPda = new PublicKey(rec.pool_address);
  const programId = requirePmammProgramId();

  try {
    await assertPmammDepositTxFromCreator({
      connection,
      signature: depositSignature,
      marketPda,
      creator,
      pmammProgramId: programId,
    });
  } catch (e) {
    return {
      ok: false,
      error: formatUnknownError(e),
      stage: "FAILED_AT_PMAMM_DEPOSIT",
    };
  }

  try {
    const { data: live, error: upErr } = await sb
      .from("markets")
      .update({
        status: "live",
        seed_liquidity_tx: depositSignature,
        last_known_yes_price: 0.5,
        last_known_no_price: 0.5,
        last_known_volume_usd: 0,
        last_stats_updated_at: new Date().toISOString(),
      })
      .eq("id", rec.id)
      .eq("status", "creating")
      .select()
      .single();

    if (upErr || !live) {
      return {
        ok: false,
        error:
          upErr?.message ??
          "Could not finalize market. It may have been updated already — refresh and try again.",
        stage: "FAILED_AT_SUPABASE_FINAL",
      };
    }

    const liveRow = live as MarketRecord;
    console.info(`${LP} pmAMM user deposit confirmed`, {
      slug: liveRow.slug,
      depositSignature,
      creator: creator.toBase58(),
      pool: rec.pool_address,
    });

    try {
      const repair = await seedMarketPriceHistoryIfEmpty(liveRow.slug);
      if (repair.ok && repair.seeded) {
        console.info(`${LP} pmAMM chart history seeded`, repair);
      } else if (!repair.ok) {
        console.warn(`${LP} pmAMM chart seed failed`, repair.error);
      }
    } catch (e) {
      console.warn(
        `${LP} pmAMM chart seed exception`,
        formatUnknownError(e),
      );
    }

    return { ok: true, market: liveRow };
  } catch (e) {
    return {
      ok: false,
      error: formatUnknownError(e),
      stage: "FAILED_AT_SUPABASE_FINAL",
    };
  }
}

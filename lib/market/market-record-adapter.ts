import { coerceUsdVolumeFromDb } from "@/lib/market/coerce-db-numeric";
import {
  computeMarketLifecycle,
  logMarketLifecycleTransition,
} from "@/lib/market/market-lifecycle";
import { pickActiveResolveOrExpiryRaw, parseResolveAfterEpochMs } from "@/lib/market/utc-instant";
import { pinataGatewayUrl } from "@/lib/storage/pinata";
import type { MarketRecord } from "@/lib/types/market-record";
import type {
  Market,
  MarketEngine,
  MarketTopic,
  OutcomeSide,
} from "@/lib/types/market";

const CARD_LAYOUTS: Array<Market["cardLayout"]> = ["a", "b", "c", "d"];

function clampUnit(p: number): number {
  if (!Number.isFinite(p)) return 0.5;
  return Math.max(0, Math.min(1, p));
}

function coerceTopic(raw: string): MarketTopic {
  const c = raw.toLowerCase().trim();
  if (
    c === "politics" ||
    c === "sports" ||
    c === "crypto" ||
    c === "tech" ||
    c === "finance" ||
    c === "predicted"
  ) {
    return c;
  }
  return "predicted";
}

/**
 * Maps a Supabase `markets` row to `Market` for existing card/detail UI.
 * Uses real DB + on-chain fields; numeric “odds” default to 50% when unknown.
 */
export function marketRecordToMarket(record: MarketRecord, layoutIndex = 0): Market {
  const slug = record.slug;
  const imageCid = record.image_cid?.trim();
  /** Deterministic neutral cover when no Pinata CID (Next `images.remotePatterns` includes picsum). */
  const imageUrl = imageCid
    ? pinataGatewayUrl(imageCid)
    : `https://picsum.photos/seed/${encodeURIComponent(slug)}/640/360`;

  const createdAt = Date.parse(record.created_at);
  const t = coerceTopic(record.category);
  const layout = CARD_LAYOUTS[Math.abs(layoutIndex) % CARD_LAYOUTS.length]!;

  const rawY = record.last_known_yes_price;
  const rawN = record.last_known_no_price;

  const yesProbability =
    typeof rawY === "number" && Number.isFinite(rawY) ? clampUnit(rawY) : 0.5;
  const noFromDb =
    typeof rawN === "number" && Number.isFinite(rawN) ? clampUnit(rawN) : null;
  const noProbability = noFromDb ?? Math.max(0, Math.min(1, 1 - yesProbability));

  const resolveAfterIso =
    pickActiveResolveOrExpiryRaw(record) ?? record.expiry_ts ?? "";
  const nowMs = Date.now();
  let { lifecycle, phase } = computeMarketLifecycle(record, nowMs, slug);
  const dbRes = record.resolution_status ?? "active";
  const tEnd = parseResolveAfterEpochMs(
    record as Pick<Record<string, unknown>, "resolve_after" | "expiry_ts">,
  );
  if (dbRes !== "resolved" && tEnd != null && nowMs < tEnd) {
    lifecycle = "active";
    phase = "trading";
  }
  logMarketLifecycleTransition(
    record,
    { lifecycle, phase },
    slug,
    nowMs,
  );
  const isResolved = lifecycle === "resolved";
  const ro = record.resolved_outcome;
  const resolvedOutcome: OutcomeSide | undefined =
    ro === "yes" || ro === "no" ? ro : undefined;

  let finalYes = yesProbability;
  let finalNo = noProbability;
  if (isResolved && resolvedOutcome) {
    if (resolvedOutcome === "yes") {
      finalYes = 1;
      finalNo = 0;
    } else {
      finalYes = 0;
      finalNo = 1;
    }
  }

  /** Immediate UI baseline from DB; on-chain refresh can refine in header/API without blocking cards. */
  const volumeUsd = coerceUsdVolumeFromDb(record.last_known_volume_usd);

  const engine: MarketEngine =
    record.market_engine === "PM_AMM" ? "PM_AMM" : "GAMM";
  const poolPrimary =
    engine === "PM_AMM"
      ? (record.pmamm_market_address ?? record.pool_address)
      : record.pool_address;

  const pool =
    poolPrimary && record.yes_mint && record.no_mint
      ? {
          poolId: poolPrimary,
          yesMint: record.yes_mint,
          noMint: record.no_mint,
          yesPrice: finalYes,
          noPrice: finalNo,
        }
      : undefined;

  const m: Market = {
    id: slug,
    marketRowId: record.id,
    engine,
    onchainProgramId: record.onchain_program_id ?? undefined,
    pmammMarketAddress: record.pmamm_market_address ?? undefined,
    collateralMint: record.usdc_mint ?? undefined,
    question: record.title,
    description: record.description,
    imageUrl,
    category: t,
    poolApy: 0,
    kind: "binary",
    cardLayout: layout,
    yesProbability: finalYes,
    expiry: record.expiry_ts,
    phase,
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    snapshot: { liquidityUsd: 0, volumeUsd },
    resolverPubkey: record.resolver_wallet,
    resolution: {
      rules: record.resolution_rules,
      source: record.resolution_source,
      resolverWallet: record.resolver_wallet,
      status: lifecycle,
      resolveAfter: resolveAfterIso,
      ...(resolvedOutcome && isResolved
        ? {
            resolvedOutcome,
            resolvedAt: record.resolved_at ?? undefined,
          }
        : {}),
    },
    pool,
    creatorHandle: `@${record.creator_wallet.slice(0, 4)}…${record.creator_wallet.slice(-4)}`,
    views: 0,
    aiOverview: undefined,
    lastStatsUpdatedAt: record.last_stats_updated_at ?? null,
  };

  return m;
}

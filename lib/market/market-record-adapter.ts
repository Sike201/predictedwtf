import { coerceUsdVolumeFromDb } from "@/lib/market/coerce-db-numeric";
import { pinataGatewayUrl } from "@/lib/storage/pinata";
import type { MarketRecord } from "@/lib/types/market-record";
import type { Market, MarketTopic } from "@/lib/types/market";

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

  /** Immediate UI baseline from DB; on-chain refresh can refine in header/API without blocking cards. */
  const volumeUsd = coerceUsdVolumeFromDb(record.last_known_volume_usd);

  const pool =
    record.pool_address && record.yes_mint && record.no_mint
      ? {
          poolId: record.pool_address,
          yesMint: record.yes_mint,
          noMint: record.no_mint,
          yesPrice: yesProbability,
          noPrice: noProbability,
        }
      : undefined;

  const m: Market = {
    id: slug,
    marketRowId: record.id,
    question: record.title,
    description: record.description,
    imageUrl,
    category: t,
    poolApy: 0,
    kind: "binary",
    cardLayout: layout,
    yesProbability,
    expiry: record.expiry_ts,
    phase: record.status === "live" ? "trading" : "raising",
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    snapshot: { liquidityUsd: 0, volumeUsd },
    resolution: {
      rules: record.resolution_rules,
      source: record.resolution_source,
      resolverWallet: record.resolver_wallet,
    },
    pool,
    creatorHandle: `@${record.creator_wallet.slice(0, 4)}…${record.creator_wallet.slice(-4)}`,
    views: 0,
    aiOverview: undefined,
    lastStatsUpdatedAt: record.last_stats_updated_at ?? null,
  };

  return m;
}

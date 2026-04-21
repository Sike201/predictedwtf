/**
 * Core domain types for Solana prediction markets (Omnipair GAMM).
 * UI + future Anchor program alignment.
 */

/** Primary topic tag on a market (used for category filters). */
export type MarketTopic =
  | "politics"
  | "sports"
  | "crypto"
  | "tech"
  | "finance"
  | "predicted";

/** UI filter / sort mode (feed toolbar) — single key when sort + topic are not split. */
export type MarketFilterKey =
  | "trending"
  | "new"
  | "ending-soon"
  | "all"
  | MarketTopic;

/** Left row: sort mode (can combine with a category). */
export type MarketSortKey = "trending" | "new" | "ending-soon";

/** Right row: topic chip. */
export type MarketCategoryKey = "all" | MarketTopic;

export type MarketPhase = "raising" | "trading" | "resolved";

export type OutcomeSide = "yes" | "no";

/** Binary YES/NO vs multi “date bucket” style outcomes. */
export type MarketKind = "binary" | "dates";

/** Feed card layout presets (mixed visuals). */
export type MarketCardLayout = "a" | "b" | "c" | "d";

export interface DateOutcomeOption {
  id: string;
  label: string;
  /** Implied probability 0–1 */
  probability: number;
}

export interface OmnipairPoolParams {
  poolId: string;
  yesMint: string;
  noMint: string;
  yesPrice: number;
  noPrice: number;
}

export interface RaiseRound {
  targetUsd: number;
  endsAt: string;
  raisedUsd: number;
  initialLiquidityUsd: number;
}

export interface Resolution {
  rules: string;
  source: string;
  resolverWallet: string;
  resolvedOutcome?: OutcomeSide;
  resolvedAt?: string;
}

export interface MarketSnapshot {
  liquidityUsd: number;
  volumeUsd: number;
}

export interface Market {
  id: string;
  /** Supabase `markets.id` (UUID) when loaded from DB — for server-side cache updates. */
  marketRowId?: string;
  question: string;
  description: string;
  imageUrl: string;
  category: MarketTopic;
  /** Pool APY shown on cards (annualized %, mock UI). */
  poolApy: number;
  kind: MarketKind;
  cardLayout: MarketCardLayout;
  yesProbability: number;
  dateOutcomes?: DateOutcomeOption[];
  expiry: string;
  phase: MarketPhase;
  snapshot: MarketSnapshot;
  resolution: Resolution;
  pool?: OmnipairPoolParams;
  raise?: RaiseRound;
  createdAt: number;
  chartSeries?: { t: number; p: number }[];
  /** Display handle e.g. @predicted */
  creatorHandle?: string;
  /** Page views (mock analytics). */
  views?: string | number;
  /** Longer AI-style summary for the detail page. */
  aiOverview?: string;
  /** ISO timestamp from `markets.last_stats_updated_at` (cached stats row). */
  lastStatsUpdatedAt?: string | null;
}

export interface MarketDraft {
  question: string;
  description: string;
  expiry: string;
  resolutionRules: string;
  resolutionSource: string;
  aiReasoning: string;
  suggestedRules: string[];
  /** From Grok validation: what the cover image should depict. */
  imageRequirements?: string;
}

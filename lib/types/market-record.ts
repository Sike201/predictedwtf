import type { MarketEngine } from "@/lib/types/market";

/** Supabase `markets` row (prediction market lifecycle). */
export type MarketStatus = "creating" | "live" | "failed";

export type MarketResolutionStatus = "active" | "resolved";

export interface MarketRecord {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  creator_wallet: string;
  resolver_wallet: string;
  resolution_source: string;
  resolution_rules: string;
  yes_condition: string;
  no_condition: string;
  expiry_ts: string;
  /** When the trusted resolver may settle (MVP: matches `expiry_ts` for new markets). */
  resolve_after: string;
  resolution_status: MarketResolutionStatus;
  resolved_outcome: string | null;
  resolved_at: string | null;
  image_cid?: string | null;
  yes_mint: string | null;
  no_mint: string | null;
  pool_address: string | null;
  status: MarketStatus;
  /** Primary on-chain tx (pool init); see `pool_init_tx`, `seed_liquidity_tx`. */
  created_tx: string | null;
  mint_yes_tx?: string | null;
  mint_no_tx?: string | null;
  pool_init_tx?: string | null;
  seed_liquidity_tx?: string | null;
  created_at: string;
  /** Denormalized from last successful snapshot / trade (instant feed). */
  last_known_yes_price?: number | null;
  last_known_no_price?: number | null;
  last_known_volume_usd?: number | null;
  last_stats_updated_at?: string | null;
  market_engine?: MarketEngine | null;
  onchain_program_id?: string | null;
  pmamm_market_address?: string | null;
  usdc_mint?: string | null;
  pmamm_market_id?: string | null;
}

export interface CreateMarketPayload {
  title: string;
  description: string;
  category: string;
  creator_wallet: string;
  resolver_wallet: string;
  resolution_source: string;
  resolution_rules: string;
  yes_condition: string;
  no_condition: string;
  expiry_iso: string;
}

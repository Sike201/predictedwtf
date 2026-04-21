/** Supabase `markets` row (prediction market lifecycle). */
export type MarketStatus = "creating" | "live" | "failed";

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

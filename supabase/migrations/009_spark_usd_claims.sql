-- Dev/test SparkUSD faucet claim ledger (server-enforced, max once per wallet per UTC day).
create table if not exists public.spark_usd_claims (
  id uuid primary key default gen_random_uuid(),
  wallet text not null,
  amount bigint not null check (amount > 0),
  claimed_at timestamptz not null default now(),
  claim_day_utc date not null,
  tx_signature text not null,
  unique (wallet, claim_day_utc)
);

create index if not exists spark_usd_claims_wallet_idx
  on public.spark_usd_claims (wallet);

create index if not exists spark_usd_claims_claimed_at_idx
  on public.spark_usd_claims (claimed_at desc);

alter table public.spark_usd_claims enable row level security;

-- No client policies: server uses service role only.

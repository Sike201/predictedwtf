-- Prediction markets (index + metadata). RLS policies are app-specific; enable as needed.
create table if not exists public.markets (
  id uuid primary key default gen_random_uuid (),
  slug text not null unique,
  title text not null,
  description text not null,
  category text not null default 'predicted',
  creator_wallet text not null,
  resolver_wallet text not null,
  resolution_source text not null,
  resolution_rules text not null,
  yes_condition text not null default '',
  no_condition text not null default '',
  expiry_ts timestamptz not null,
  yes_mint text,
  no_mint text,
  pool_address text,
  status text not null default 'creating' check (status in ('creating', 'live', 'failed')),
  created_tx text,
  created_at timestamptz not null default now()
);

create index if not exists markets_creator_idx on public.markets (creator_wallet);
create index if not exists markets_status_idx on public.markets (status);

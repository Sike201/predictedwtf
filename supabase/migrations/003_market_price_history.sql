-- Append-only probability snapshots after pool bootstrap and each trade (YES spot from reserves).
create table if not exists public.market_price_history (
  id uuid primary key default gen_random_uuid (),
  market_slug text not null references public.markets (slug) on delete cascade,
  tx_signature text not null,
  recorded_at timestamptz not null default now(),
  reserve_yes text not null,
  reserve_no text not null,
  yes_probability double precision not null
);

create unique index if not exists market_price_history_slug_tx_unique on public.market_price_history (
  market_slug,
  tx_signature
);

create index if not exists market_price_history_slug_time_idx on public.market_price_history (
  market_slug,
  recorded_at asc
);

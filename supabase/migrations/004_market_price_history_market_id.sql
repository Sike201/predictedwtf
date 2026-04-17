-- Align with on-chain snapshots: FK to markets.id, yes_price, snapshot_ts.
-- Run after 003. Backfills market_id from legacy market_slug when present.

alter table public.market_price_history
  add column if not exists market_id uuid references public.markets (id) on delete cascade;

update public.market_price_history mph
set
  market_id = m.id
from
  public.markets m
where
  m.slug = mph.market_slug
  and mph.market_id is null;

delete from public.market_price_history
where
  market_id is null;

alter table public.market_price_history
  add column if not exists yes_price double precision;

update public.market_price_history
set
  yes_price = yes_probability
where
  yes_price is null
  and yes_probability is not null;

alter table public.market_price_history rename column recorded_at to snapshot_ts;

drop index if exists market_price_history_slug_tx_unique;

drop index if exists market_price_history_slug_time_idx;

alter table public.market_price_history drop column if exists market_slug;

alter table public.market_price_history drop column if exists yes_probability;

alter table public.market_price_history alter column market_id set not null;

alter table public.market_price_history alter column yes_price set not null;

create unique index if not exists market_price_history_market_tx_unique on public.market_price_history (
  market_id,
  tx_signature
);

create index if not exists market_price_history_market_time_idx on public.market_price_history (
  market_id,
  snapshot_ts asc
);

-- Denormalized stats for instant feed/detail reads (updated on snapshot + trades).
alter table public.markets
  add column if not exists last_known_yes_price double precision default 0.5;

alter table public.markets
  add column if not exists last_known_no_price double precision default 0.5;

alter table public.markets
  add column if not exists last_known_volume_usd double precision default 0;

alter table public.markets
  add column if not exists last_stats_updated_at timestamptz;

update public.markets
set
  last_known_yes_price = coalesce(last_known_yes_price, 0.5),
  last_known_no_price = coalesce(last_known_no_price, 0.5),
  last_known_volume_usd = coalesce(last_known_volume_usd, 0)
where
  last_known_yes_price is null
  or last_known_no_price is null
  or last_known_volume_usd is null;

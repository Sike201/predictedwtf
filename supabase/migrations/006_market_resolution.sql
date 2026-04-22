-- Trusted resolver MVP: resolution timing + outcome persistence.
alter table public.markets
  add column if not exists resolve_after timestamptz;

alter table public.markets
  add column if not exists resolution_status text not null default 'active'
  constraint markets_resolution_status_check
  check (resolution_status in ('active', 'resolved'));

alter table public.markets
  add column if not exists resolved_outcome text
  constraint markets_resolved_outcome_check
  check (resolved_outcome is null or resolved_outcome in ('yes', 'no'));

alter table public.markets
  add column if not exists resolved_at timestamptz;

update public.markets
  set resolve_after = expiry_ts
  where resolve_after is null;

alter table public.markets
  alter column resolve_after set not null;

create index if not exists markets_resolution_status_idx
  on public.markets (resolution_status);

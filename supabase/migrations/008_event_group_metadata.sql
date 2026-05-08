-- Optional metadata for grouping multiple binary markets under one event (feed + /events/[key]).
alter table public.markets
  add column if not exists event_group_key text,
  add column if not exists event_title text,
  add column if not exists outcome_label text,
  add column if not exists outcome_type text,
  add column if not exists group_order int;

create index if not exists markets_event_group_key_idx
  on public.markets (event_group_key)
  where event_group_key is not null;

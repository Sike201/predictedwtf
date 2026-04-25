-- GAMM (Omnipair) vs PM_AMM (pm-AMM) on-chain engine
alter table public.markets
  add column if not exists market_engine text default 'GAMM';

update public.markets set market_engine = 'GAMM' where market_engine is null;

alter table public.markets
  alter column market_engine set not null;

alter table public.markets
  alter column market_engine set default 'GAMM';

alter table public.markets
  drop constraint if exists markets_market_engine_check;

alter table public.markets
  add constraint markets_market_engine_check
  check (market_engine in ('GAMM', 'PM_AMM'));

alter table public.markets
  add column if not exists onchain_program_id text;

alter table public.markets
  add column if not exists pmamm_market_address text;

alter table public.markets
  add column if not exists usdc_mint text;

alter table public.markets
  add column if not exists pmamm_market_id text;

  -- On-chain tx tracking + Pinata image CID
  alter table public.markets
    add column if not exists image_cid text;

  alter table public.markets
    add column if not exists mint_yes_tx text;

  alter table public.markets
    add column if not exists mint_no_tx text;

  alter table public.markets
    add column if not exists pool_init_tx text;

  alter table public.markets
    add column if not exists seed_liquidity_tx text;

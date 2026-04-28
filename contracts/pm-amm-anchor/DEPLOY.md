# Deploy `pm_amm` to Solana devnet

This directory is vendored from [Mattdgn/pm-amm](https://github.com/Mattdgn/pm-amm) (`anchor/`), keyed to **our** program id (see `declare_id!` in `programs/pm_amm/src/lib.rs` and `[programs.devnet]` in `Anchor.toml`).

## Prerequisites

- `anchor` 1.x (matching `Anchor.toml`)
- Solana CLI, payer wallet with **~6+ SOL** on devnet. Program ELF is ~823 KiB ⇒ rent-exempt minimum is roughly **`solana rent 822736`** (~**5.73 SOL** today) plus **~0.004 SOL fee** — if `Insufficient funds`, use `solana airdrop 2` (repeat until funded) then retry deploy.

## Deploy

```bash
cd contracts/pm-amm-anchor
anchor build
solana program deploy target/deploy/pm_amm.so \
  --program-id target/deploy/pm_amm-keypair.json \
  --url devnet
```

After a successful deploy, copy the IDL used by the app:

```bash
cp target/idl/pm_amm.json ../../lib/engines/idl/pm_amm.json
```

Set in `.env`:

```bash
NEXT_PUBLIC_PMAMM_PROGRAM_ID=<pubkey from target/deploy/pm_amm-keypair.json>
```

Matt’s reference devnet deployment (`8V872…MZNj`) is **not** used here—the app expects the checked-in IDL JSON to correspond to **`NEXT_PUBLIC_PMAMM_PROGRAM_ID`**.

### If using Matt’s public deployment instead

You must ship the IDL Matt generated against that bytecode (typically from their repo/tag that matches deploy). Anchor error **102 InstructionDidNotDeserialize** usually means **IDL ⇄ bytecode mismatch.**

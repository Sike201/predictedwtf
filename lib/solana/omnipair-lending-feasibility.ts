/**
 * ## Omnipair native lending vs “borrow devnet USDC against YES/NO” — feasibility (Outcome B)
 *
 * **Verdict: not possible with the deployed Omnipair program while the market pair is YES+NO only.**
 * Do not add Supabase loans or mocked borrow flows — this file is the canonical explanation.
 *
 * ---
 *
 * ### 1) Audited instruction names (Anchor `#[program] mod omnipair`)
 * Source: `programs/omnipair/src/lib.rs` on `main` of https://github.com/omnipair/omnipair-rs
 *
 * | Exported instruction | Args struct | Role |
 * | --- | --- | --- |
 * | `add_collateral` | `AdjustCollateralArgs { amount: u64 }` | Deposit YES or NO into pair collateral vaults |
 * | `remove_collateral` | `AdjustCollateralArgs { amount: u64 }` | Withdraw collateral |
 * | `borrow` | `AdjustDebtArgs { amount: u64 }` | Borrow from **AMM reserve vault** |
 * | `repay` | `AdjustDebtArgs { amount: u64 }` | Repay debt |
 * | `liquidate` | _(none)_ | Liquidate undercollateralized position |
 *
 * Supporting modules:
 * - `programs/omnipair/src/instructions/lending/add_collateral.rs` — `AddCollateral` accounts + `handle_add_collateral`
 * - `programs/omnipair/src/instructions/lending/remove_collateral.rs`
 * - `programs/omnipair/src/instructions/lending/borrow.rs` — `CommonAdjustDebt::handle_borrow`
 * - `programs/omnipair/src/instructions/lending/repay.rs`
 * - `programs/omnipair/src/instructions/lending/common.rs` — shared account constraints
 *
 * User position PDA seeds (Rust): `[POSITION_SEED_PREFIX, pair.key(), user.key()]`
 * with `POSITION_SEED_PREFIX = b"gamm_position"` (`programs/omnipair/src/constants.rs`).
 *
 * ---
 *
 * ### 2) Hard protocol constraint (why devnet USDC debt is impossible on a YES/NO market)
 * In `instructions/lending/common.rs`, **`CommonAdjustDebt`** (used by both `borrow` and `repay`) declares:
 *
 * ```rust,ignore
 * #[account(
 *     constraint = reserve_token_mint.key() == pair.token0 || reserve_token_mint.key() == pair.token1
 * )]
 * pub reserve_token_mint: ...
 * ```
 *
 * **`borrow` / `repay` may only target the pair’s two mints (`token0` / `token1`).**
 * Liquidity is taken from / returned to the **reserve vaults** for those mints (`reserve_vault` PDA).
 *
 * **`CommonAdjustCollateral`** likewise requires:
 * ```rust,ignore
 * constraint = collateral_token_mint.key() == pair.token0 || collateral_token_mint.key() == pair.token1
 * ```
 *
 * Our prediction markets use a **binary Outcome pair** whose `token0` / `token1` are the **YES and NO outcome mints**.
 * Devnet USDC (`Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr`) is **not** `pair.token0` or `pair.token1`, and there is **no**
 * USDC reserve vault registered on that pair. Therefore:
 * - You **cannot** `borrow` USDC through Omnipair on that pair.
 * - You **cannot** `repay` USDC debt through Omnipair on that pair.
 *
 * Native Omnipair lending, *as deployed*, only supports:
 * - Collateral in **token0 and/or token1** (here: YES / NO outcome tokens).
 * - Debt in **token0 and/or token1** (borrow the opposite outcome from AMM reserves), not a third stable mint.
 *
 * `borrow.rs` explicitly documents: tokens are transferred from the AMM liquidity vault for `vault_token_mint`
 * where that mint is **`pair.token0` or `pair.token1`**.
 *
 * ---
 *
 * ### 3) What would be required for USDC borrow (protocol-level, not app-level)
 * A *different* Omnipair **pair** whose two mints include USDC as `token0` or `token1` (with the other leg being an
 * asset the protocol lists), **plus** that pair initialized with USDC reserve & collateral vaults and liquidity —
 * essentially a **USDC⇄X pool**, not the current YES⇄NO outcome pool. That is a **new market / new pool config**,
 * not a client-side workaround.
 *
 * ---
 *
 * ### 4) This repo’s position
 * - **USDC as borrow asset** is not supported on YES/NO pairs (see §2–3). Do not construct `borrow`/`repay` with a
 *   non-pool mint.
 * - **Outcome-token leverage** (collateral YES → borrow NO → swap, etc.) uses the native instructions in
 *   `omnipair-lending-instructions.ts`, `omnipair-leverage-yes.ts`, `omnipair-leverage-no.ts`,
 *   `omnipair-close-leverage.ts`, and on-chain `read-omnipair-position.ts`.
 *
 * @module omnipair-lending-feasibility
 */

/** Single-line summary for UI / errors */
export const OMNIPAIR_USDC_BORROW_UNSUPPORTED =
  "Omnipair borrow/repay only supports the pair’s two mints (YES/NO). Devnet USDC is not a pool leg — native USDC borrow against this YES/NO market is impossible without a new USDC-inclusive pair.";

export class OmnipairUsdcBorrowUnsupportedError extends Error {
  constructor(message: string = OMNIPAIR_USDC_BORROW_UNSUPPORTED) {
    super(message);
    this.name = "OmnipairUsdcBorrowUnsupportedError";
  }
}

export function assertOmnipairUsdcBorrowSupported(): never {
  throw new OmnipairUsdcBorrowUnsupportedError();
}

/**
 * GAMM (Omnipair) engine — delegates to existing `lib/solana/*` implementations.
 * The unified adapter surface lives here for symmetry with `pmamm.ts`.
 */
export { initializeOmnipairMarket } from "@/lib/solana/init-omnipair-market";
export { executeOmnipairOutcomeTrade } from "@/lib/solana/trade-outcome";
export { buildProvideLiquidityWithUsdcTransactionEngineSigned } from "@/lib/solana/provide-liquidity-usdc";
export { buildWithdrawOmnipairLiquidityTransaction } from "@/lib/solana/withdraw-omnipair-liquidity";
/** DB-only today; on-chain resolve is not wired for Omnipair in this app. */
export type { EngineTxResult } from "./types";

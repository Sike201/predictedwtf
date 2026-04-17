/**
 * Compatibility alias — pool init lives in `init-omnipair-market.ts`.
 */
export type {
  InitOmnipairMarketParams,
  InitOmnipairMarketResult,
} from "@/lib/solana/init-omnipair-market";
export {
  deriveOmnipairMarketAccounts,
  initializeOmnipairMarket,
} from "@/lib/solana/init-omnipair-market";

/**
 * pm-AMM engine adapter (Anchor `Program#methods` + checked-in `lib/engines/idl/pm_amm.json`).
 * Builds transactions for create / trade / LP / resolve / claim flows.
 */
export {
  pmammBuildInitializeMarketTransaction,
  pmammBuildDepositLiquidityEngineTransaction,
  pmammBuildDepositLiquidityUserTransaction,
  pmammBuildBuyWithUsdcTransaction,
  pmammBuildSellOutcomeTransaction,
  pmammBuildWithdrawLiquidityTransaction,
  pmammBuildResolveMarketTransaction,
  pmammBuildClaimWinningsTransaction,
  readPmammMarketPoolSnapshot,
  createPmammProgram,
  pmammExplorerUrl,
} from "@/lib/solana/pmamm-program";
export { validatePmammCollateralMint } from "@/lib/solana/pmamm-validate-collateral";
export { pmammMarketIdBnFromSeed } from "@/lib/solana/pmamm-market-id";
export {
  derivePmammMarketPdas,
  derivePmammLpPda,
  pmammMetadataPda,
} from "@/lib/solana/pmamm-pda";
export {
  getPmammMarketAddressFromRow,
  getPmammMarketAddress,
  resolvePmammMarketPdaForChainTx,
} from "@/lib/solana/pmamm-market-address-from-row";
export type {
  PmammMarketAddressRow,
  GetPmammMarketAddressOk,
} from "@/lib/solana/pmamm-market-address-from-row";
export { PMAMM_CONFIG, requirePmammProgramId, getPmammCollateralMint } from "@/lib/solana/pmamm-config";
export type { EngineTxResult } from "./types";

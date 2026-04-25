/**
 * pm-AMM engine adapter ([Mattdgn/pm-amm](https://github.com/Mattdgn/pm-amm)).
 * Builds Anchor transactions for create / trade / LP / resolve / claim flows.
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
export { PMAMM_CONFIG, requirePmammProgramId, getPmammCollateralMint } from "@/lib/solana/pmamm-config";
export type { EngineTxResult } from "./types";

import { PublicKey } from "@solana/web3.js";

import { LEGACY_DEVNET_USDC_COLLATERAL_MINT } from "@/lib/config/spark-usd";

/**
 * Legacy devnet USDC mint pubkey (historical GAMM/pmAMM collateral).
 * Prefer {@link getSparkUsdMint} from `@/lib/config/spark-usd` for platform collateral.
 */
export const LEGACY_DEVNET_USDC_MINT = new PublicKey(
  LEGACY_DEVNET_USDC_COLLATERAL_MINT,
);

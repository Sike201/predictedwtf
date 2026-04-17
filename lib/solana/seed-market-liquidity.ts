import type { Connection, Keypair, PublicKey } from "@solana/web3.js";

import type { InitOmnipairMarketResult } from "@/lib/solana/init-omnipair-market";

/** Initial depth per side (same YES / NO atoms), used in Omnipair `initialize` bootstrap args (tx3). */
export const DEMO_LIQUIDITY_ATOMICS = 100_000_000_000n;

export type SeedLiquidityParams = {
  connection: Connection;
  authority: Keypair;
  init: InitOmnipairMarketResult;
  authorityYesAta: PublicKey;
  authorityNoAta: PublicKey;
};

export type SeedLiquidityResult = {
  /** Same as `init.initializeSignature` — Omnipair init (tx3) already ran; used for bookkeeping. */
  signature: string;
  prepMintSignatures: string[];
};

/**
 * Omnipair runs initial **curve** liquidity inside `initialize` (tx3; `InitializeAndBootstrapArgs`).
 * **Bootstrap mints** (funding engine ATAs) are tx2 inside `initializeOmnipairMarket`.
 * This hook stays for logging / future post-deposit instructions without changing the create-market UX.
 */
export async function seedMarketLiquidity(
  params: SeedLiquidityParams,
): Promise<SeedLiquidityResult> {
  const { init } = params;
  const prepMintSignatures = [
    init.preInitializeSignature,
    init.bootstrapLiquiditySignature,
  ];
  /** Same atoms minted to each authority ATA before `initialize` pulls into reserve vaults (see `initializeOmnipairMarket`). */
  const perSideAtoms = DEMO_LIQUIDITY_ATOMICS.toString();
  console.info(
    "[predicted][liquidity-seed] exact seeded bootstrap (pre-pool-deposit amounts)",
    JSON.stringify({
      yesMint: init.yesMint.toBase58(),
      noMint: init.noMint.toBase58(),
      token0Mint: init.token0Mint.toBase58(),
      token1Mint: init.token1Mint.toBase58(),
      /** Raw atoms transferred from engine ATAs into curve during Initialize — same numeric value per side at 9dp */
      yesAmountAtomsBootstrap: perSideAtoms,
      noAmountAtomsBootstrap: perSideAtoms,
      vaultA_reserveToken0: init.vaultA.toBase58(),
      vaultB_reserveToken1: init.vaultB.toBase58(),
      tx1_preInitialize: init.preInitializeSignature,
      tx2_bootstrapMintToAuthorityAtas: init.bootstrapLiquiditySignature,
      tx3_initializeAndBootstrap: init.initializeSignature,
    }),
  );
  console.info(
    "[predicted][liquidity-seed] Omnipair tx1 (pre-init):",
    init.preInitializeSignature,
  );
  console.info(
    "[predicted][liquidity-seed] Omnipair tx2 (bootstrap mint YES/NO to authority ATAs):",
    init.bootstrapLiquiditySignature,
  );
  console.info(
    "[predicted][liquidity-seed] Omnipair tx3 (Initialize + bootstrap):",
    init.initializeSignature,
  );
  console.info(
    "[predicted][liquidity-seed] no extra SPL instructions — pool bootstrap from Omnipair initialize ix",
  );
  return {
    signature: init.initializeSignature,
    prepMintSignatures,
  };
}

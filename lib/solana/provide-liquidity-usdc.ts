/**
 * USDC-denominated **provide liquidity** on a YES/NO Omnipair pool.
 * Composes: engine-signed mint (equal YES+NO from USDC) + `add_liquidity` in one tx
 * (same full-set path as `buy-outcome-with-usdc.ts`, without a directional swap).
 */
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";

import { DEVNET_USDC_MINT } from "@/lib/solana/assets";
import { decodeOmnipairPairAccount } from "@/lib/solana/decode-omnipair-accounts";
import {
  buildMintPositionsInstructions,
  getMintPositionsCustodyOwnerFromEnv,
} from "@/lib/solana/mint-market-positions";
import {
  applyAddLiquiditySlippageFloor,
  estimateLiquidityOutFromAdd,
} from "@/lib/solana/omnipair-liquidity-math";
import { buildOmnipairAddLiquidityInstruction } from "@/lib/solana/omnipair-liquidity-instructions";
import { DEFAULT_OMNIPAIR_POOL_PARAMS } from "@/lib/solana/omnipair-params-hash";
import { deriveOmnipairLayout } from "@/lib/solana/omnipair-pda";
import { requireOmnipairProgramId } from "@/lib/solana/omnipair-program";

export type PoolStateSnapshot = {
  pair: string;
  reserve0: string;
  reserve1: string;
  totalLpSupply: string;
  swapFeeBps: number;
};

export type ProvideLiquidityWithUsdcBuildLog = {
  lastValidBlockHeight: number;
  recentBlockhash: string;
  user: string;
  marketSlug?: string;
  yesMint: string;
  noMint: string;
  pairAddress: string;
  usdcAmountAtoms: string;
  amount0In: string;
  amount1In: string;
  minLiquidityOut: string;
  estimatedLiquidityOut: string;
  poolStateBefore: PoolStateSnapshot;
};

function logProvide(tag: string, payload: Record<string, unknown>) {
  console.info(`[predicted][lp-usdc] ${tag}`, JSON.stringify(payload));
}

export async function buildProvideLiquidityWithUsdcTransactionEngineSigned(params: {
  connection: Connection;
  engine: Keypair;
  user: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
  pairAddress: PublicKey;
  usdcAmountAtoms: bigint;
  marketSlug?: string;
  slippageBps?: number;
}): Promise<{
  serialized: Uint8Array;
  log: ProvideLiquidityWithUsdcBuildLog;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}> {
  const slippageBps = params.slippageBps ?? 100;
  const programId = requireOmnipairProgramId();
  const layout = deriveOmnipairLayout(
    programId,
    params.yesMint,
    params.noMint,
    DEFAULT_OMNIPAIR_POOL_PARAMS,
  );
  if (!layout.pairAddress.equals(params.pairAddress)) {
    throw new Error(
      "pool_address does not match derived Omnipair pair for these mints.",
    );
  }

  const custodyOwner =
    getMintPositionsCustodyOwnerFromEnv() ?? params.engine.publicKey;
  const mintAuthority = params.engine.publicKey;

  const mintPart = await buildMintPositionsInstructions({
    connection: params.connection,
    user: params.user,
    mintAuthority,
    custodyOwner,
    yesMint: params.yesMint,
    noMint: params.noMint,
    usdcMint: DEVNET_USDC_MINT,
    usdcAmountAtoms: params.usdcAmountAtoms,
  });

  const { outcomeMintAtoms, userYesAta, userNoAta } = mintPart;

  const pairInfo = await params.connection.getAccountInfo(
    params.pairAddress,
    "confirmed",
  );
  if (!pairInfo?.data) throw new Error("Omnipair pair account missing");
  const pairDecoded = decodeOmnipairPairAccount(pairInfo.data);

  const t0 = layout.token0Mint;
  const t1 = layout.token1Mint;
  const userT0 = t0.equals(params.yesMint) ? userYesAta : userNoAta;
  const userT1 = t1.equals(params.yesMint) ? userYesAta : userNoAta;
  const amount0In = outcomeMintAtoms;
  const amount1In = outcomeMintAtoms;

  const lpMintInfo = await getMint(params.connection, pairDecoded.lpMint);
  const totalLpSupply = lpMintInfo.supply;
  if (totalLpSupply === 0n) {
    throw new Error("LP mint supply is zero — pool may not be initialized.");
  }

  const estimatedLiq = estimateLiquidityOutFromAdd({
    reserve0: pairDecoded.reserve0,
    reserve1: pairDecoded.reserve1,
    totalSupplyLp: totalLpSupply,
    amount0In,
    amount1In,
  });
  if (estimatedLiq <= 0n) {
    throw new Error(
      "Estimated LP minted is zero — check pool reserves and amount.",
    );
  }
  const minLiquidityOut = applyAddLiquiditySlippageFloor(estimatedLiq, slippageBps);
  if (minLiquidityOut <= 0n) {
    throw new Error("min_liquidity_out under slippage is zero; increase amount.");
  }

  const userLp = getAssociatedTokenAddressSync(
    pairDecoded.lpMint,
    params.user,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const poolStateBefore: PoolStateSnapshot = {
    pair: params.pairAddress.toBase58(),
    reserve0: pairDecoded.reserve0.toString(),
    reserve1: pairDecoded.reserve1.toString(),
    totalLpSupply: totalLpSupply.toString(),
    swapFeeBps: pairDecoded.swapFeeBps,
  };

  const addIx = buildOmnipairAddLiquidityInstruction({
    programId,
    pair: params.pairAddress,
    rateModel: pairDecoded.rateModel,
    token0Mint: t0,
    token1Mint: t1,
    userToken0: userT0,
    userToken1: userT1,
    userLp,
    lpMint: pairDecoded.lpMint,
    user: params.user,
    amount0In,
    amount1In,
    minLiquidityOut,
  });

  const tx = new Transaction();
  const microLamports = Math.floor(Math.random() * 900_000) + 1;
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports }));
  tx.add(...mintPart.instructions, addIx);
  tx.feePayer = params.user;
  const { blockhash, lastValidBlockHeight } =
    await params.connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.partialSign(params.engine);

  const log: ProvideLiquidityWithUsdcBuildLog = {
    lastValidBlockHeight,
    recentBlockhash: blockhash,
    user: params.user.toBase58(),
    marketSlug: params.marketSlug,
    yesMint: params.yesMint.toBase58(),
    noMint: params.noMint.toBase58(),
    pairAddress: params.pairAddress.toBase58(),
    usdcAmountAtoms: params.usdcAmountAtoms.toString(),
    amount0In: amount0In.toString(),
    amount1In: amount1In.toString(),
    minLiquidityOut: minLiquidityOut.toString(),
    estimatedLiquidityOut: estimatedLiq.toString(),
    poolStateBefore,
  };

  logProvide("built", {
    ...log,
    slippageBps,
    computeBudgetMicroLamports: microLamports,
  });

  return {
    serialized: tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }),
    log,
    recentBlockhash: blockhash,
    lastValidBlockHeight,
  };
}

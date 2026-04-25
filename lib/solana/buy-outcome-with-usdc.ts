/**
 * USDC-native **Buy YES** / **Buy NO** on a YES/NO Omnipair pool.
 *
 * **There is still no direct USDC→YES pool leg.** This module composes:
 * 1. Take devnet USDC from the user into MVP custody (market engine or `MINT_POSITIONS_CUSTODY_PUBKEY`).
 * 2. Engine mints **equal** YES and NO to the user.
 * 3. **Buy YES:** swap NO → YES on Omnipair using the freshly minted NO (full amount) to add YES exposure.
 * 4. **Buy NO:** swap YES → NO using the freshly minted YES (full amount) to add NO exposure.
 *
 * A single atomic transaction (engine `partialSign` on mint leg + user signs all).
 *
 * Direct single-hop USDC→YES without this composition would require an external route (e.g. Jupiter)
 * or a pool seeded with USDC as an asset.
 *
 * **Pool reserves:** The Omnipair `swap` instruction always executes against on-curve reserves (vault
 * balances). Minting alone does not move the AMM; **every buy swaps the full minted unwanted leg through
 * the pool**, so `reserve0`/`reserve1` (and implied mid price) change after each successful buy tx.
 */
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";

import { deriveMarketProbabilityFromPoolState } from "@/lib/market/derive-market-probability";
import { DEVNET_USDC_MINT } from "@/lib/solana/assets";
import {
  decodeFutarchySwapShareBps,
  decodeOmnipairPairAccount,
} from "@/lib/solana/decode-omnipair-accounts";
import {
  buildMintPositionsInstructions,
  getMintPositionsCustodyOwnerFromEnv,
  usdcBaseUnitsToOutcomeBaseUnits,
} from "@/lib/solana/mint-market-positions";
import {
  applySlippageFloor,
  estimateOmnipairSwapAmountOut,
} from "@/lib/solana/omnipair-swap-math";
import { buildOmnipairSwapInstruction } from "@/lib/solana/omnipair-swap-instruction";
import { DEFAULT_OMNIPAIR_POOL_PARAMS } from "@/lib/solana/omnipair-params-hash";
import { deriveOmnipairLayout, getGlobalFutarchyAuthorityPDA } from "@/lib/solana/omnipair-pda";
import { requireOmnipairProgramId } from "@/lib/solana/omnipair-program";
import { readPmammMarketPoolSnapshot } from "@/lib/solana/pmamm-program";

export type BuyOutcomeSide = "yes" | "no";

export type BuyOutcomeWithUsdcBuildLog = {
  /** From the same RPC call that set `recentBlockhash` on the transaction. */
  lastValidBlockHeight: number;
  recentBlockhash: string;
  user: string;
  marketSlug?: string;
  side: BuyOutcomeSide;
  yesMint: string;
  noMint: string;
  pairAddress: string;
  /** 6-decimal USDC atoms */
  usdcAmountAtoms: string;
  /** 9-decimal atoms minted to each outcome ATA before swap */
  outcomeMintAtomsYes: string;
  outcomeMintAtomsNo: string;
  swapTokenInMint: string;
  swapTokenOutMint: string;
  /** Input to Omnipair `swap` (equals mint size on the unwanted leg) */
  swapAmountIn: string;
  estimatedSwapAmountOut: string;
  minSwapAmountOut: string;
  /** ~ atoms on chosen outcome: minted on that side + swap out (curve net of fees). */
  estimatedFinalChosenSideAtoms: string;
};

export type BuyOutcomeExposureEstimate = {
  side: BuyOutcomeSide;
  usdcAmountAtoms: string;
  outcomeMintAtoms: string;
  estimatedSwapAmountOut: string;
  minSwapAmountOut: string;
  estimatedFinalChosenSideAtoms: string;
};

function logBuyOutcome(tag: string, payload: Record<string, unknown>) {
  console.info(`[predicted][buy-outcome-usdc] ${tag}`, JSON.stringify(payload));
}

export async function buildBuyOutcomeWithUsdcTransactionEngineSigned(params: {
  connection: Connection;
  engine: Keypair;
  user: PublicKey;
  side: BuyOutcomeSide;
  yesMint: PublicKey;
  noMint: PublicKey;
  pairAddress: PublicKey;
  usdcAmountAtoms: bigint;
  marketSlug?: string;
  slippageBps?: number;
}): Promise<{
  serialized: Uint8Array;
  log: BuyOutcomeWithUsdcBuildLog;
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

  const pairInfo = await params.connection.getAccountInfo(params.pairAddress, "confirmed");
  if (!pairInfo?.data) throw new Error("Omnipair pair account missing");
  const pairDecoded = decodeOmnipairPairAccount(pairInfo.data);

  const [futarchyPk] = getGlobalFutarchyAuthorityPDA(programId);
  const futarchyInfo = await params.connection.getAccountInfo(futarchyPk, "confirmed");
  if (!futarchyInfo?.data) throw new Error("Futarchy authority account missing");
  const futarchySwapShareBps = decodeFutarchySwapShareBps(futarchyInfo.data);

  const tokenInMint = params.side === "yes" ? params.noMint : params.yesMint;
  const tokenOutMint = params.side === "yes" ? params.yesMint : params.noMint;
  const userTokenIn = params.side === "yes" ? userNoAta : userYesAta;
  const userTokenOut = params.side === "yes" ? userYesAta : userNoAta;

  const isToken0In = tokenInMint.equals(pairDecoded.token0);

  const estimatedSwapAmountOut = estimateOmnipairSwapAmountOut({
    pair: pairDecoded,
    futarchySwapShareBps,
    amountIn: outcomeMintAtoms,
    isToken0In,
  });

  const minSwapAmountOut = applySlippageFloor(estimatedSwapAmountOut, slippageBps);

  const swapIx = buildOmnipairSwapInstruction({
    programId,
    pair: params.pairAddress,
    rateModel: pairDecoded.rateModel,
    tokenInMint,
    tokenOutMint,
    user: params.user,
    userTokenIn,
    userTokenOut,
    amountIn: outcomeMintAtoms,
    minAmountOut: minSwapAmountOut,
  });

  const tx = new Transaction();
  /** Unique per build so two requests in the same slot do not serialize to identical bytes. */
  const microLamports = Math.floor(Math.random() * 900_000) + 1;
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports }));
  tx.add(...mintPart.instructions, swapIx);
  tx.feePayer = params.user;
  const { blockhash, lastValidBlockHeight } =
    await params.connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.partialSign(params.engine);

  const estimatedFinalChosenSideAtoms = (
    outcomeMintAtoms + estimatedSwapAmountOut
  ).toString();

  const log: BuyOutcomeWithUsdcBuildLog = {
    lastValidBlockHeight,
    recentBlockhash: blockhash,
    user: params.user.toBase58(),
    marketSlug: params.marketSlug,
    side: params.side,
    yesMint: params.yesMint.toBase58(),
    noMint: params.noMint.toBase58(),
    pairAddress: params.pairAddress.toBase58(),
    usdcAmountAtoms: params.usdcAmountAtoms.toString(),
    outcomeMintAtomsYes: outcomeMintAtoms.toString(),
    outcomeMintAtomsNo: outcomeMintAtoms.toString(),
    swapTokenInMint: tokenInMint.toBase58(),
    swapTokenOutMint: tokenOutMint.toBase58(),
    swapAmountIn: outcomeMintAtoms.toString(),
    estimatedSwapAmountOut: estimatedSwapAmountOut.toString(),
    minSwapAmountOut: minSwapAmountOut.toString(),
    estimatedFinalChosenSideAtoms,
  };

  logBuyOutcome("built", {
    ...log,
    computeBudgetMicroLamports: microLamports,
    buyYesNote:
      params.side === "yes"
        ? "mint paired then NO→YES swap using full NO minted"
        : "mint paired then YES→NO swap using full YES minted",
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

/**
 * Preview only (no tx build/sign): estimate final chosen-side exposure for USDC buy route.
 * Uses the same mint sizing + Omnipair swap math as execution.
 */
export async function estimateBuyOutcomeFinalExposure(params: {
  connection: Connection;
  side: BuyOutcomeSide;
  yesMint: PublicKey;
  noMint: PublicKey;
  pairAddress: PublicKey;
  usdcAmountAtoms: bigint;
  slippageBps?: number;
}): Promise<BuyOutcomeExposureEstimate> {
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

  const outcomeMintAtoms = usdcBaseUnitsToOutcomeBaseUnits(params.usdcAmountAtoms);
  if (outcomeMintAtoms <= 0n) {
    throw new Error("Outcome mint amount rounded to zero.");
  }

  const pairInfo = await params.connection.getAccountInfo(params.pairAddress, "confirmed");
  if (!pairInfo?.data) throw new Error("Omnipair pair account missing");
  const pairDecoded = decodeOmnipairPairAccount(pairInfo.data);

  const [futarchyPk] = getGlobalFutarchyAuthorityPDA(programId);
  const futarchyInfo = await params.connection.getAccountInfo(futarchyPk, "confirmed");
  if (!futarchyInfo?.data) throw new Error("Futarchy authority account missing");
  const futarchySwapShareBps = decodeFutarchySwapShareBps(futarchyInfo.data);

  const tokenInMint = params.side === "yes" ? params.noMint : params.yesMint;
  const isToken0In = tokenInMint.equals(pairDecoded.token0);
  const estimatedSwapAmountOut = estimateOmnipairSwapAmountOut({
    pair: pairDecoded,
    futarchySwapShareBps,
    amountIn: outcomeMintAtoms,
    isToken0In,
  });
  const minSwapAmountOut = applySlippageFloor(estimatedSwapAmountOut, slippageBps);
  const estimatedFinalChosenSideAtoms = outcomeMintAtoms + estimatedSwapAmountOut;

  return {
    side: params.side,
    usdcAmountAtoms: params.usdcAmountAtoms.toString(),
    outcomeMintAtoms: outcomeMintAtoms.toString(),
    estimatedSwapAmountOut: estimatedSwapAmountOut.toString(),
    minSwapAmountOut: minSwapAmountOut.toString(),
    estimatedFinalChosenSideAtoms: estimatedFinalChosenSideAtoms.toString(),
  };
}

/**
 * PM_AMM buy preview: spot-implied probability from on-chain reserves (same mid as the chart).
 * Coarser than the program’s exact swap; avoids Omnipair-only account layout.
 */
export async function estimateBuyOutcomeFinalExposurePmamm(params: {
  connection: Connection;
  side: BuyOutcomeSide;
  marketPda: PublicKey;
  usdcAmountAtoms: bigint;
  slippageBps?: number;
}): Promise<BuyOutcomeExposureEstimate> {
  const slippageBps = params.slippageBps ?? 100;
  const pm = await readPmammMarketPoolSnapshot(
    params.connection,
    params.marketPda,
  );
  const spot = deriveMarketProbabilityFromPoolState({
    reserveYes: pm.reserveYes,
    reserveNo: pm.reserveNo,
  });
  if (!spot) {
    throw new Error("PM_AMM market state unavailable.");
  }
  const p =
    params.side === "yes" ? spot.yesProbability : spot.noProbability;
  if (!(p > 0) || !Number.isFinite(p)) {
    throw new Error("PM_AMM market state unavailable.");
  }
  const estFloat = Number(params.usdcAmountAtoms) / p;
  if (!Number.isFinite(estFloat) || estFloat <= 0) {
    throw new Error("Estimate rounded to zero.");
  }
  let estimatedFinal = BigInt(Math.floor(estFloat));
  if (estimatedFinal <= 0n) estimatedFinal = 1n;
  const minOut = applySlippageFloor(estimatedFinal, slippageBps);
  return {
    side: params.side,
    usdcAmountAtoms: params.usdcAmountAtoms.toString(),
    outcomeMintAtoms: "0",
    estimatedSwapAmountOut: estimatedFinal.toString(),
    minSwapAmountOut: minOut.toString(),
    estimatedFinalChosenSideAtoms: estimatedFinal.toString(),
  };
}

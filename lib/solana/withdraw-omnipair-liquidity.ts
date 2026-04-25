/**
 * `remove_liquidity` for users with LP shares — no engine signature (outcome-only pool legs).
 */
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";

import {
  decodeOmnipairPairAccount,
  type DecodedOmnipairPair,
} from "@/lib/solana/decode-omnipair-accounts";
import { estimateRemoveMinOuts } from "@/lib/solana/omnipair-liquidity-math";
import { buildOmnipairRemoveLiquidityInstruction } from "@/lib/solana/omnipair-liquidity-instructions";
import { DEFAULT_OMNIPAIR_POOL_PARAMS } from "@/lib/solana/omnipair-params-hash";
import { deriveOmnipairLayout } from "@/lib/solana/omnipair-pda";
import { requireOmnipairProgramId } from "@/lib/solana/omnipair-program";

export type WithdrawOmnipairLiquidityBuildLog = {
  user: string;
  pairAddress: string;
  liquidityIn: string;
  minAmount0Out: string;
  minAmount1Out: string;
  poolStateBefore: {
    reserve0: string;
    reserve1: string;
    totalLpSupply: string;
  };
};

/**
 * Shared `remove_liquidity` ix + pool snapshot (raw YES/NO withdraw or USDC follow-up).
 * `liquidityIn` = LP base units to burn. Must be ≤ user LP balance.
 */
export async function buildOmnipairRemoveLiquidityIxForUser(params: {
  connection: Connection;
  user: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
  pairAddress: PublicKey;
  liquidityIn: bigint;
  slippageBps?: number;
}): Promise<{
  instruction: TransactionInstruction;
  pairDecoded: DecodedOmnipairPair;
  minAmount0Out: bigint;
  minAmount1Out: bigint;
  totalLpSupply: bigint;
  token0Mint: PublicKey;
  token1Mint: PublicKey;
}> {
  const slippageBps = params.slippageBps ?? 100;
  if (params.liquidityIn <= 0n) {
    throw new Error("Enter a liquidity (LP) amount greater than zero.");
  }

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

  const pairInfo = await params.connection.getAccountInfo(
    params.pairAddress,
    "confirmed",
  );
  if (!pairInfo?.data) throw new Error("Omnipair pair account missing");
  const pairDecoded = decodeOmnipairPairAccount(pairInfo.data);

  const t0 = layout.token0Mint;
  const t1 = layout.token1Mint;
  const userT0 = getAssociatedTokenAddressSync(
    t0,
    params.user,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const userT1 = getAssociatedTokenAddressSync(
    t1,
    params.user,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const userLp = getAssociatedTokenAddressSync(
    pairDecoded.lpMint,
    params.user,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const lpAcc = await getAccount(
    params.connection,
    userLp,
    "confirmed",
    TOKEN_PROGRAM_ID,
  );
  if (lpAcc.amount < params.liquidityIn) {
    throw new Error("Insufficient LP balance for this withdraw amount.");
  }

  const lpMintInfo = await getMint(params.connection, pairDecoded.lpMint);
  const totalSupply = lpMintInfo.supply;
  if (totalSupply === 0n) {
    throw new Error("LP total supply is zero.");
  }

  const { min0, min1 } = estimateRemoveMinOuts({
    reserve0: pairDecoded.reserve0,
    reserve1: pairDecoded.reserve1,
    totalSupplyLp: totalSupply,
    liquidityIn: params.liquidityIn,
    slippageBps,
  });

  const removeIx = buildOmnipairRemoveLiquidityInstruction({
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
    liquidityIn: params.liquidityIn,
    minAmount0Out: min0,
    minAmount1Out: min1,
  });

  return {
    instruction: removeIx,
    pairDecoded,
    minAmount0Out: min0,
    minAmount1Out: min1,
    totalLpSupply: totalSupply,
    token0Mint: t0,
    token1Mint: t1,
  };
}

/**
 * `liquidityIn` = LP base units to burn. Must be ≤ user LP balance.
 */
export async function buildWithdrawOmnipairLiquidityTransaction(params: {
  connection: Connection;
  user: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
  pairAddress: PublicKey;
  /** LP base units to remove */
  liquidityIn: bigint;
  slippageBps?: number;
}): Promise<{
  transaction: Transaction;
  log: WithdrawOmnipairLiquidityBuildLog;
}> {
  const slippageBps = params.slippageBps ?? 100;
  const {
    instruction: removeIx,
    pairDecoded,
    minAmount0Out: min0,
    minAmount1Out: min1,
    totalLpSupply: totalSupply,
  } = await buildOmnipairRemoveLiquidityIxForUser(params);

  const tx = new Transaction();
  const microLamports = Math.floor(Math.random() * 900_000) + 1;
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports }));
  tx.add(removeIx);
  tx.feePayer = params.user;
  const { blockhash, lastValidBlockHeight } =
    await params.connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;

  const log: WithdrawOmnipairLiquidityBuildLog = {
    user: params.user.toBase58(),
    pairAddress: params.pairAddress.toBase58(),
    liquidityIn: params.liquidityIn.toString(),
    minAmount0Out: min0.toString(),
    minAmount1Out: min1.toString(),
    poolStateBefore: {
      reserve0: pairDecoded.reserve0.toString(),
      reserve1: pairDecoded.reserve1.toString(),
      totalLpSupply: totalSupply.toString(),
    },
  };

  if (process.env.NODE_ENV === "development") {
    console.info(
      "[predicted][lp-withdraw] built",
      JSON.stringify({ ...log, slippageBps, microLamports }),
    );
  }

  return { transaction: tx, log };
}

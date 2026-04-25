/**
 * LP withdraw with automatic full-set redemption to devnet USDC (engine-signed custody transfer).
 * Flow: remove_liquidity → [rebalance swap] → burn YES+NO → USDC to user wallet.
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
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";

import type { DecodedOmnipairPair } from "@/lib/solana/decode-omnipair-accounts";
import {
  applyLiquidityWithdrawalFee,
  estimateRemoveLiquidityGrossOut,
} from "@/lib/solana/omnipair-liquidity-math";
import {
  buildSellOutcomePairedRedeemInstructionsFromSnapshot,
  fetchRedemptionMintDecimals,
  planSellOutcomePairedRedeemFromSnapshot,
  type SellOutcomeForUsdcBuildLog,
  type SellOutcomePlan,
} from "@/lib/solana/sell-outcome-for-usdc";
import { DEVNET_USDC_MINT } from "@/lib/solana/assets";
import {
  floorOutcomeToUsdcRedemptionGrid,
  getMintPositionsCustodyOwnerFromEnv,
  maxPairedBurnOutcomeAtomsForCustodyUsdc,
  pairedOutcomeAtomsToUsdcAtomsDynamic,
} from "@/lib/solana/mint-market-positions";
import { loadMarketEngineAuthority } from "@/lib/solana/treasury";
import {
  buildOmnipairRemoveLiquidityIxForUser,
  type WithdrawOmnipairLiquidityBuildLog,
} from "@/lib/solana/withdraw-omnipair-liquidity";

/** Small buffer so redeem/swap legs stay below post-remove balances (rounding). */
const OUTCOME_WITHDRAW_PLAN_BUFFER_ATOMS = 2n;

export type WithdrawLpToUsdcBuildLog = {
  remove: WithdrawOmnipairLiquidityBuildLog;
  redeem: SellOutcomeForUsdcBuildLog;
};

/** Read user omLP ATA balance (0 if no account). */
export async function readUserOmnipairLpBalance(
  connection: Connection,
  user: PublicKey,
  lpMint: PublicKey,
): Promise<{ ata: PublicKey; amount: bigint }> {
  const ata = getAssociatedTokenAddressSync(
    lpMint,
    user,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  try {
    const a = await getAccount(connection, ata, "confirmed", TOKEN_PROGRAM_ID);
    return { ata, amount: a.amount };
  } catch {
    return { ata, amount: 0n };
  }
}

/**
 * Pool reserves after remove_liquidity when net `amount0/1` (post withdrawal fee) left the pool to the user.
 * Must match the same expected outs used to project YES/NO balances after remove.
 */
function pairAfterRemoveNetOut(
  pair: DecodedOmnipairPair,
  netAmount0Out: bigint,
  netAmount1Out: bigint,
): DecodedOmnipairPair {
  const r0 = pair.reserve0 - netAmount0Out;
  const r1 = pair.reserve1 - netAmount1Out;
  if (r0 < 0n || r1 < 0n) {
    throw new Error("Pool remove estimate produced negative reserves.");
  }
  return { ...pair, reserve0: r0, reserve1: r1 };
}

async function readOutcomeBal(
  connection: Connection,
  ata: PublicKey,
): Promise<bigint> {
  try {
    const a = await getAccount(connection, ata, "confirmed", TOKEN_PROGRAM_ID);
    return a.amount;
  } catch {
    return 0n;
  }
}

async function readCustodyUsdcAtoms(
  connection: Connection,
): Promise<{ custodyOwner: string; atoms: bigint }> {
  const custodyOwnerPk =
    getMintPositionsCustodyOwnerFromEnv() ??
    loadMarketEngineAuthority()?.publicKey;
  if (!custodyOwnerPk) {
    return { custodyOwner: "", atoms: 0n };
  }
  const ata = getAssociatedTokenAddressSync(
    DEVNET_USDC_MINT,
    custodyOwnerPk,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const atoms = await readOutcomeBal(connection, ata);
  return { custodyOwner: custodyOwnerPk.toBase58(), atoms };
}

function atomsToDecimalString(atoms: bigint, decimals: number, maxFrac: number): string {
  if (decimals <= 0) return atoms.toString();
  const neg = atoms < 0n;
  const a = neg ? -atoms : atoms;
  const base = 10n ** BigInt(decimals);
  const whole = a / base;
  let frac = (a % base).toString().padStart(decimals, "0").slice(0, maxFrac);
  frac = frac.replace(/0+$/, "");
  const sign = neg ? "-" : "";
  return frac.length ? `${sign}${whole}.${frac}` : `${sign}${whole}`;
}

type RemoveIxBundle = Awaited<
  ReturnType<typeof buildOmnipairRemoveLiquidityIxForUser>
>;

async function projectedBalancesAfterRemove(
  params: {
    connection: Connection;
    user: PublicKey;
    yesMint: PublicKey;
    noMint: PublicKey;
    pairAddress: PublicKey;
    liquidityIn: bigint;
    slippageBps: number;
  },
  removeBundle?: RemoveIxBundle,
): Promise<{
  removeBundle: RemoveIxBundle;
  pairDecoded: DecodedOmnipairPair;
  totalLpSupply: bigint;
  token0Mint: PublicKey;
  min0: bigint;
  min1: bigint;
  expected0: bigint;
  expected1: bigint;
  /** Min-out (fee + slippage) YES/NO credited from this remove — planning uses these. */
  yesFromRemoveWorst: bigint;
  noFromRemoveWorst: bigint;
  /** Expected YES/NO from remove after withdrawal fee (no ix slippage floor). */
  expectedYesFromRemove: bigint;
  expectedNoFromRemove: bigint;
  yesAfter: bigint;
  noAfter: bigint;
  pairForSwap: DecodedOmnipairPair;
  side: "yes" | "no";
  cap: bigint;
}> {
  const bundle =
    removeBundle ??
    (await buildOmnipairRemoveLiquidityIxForUser({
      connection: params.connection,
      user: params.user,
      yesMint: params.yesMint,
      noMint: params.noMint,
      pairAddress: params.pairAddress,
      liquidityIn: params.liquidityIn,
      slippageBps: params.slippageBps,
    }));

  const {
    pairDecoded,
    totalLpSupply,
    token0Mint,
    minAmount0Out: min0,
    minAmount1Out: min1,
  } = bundle;

  const g = estimateRemoveLiquidityGrossOut({
    reserve0: pairDecoded.reserve0,
    reserve1: pairDecoded.reserve1,
    totalSupplyLp: totalLpSupply,
    liquidityIn: params.liquidityIn,
  });
  const f0 = applyLiquidityWithdrawalFee(g.amount0);
  const f1 = applyLiquidityWithdrawalFee(g.amount1);
  const expected0 = f0.out;
  const expected1 = f1.out;

  const yesFromRemoveWorst = token0Mint.equals(params.yesMint) ? min0 : min1;
  const noFromRemoveWorst = token0Mint.equals(params.yesMint) ? min1 : min0;
  const expectedYesFromRemove = token0Mint.equals(params.yesMint)
    ? expected0
    : expected1;
  const expectedNoFromRemove = token0Mint.equals(params.yesMint)
    ? expected1
    : expected0;

  const pairForSwap = pairAfterRemoveNetOut(pairDecoded, min0, min1);

  const userYesAta = getAssociatedTokenAddressSync(
    params.yesMint,
    params.user,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const userNoAta = getAssociatedTokenAddressSync(
    params.noMint,
    params.user,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const userYesBal = await readOutcomeBal(params.connection, userYesAta);
  const userNoBal = await readOutcomeBal(params.connection, userNoAta);

  const yesAfter = userYesBal + yesFromRemoveWorst;
  const noAfter = userNoBal + noFromRemoveWorst;

  const side = yesAfter >= noAfter ? "yes" : "no";
  const cap = side === "yes" ? yesAfter : noAfter;

  return {
    removeBundle: bundle,
    pairDecoded,
    totalLpSupply,
    token0Mint,
    min0,
    min1,
    expected0,
    expected1,
    yesFromRemoveWorst,
    noFromRemoveWorst,
    expectedYesFromRemove,
    expectedNoFromRemove,
    yesAfter,
    noAfter,
    pairForSwap,
    side,
    cap,
  };
}

async function computeWithdrawToUsdcSellPlanningArgs(params: {
  connection: Connection;
  user: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
  pairAddress: PublicKey;
  liquidityIn: bigint;
  slippageBps: number;
  removeBundle?: RemoveIxBundle;
}): Promise<{
  rd: Awaited<ReturnType<typeof fetchRedemptionMintDecimals>>;
  proj: Awaited<ReturnType<typeof projectedBalancesAfterRemove>>;
  outcomeBalances: { yes: bigint; no: bigint };
  cap: bigint;
  side: "yes" | "no";
}> {
  const [rd, proj] = await Promise.all([
    fetchRedemptionMintDecimals(
      params.connection,
      params.yesMint,
      params.noMint,
    ),
    projectedBalancesAfterRemove(
      {
        connection: params.connection,
        user: params.user,
        yesMint: params.yesMint,
        noMint: params.noMint,
        pairAddress: params.pairAddress,
        liquidityIn: params.liquidityIn,
        slippageBps: params.slippageBps,
      },
      params.removeBundle,
    ),
  ]);

  const yAdj =
    proj.yesAfter > OUTCOME_WITHDRAW_PLAN_BUFFER_ATOMS
      ? proj.yesAfter - OUTCOME_WITHDRAW_PLAN_BUFFER_ATOMS
      : 0n;
  const nAdj =
    proj.noAfter > OUTCOME_WITHDRAW_PLAN_BUFFER_ATOMS
      ? proj.noAfter - OUTCOME_WITHDRAW_PLAN_BUFFER_ATOMS
      : 0n;
  const side: "yes" | "no" = yAdj >= nAdj ? "yes" : "no";
  const cap = side === "yes" ? yAdj : nAdj;

  return {
    rd,
    proj,
    outcomeBalances: { yes: yAdj, no: nAdj },
    cap,
    side,
  };
}

export async function planWithdrawOmnipairLiquidityToUsdc(params: {
  connection: Connection;
  user: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
  pairAddress: PublicKey;
  liquidityIn: bigint;
  marketSlug?: string;
  slippageBps?: number;
  /** Preview logging only */
  liquidityHuman?: string;
  lpDecimals?: number;
}): Promise<{
  plan: SellOutcomePlan;
  removeLog: WithdrawOmnipairLiquidityBuildLog;
}> {
  const slippageBps = params.slippageBps ?? 100;
  const [sellArgs, custody] = await Promise.all([
    computeWithdrawToUsdcSellPlanningArgs({ ...params, slippageBps }),
    readCustodyUsdcAtoms(params.connection),
  ]);
  const { rd, proj, outcomeBalances, cap, side } = sellArgs;

  const plan = await planSellOutcomePairedRedeemFromSnapshot({
    connection: params.connection,
    user: params.user,
    side,
    yesMint: params.yesMint,
    noMint: params.noMint,
    pairAddress: params.pairAddress,
    marketSlug: params.marketSlug,
    slippageBps,
    outcomeBalances,
    capOutcomeAtoms: cap,
    pairDecodedForSwap: proj.pairForSwap,
    redemptionMintDecimals: rd,
  });

  const yesAdd = proj.expectedYesFromRemove;
  const noAdd = proj.expectedNoFromRemove;
  const rawMinBal =
    outcomeBalances.yes < outcomeBalances.no
      ? outcomeBalances.yes
      : outcomeBalances.no;
  const redeemableUncapped = floorOutcomeToUsdcRedemptionGrid(
    rawMinBal,
    rd.outcome,
    rd.usdc,
  );
  const maxPair = maxPairedBurnOutcomeAtomsForCustodyUsdc(
    custody.atoms,
    rd.outcome,
    rd.usdc,
  );
  const redeemableCapped =
    redeemableUncapped > maxPair ? maxPair : redeemableUncapped;
  const pairedUsdcIfNoSwap = pairedOutcomeAtomsToUsdcAtomsDynamic(
    redeemableCapped,
    rd.outcome,
    rd.usdc,
  );

  console.info(
    "[predicted][withdraw-lp-usdc-preview]",
    JSON.stringify({
      marketSlug: params.marketSlug ?? null,
      liquidityHuman: params.liquidityHuman ?? null,
      lpDecimals: params.lpDecimals ?? null,
      liquidityInRaw: params.liquidityIn.toString(),
      outcomePlanBufferAtoms: OUTCOME_WITHDRAW_PLAN_BUFFER_ATOMS.toString(),
      yesFromRemoveWorstRaw: proj.yesFromRemoveWorst.toString(),
      noFromRemoveWorstRaw: proj.noFromRemoveWorst.toString(),
      expectedYesFromRemoveRaw: yesAdd.toString(),
      expectedNoFromRemoveRaw: noAdd.toString(),
      expectedYesHuman: atomsToDecimalString(yesAdd, rd.outcome, 8),
      expectedNoHuman: atomsToDecimalString(noAdd, rd.outcome, 8),
      walletYesBeforeRaw: (proj.yesAfter - proj.yesFromRemoveWorst).toString(),
      walletNoBeforeRaw: (proj.noAfter - proj.noFromRemoveWorst).toString(),
      yesAfterRemoveRaw: proj.yesAfter.toString(),
      noAfterRemoveRaw: proj.noAfter.toString(),
      yesAfterHuman: atomsToDecimalString(proj.yesAfter, rd.outcome, 8),
      noAfterHuman: atomsToDecimalString(proj.noAfter, rd.outcome, 8),
      sellPlanYesRaw: outcomeBalances.yes.toString(),
      sellPlanNoRaw: outcomeBalances.no.toString(),
      sellPlanCapRaw: cap.toString(),
      sellPlanSide: side,
      redeemableRawUncapped: redeemableUncapped.toString(),
      redeemableRawCapped: redeemableCapped.toString(),
      redeemableHumanUncapped: atomsToDecimalString(
        redeemableUncapped,
        rd.outcome,
        8,
      ),
      redeemableHumanCapped: atomsToDecimalString(
        redeemableCapped,
        rd.outcome,
        8,
      ),
      outcomeMintDecimals: rd.outcome,
      usdcMintDecimals: rd.usdc,
      custodyUsdcAtoms: custody.atoms.toString(),
      custodyOwner: custody.custodyOwner || null,
      planUsdcOutAtoms: plan.usdcOutAtoms,
      planUsdcOutHuman: atomsToDecimalString(
        BigInt(plan.usdcOutAtoms || "0"),
        rd.usdc,
        6,
      ),
      pairedUsdcIfNoSwapAtoms: pairedUsdcIfNoSwap.toString(),
      pairedUsdcIfNoSwapHuman: atomsToDecimalString(pairedUsdcIfNoSwap, rd.usdc, 6),
      leftoverYesAtoms: plan.leftoverYesAtoms,
      leftoverNoAtoms: plan.leftoverNoAtoms,
      leftoverYesHuman: atomsToDecimalString(
        BigInt(plan.leftoverYesAtoms || "0"),
        rd.outcome,
        8,
      ),
      leftoverNoHuman: atomsToDecimalString(
        BigInt(plan.leftoverNoAtoms || "0"),
        rd.outcome,
        8,
      ),
      rebalanceSwapAmountIn: plan.rebalanceSwapAmountIn,
      plannedPairedBurnRaw: plan.pairedBurnOutcomeAtoms,
      plannedUsdcOutAtoms: plan.usdcOutAtoms,
    }),
  );

  const removeLog: WithdrawOmnipairLiquidityBuildLog = {
    user: params.user.toBase58(),
    pairAddress: params.pairAddress.toBase58(),
    liquidityIn: params.liquidityIn.toString(),
    minAmount0Out: proj.min0.toString(),
    minAmount1Out: proj.min1.toString(),
    poolStateBefore: {
      reserve0: proj.pairDecoded.reserve0.toString(),
      reserve1: proj.pairDecoded.reserve1.toString(),
      totalLpSupply: proj.totalLpSupply.toString(),
    },
  };

  return { plan, removeLog };
}

export async function buildWithdrawOmnipairLiquidityToUsdcTransactionEngineSigned(params: {
  connection: Connection;
  engine: Keypair;
  user: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
  pairAddress: PublicKey;
  liquidityIn: bigint;
  marketSlug?: string;
  slippageBps?: number;
  /** Debug logging only */
  liquidityHuman?: string;
  lpDecimals?: number;
}): Promise<{
  serialized: Uint8Array;
  log: WithdrawLpToUsdcBuildLog;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}> {
  const slippageBps = params.slippageBps ?? 100;
  const removeBundle = await buildOmnipairRemoveLiquidityIxForUser({
    connection: params.connection,
    user: params.user,
    yesMint: params.yesMint,
    noMint: params.noMint,
    pairAddress: params.pairAddress,
    liquidityIn: params.liquidityIn,
    slippageBps,
  });
  const {
    instruction: removeIx,
    pairDecoded,
    totalLpSupply,
    minAmount0Out: min0,
    minAmount1Out: min1,
  } = removeBundle;

  const userLp = await readUserOmnipairLpBalance(
    params.connection,
    params.user,
    pairDecoded.lpMint,
  );
  if (params.liquidityIn > userLp.amount) {
    throw new Error(
      "Withdraw amount exceeds omLP balance. Refresh and use Max.",
    );
  }

  const sellArgs = await computeWithdrawToUsdcSellPlanningArgs({
    connection: params.connection,
    user: params.user,
    yesMint: params.yesMint,
    noMint: params.noMint,
    pairAddress: params.pairAddress,
    liquidityIn: params.liquidityIn,
    slippageBps,
    removeBundle,
  });
  const { rd, proj, outcomeBalances, cap, side } = sellArgs;

  const userYesAta = getAssociatedTokenAddressSync(
    params.yesMint,
    params.user,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const userNoAta = getAssociatedTokenAddressSync(
    params.noMint,
    params.user,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const [userYesBefore, userNoBefore, lpDecimalsResolved] = await Promise.all([
    readOutcomeBal(params.connection, userYesAta),
    readOutcomeBal(params.connection, userNoAta),
    params.lpDecimals != null
      ? Promise.resolve(params.lpDecimals)
      : getMint(params.connection, pairDecoded.lpMint).then(
          (m: { decimals: number }) => m.decimals,
        ),
  ]);

  const redeemPart = await buildSellOutcomePairedRedeemInstructionsFromSnapshot({
    connection: params.connection,
    engine: params.engine,
    user: params.user,
    side,
    yesMint: params.yesMint,
    noMint: params.noMint,
    pairAddress: params.pairAddress,
    marketSlug: params.marketSlug,
    slippageBps,
    outcomeBalances,
    capOutcomeAtoms: cap,
    pairDecodedForSwap: proj.pairForSwap,
    skipComputeBudgetInstruction: true,
    redemptionMintDecimals: rd,
  });

  console.info(
    "[predicted][withdraw-usdc-build-debug]",
    JSON.stringify({
      marketSlug: params.marketSlug ?? null,
      user: params.user.toBase58(),
      liquidityHuman: params.liquidityHuman ?? null,
      liquidityInRaw: params.liquidityIn.toString(),
      omLpMint: pairDecoded.lpMint.toBase58(),
      omLpDecimals: lpDecimalsResolved,
      userOmLpAta: userLp.ata.toBase58(),
      userOmLpBalanceRaw: userLp.amount.toString(),
      userOmLpBalanceHuman: atomsToDecimalString(
        userLp.amount,
        lpDecimalsResolved,
        8,
      ),
      userYesAta: userYesAta.toBase58(),
      userNoAta: userNoAta.toBase58(),
      userYesBalanceBeforeRaw: userYesBefore.toString(),
      userNoBalanceBeforeRaw: userNoBefore.toString(),
      userYesBeforeHuman: atomsToDecimalString(userYesBefore, rd.outcome, 8),
      userNoBeforeHuman: atomsToDecimalString(userNoBefore, rd.outcome, 8),
      yesFromRemoveWorstRaw: proj.yesFromRemoveWorst.toString(),
      noFromRemoveWorstRaw: proj.noFromRemoveWorst.toString(),
      expectedYesFromRemoveRaw: proj.expectedYesFromRemove.toString(),
      expectedNoFromRemoveRaw: proj.expectedNoFromRemove.toString(),
      yesAfterRemoveWorstRaw: proj.yesAfter.toString(),
      noAfterRemoveWorstRaw: proj.noAfter.toString(),
      outcomePlanBufferAtoms: OUTCOME_WITHDRAW_PLAN_BUFFER_ATOMS.toString(),
      sellPlanYesRaw: outcomeBalances.yes.toString(),
      sellPlanNoRaw: outcomeBalances.no.toString(),
      sellPlanCapRaw: cap.toString(),
      sellPlanSide: side,
      plannedPairedBurnRaw: redeemPart.log.pairedBurnOutcomeAtoms,
      plannedRebalanceSwapIn: redeemPart.log.rebalanceSwapAmountIn,
      plannedUsdcOutAtoms: redeemPart.log.usdcOutAtoms,
      leftoverYesAtoms: redeemPart.log.leftoverYesAtoms,
      leftoverNoAtoms: redeemPart.log.leftoverNoAtoms,
    }),
  );

  const microLamports = Math.floor(Math.random() * 900_000) + 1;
  const merged = new Transaction();
  merged.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports }));
  merged.add(removeIx);
  merged.add(...redeemPart.instructions);
  merged.feePayer = params.user;
  merged.recentBlockhash = redeemPart.recentBlockhash;
  merged.lastValidBlockHeight = redeemPart.lastValidBlockHeight;
  merged.partialSign(params.engine);

  const removeLog: WithdrawOmnipairLiquidityBuildLog = {
    user: params.user.toBase58(),
    pairAddress: params.pairAddress.toBase58(),
    liquidityIn: params.liquidityIn.toString(),
    minAmount0Out: min0.toString(),
    minAmount1Out: min1.toString(),
    poolStateBefore: {
      reserve0: pairDecoded.reserve0.toString(),
      reserve1: pairDecoded.reserve1.toString(),
      totalLpSupply: totalLpSupply.toString(),
    },
  };

  return {
    serialized: merged.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }),
    log: { remove: removeLog, redeem: redeemPart.log },
    recentBlockhash: redeemPart.recentBlockhash,
    lastValidBlockHeight: redeemPart.lastValidBlockHeight,
  };
}

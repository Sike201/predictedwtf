/**
 * USDC-native **sell YES / sell NO**: best-effort unwind to devnet USDC via custody paired burn,
 * with Omnipair YES↔NO rebalancing when needed, optional partial exits, and pool-only fallback.
 */
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createBurnInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";

import { DEVNET_USDC_MINT } from "@/lib/solana/assets";
import {
  decodeFutarchySwapShareBps,
  decodeOmnipairPairAccount,
  type DecodedOmnipairPair,
} from "@/lib/solana/decode-omnipair-accounts";
import {
  getMintPositionsCustodyOwnerFromEnv,
  floorOutcomeAtomsToRedemptionGrid,
  outcomeBaseUnitsToUsdcBaseUnits,
  parseOutcomeHumanToBaseUnits,
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
import { loadMarketEngineAuthority } from "@/lib/solana/treasury";

export type SellOutcomeSide = "yes" | "no";

export type SellRouteKind =
  | "full_usdc_exit"
  | "partial_usdc_exit"
  | "fallback_pool_swap";

export type SellOutcomeForUsdcBuildLog = {
  lastValidBlockHeight: number;
  recentBlockhash: string;
  user: string;
  marketSlug?: string;
  side: SellOutcomeSide;
  yesMint: string;
  noMint: string;
  pairAddress: string;
  routeKind: SellRouteKind;
  /** Vault reserves (underlying pool liquidity, atoms). */
  reserveYes: string;
  reserveNo: string;
  /** Max outcome atoms user asked to unwind on the selling side. */
  requestedCapOutcomeAtoms: string;
  /** Paired-burn atoms after grid + custody cap (0 for fallback-only). */
  pairedBurnOutcomeAtoms: string;
  /** Eligible paired burn before custody clamp (for debugging). */
  eligiblePairedBurnOutcomeAtoms: string;
  usdcOutAtoms: string;
  rebalanceSwapAmountIn: string;
  leftoverYesAtoms: string;
  leftoverNoAtoms: string;
  /** Fallback route — swap into opposite leg, no USDC leg */
  fallbackSwapAmountIn?: string;
  fallbackOppositeMinOut?: string;
  /** User-facing one-liner; no protocol jargon */
  uiSummary: string;
  computeBudgetMicroLamports?: number;
  custodyOwner?: string;
};

function logSell(tag: string, payload: Record<string, unknown>) {
  console.info(`[predicted][sell-outcome-usdc] ${tag}`, JSON.stringify(payload));
}

function vaultReservesForMints(
  pair: DecodedOmnipairPair,
  yesMint: PublicKey,
): { reserveYes: bigint; reserveNo: bigint } {
  const t0IsYes = yesMint.equals(pair.token0);
  return {
    reserveYes: t0IsYes ? pair.reserve0 : pair.reserve1,
    reserveNo: t0IsYes ? pair.reserve1 : pair.reserve0,
  };
}

async function outcomeAta(
  owner: PublicKey,
  mint: PublicKey,
): Promise<PublicKey> {
  return getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
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

async function readUsdcBal(
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

async function maybeCreateUserUsdcAtaIx(
  connection: Connection,
  user: PublicKey,
): Promise<TransactionInstruction | null> {
  const ata = getAssociatedTokenAddressSync(
    DEVNET_USDC_MINT,
    user,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const info = await connection.getAccountInfo(ata, "confirmed");
  if (info) return null;
  return createAssociatedTokenAccountIdempotentInstruction(
    user,
    ata,
    user,
    DEVNET_USDC_MINT,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
}

/** Max paired-burn outcome atoms redeemable given custody USDC (mint parity + grid). */
function maxPairedBurnAtomsForCustody(custodyUsdcAtoms: bigint): bigint {
  if (custodyUsdcAtoms <= 0n) return 0n;
  const atoms = usdcBaseUnitsToOutcomeBaseUnits(custodyUsdcAtoms);
  return floorOutcomeAtomsToRedemptionGrid(atoms);
}

const SEARCH_STEPS = 96n;

function min3(a: bigint, b: bigint, c: bigint): bigint {
  const x = a < b ? a : b;
  return x < c ? x : c;
}

function bestSwapInSellYes(params: {
  yes0: bigint;
  no0: bigint;
  cap: bigint;
  maxPairByCustody: bigint;
  pairDecoded: DecodedOmnipairPair;
  futarchySwapShareBps: number;
  yesMint: PublicKey;
  slippageBps: number;
}): bigint {
  const hi =
    params.cap < params.yes0
      ? params.cap
      : params.yes0;
  if (hi <= 0n) return 0n;

  const evalPair = (S: bigint): bigint => {
    if (S < 0n || S > hi) return -1n;
    const budget = params.cap > S ? params.cap - S : 0n;
    const minOut = applySlippageFloor(
      estimateOmnipairSwapAmountOut({
        pair: params.pairDecoded,
        futarchySwapShareBps: params.futarchySwapShareBps,
        amountIn: S,
        isToken0In: params.yesMint.equals(params.pairDecoded.token0),
      }),
      params.slippageBps,
    );
    const yes1 = params.yes0 - S;
    const no1 = params.no0 + minOut;
    let raw = yes1 < no1 ? yes1 : no1;
    raw = min3(raw, budget, params.maxPairByCustody);
    return floorOutcomeAtomsToRedemptionGrid(raw);
  };

  let bestS = 0n;
  let bestScore = evalPair(0n);
  for (let i = 0n; i <= SEARCH_STEPS; i++) {
    const S = (hi * i) / SEARCH_STEPS;
    const sc = evalPair(S);
    if (sc > bestScore) {
      bestScore = sc;
      bestS = S;
    }
  }
  const span = hi / 48n + 1n;
  for (let d = -10n; d <= 10n; d++) {
    const S2 = bestS + d * span;
    if (S2 < 0n || S2 > hi) continue;
    const sc = evalPair(S2);
    if (sc > bestScore) {
      bestScore = sc;
      bestS = S2;
    }
  }
  if (bestScore <= 0n) return 0n;
  return bestS;
}

function bestSwapInSellNo(params: {
  yes0: bigint;
  no0: bigint;
  cap: bigint;
  maxPairByCustody: bigint;
  pairDecoded: DecodedOmnipairPair;
  futarchySwapShareBps: number;
  noMint: PublicKey;
  slippageBps: number;
}): bigint {
  const hi = params.cap < params.no0 ? params.cap : params.no0;
  if (hi <= 0n) return 0n;

  const evalPair = (S: bigint): bigint => {
    if (S < 0n || S > hi) return -1n;
    const budget = params.cap > S ? params.cap - S : 0n;
    const minOut = applySlippageFloor(
      estimateOmnipairSwapAmountOut({
        pair: params.pairDecoded,
        futarchySwapShareBps: params.futarchySwapShareBps,
        amountIn: S,
        isToken0In: params.noMint.equals(params.pairDecoded.token0),
      }),
      params.slippageBps,
    );
    const no1 = params.no0 - S;
    const yes1 = params.yes0 + minOut;
    let raw = yes1 < no1 ? yes1 : no1;
    raw = min3(raw, budget, params.maxPairByCustody);
    return floorOutcomeAtomsToRedemptionGrid(raw);
  };

  let bestS = 0n;
  let bestScore = evalPair(0n);
  for (let i = 0n; i <= SEARCH_STEPS; i++) {
    const S = (hi * i) / SEARCH_STEPS;
    const sc = evalPair(S);
    if (sc > bestScore) {
      bestScore = sc;
      bestS = S;
    }
  }
  const span = hi / 48n + 1n;
  for (let d = -10n; d <= 10n; d++) {
    const S2 = bestS + d * span;
    if (S2 < 0n || S2 > hi) continue;
    const sc = evalPair(S2);
    if (sc > bestScore) {
      bestScore = sc;
      bestS = S2;
    }
  }
  if (bestScore <= 0n) return 0n;
  return bestS;
}

function uiSummaryForUsdc(params: {
  routeKind: "full_usdc_exit" | "partial_usdc_exit";
  pairedBurn: bigint;
  cap: bigint;
}): string {
  if (params.routeKind === "partial_usdc_exit") {
    return "Partially exited to USDC. Remaining position left in outcome tokens.";
  }
  return "Full exit to devnet USDC at the current redemption grid.";
}

export type PlanSellOutcomeParams = {
  connection: Connection;
  user: PublicKey;
  side: SellOutcomeSide;
  yesMint: PublicKey;
  noMint: PublicKey;
  pairAddress: PublicKey;
  outcomeAmountHuman: string;
  marketSlug?: string;
  slippageBps?: number;
};

export type SellOutcomePlan = Pick<
  SellOutcomeForUsdcBuildLog,
  | "routeKind"
  | "reserveYes"
  | "reserveNo"
  | "requestedCapOutcomeAtoms"
  | "eligiblePairedBurnOutcomeAtoms"
  | "pairedBurnOutcomeAtoms"
  | "usdcOutAtoms"
  | "rebalanceSwapAmountIn"
  | "leftoverYesAtoms"
  | "leftoverNoAtoms"
  | "fallbackSwapAmountIn"
  | "fallbackOppositeMinOut"
  | "uiSummary"
>;

/**
 * Read chain state and compute the same route the signed sell tx will use (no engine / no tx bytes).
 */
export async function planSellOutcomeForUsdc(
  params: PlanSellOutcomeParams,
): Promise<SellOutcomePlan> {
  const { log } = await computeSellOutcomeCore({
    ...params,
    engine: null,
  });
  return {
    routeKind: log.routeKind,
    reserveYes: log.reserveYes,
    reserveNo: log.reserveNo,
    requestedCapOutcomeAtoms: log.requestedCapOutcomeAtoms,
    eligiblePairedBurnOutcomeAtoms: log.eligiblePairedBurnOutcomeAtoms,
    pairedBurnOutcomeAtoms: log.pairedBurnOutcomeAtoms,
    usdcOutAtoms: log.usdcOutAtoms,
    rebalanceSwapAmountIn: log.rebalanceSwapAmountIn,
    leftoverYesAtoms: log.leftoverYesAtoms,
    leftoverNoAtoms: log.leftoverNoAtoms,
    fallbackSwapAmountIn: log.fallbackSwapAmountIn,
    fallbackOppositeMinOut: log.fallbackOppositeMinOut,
    uiSummary: log.uiSummary,
  };
}

type ComputeCoreResult = {
  log: SellOutcomeForUsdcBuildLog;
  serialized?: Uint8Array;
  recentBlockhash: string;
  lastValidBlockHeight: number;
};

async function computeSellOutcomeCore(params: {
  connection: Connection;
  engine: Keypair | null;
  user: PublicKey;
  side: SellOutcomeSide;
  yesMint: PublicKey;
  noMint: PublicKey;
  pairAddress: PublicKey;
  outcomeAmountHuman: string;
  marketSlug?: string;
  slippageBps?: number;
}): Promise<ComputeCoreResult> {
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
    getMintPositionsCustodyOwnerFromEnv() ??
    params.engine?.publicKey ??
    loadMarketEngineAuthority()?.publicKey;
  if (!custodyOwner) {
    throw new Error(
      "Cannot resolve custody USDC owner — set MINT_POSITIONS_CUSTODY_PUBKEY or MARKET_ENGINE_AUTHORITY_SECRET.",
    );
  }
  if (params.engine && !custodyOwner.equals(params.engine.publicKey)) {
    throw new Error(
      "Redeem USDC from custody requires the engine authority wallet to own custody (set MINT_POSITIONS_CUSTODY_PUBKEY to the engine pubkey, or unset).",
    );
  }

  const userYesAta = await outcomeAta(params.user, params.yesMint);
  const userNoAta = await outcomeAta(params.user, params.noMint);
  const userUsdcAta = await outcomeAta(params.user, DEVNET_USDC_MINT);
  const custodyUsdcAta = getAssociatedTokenAddressSync(
    DEVNET_USDC_MINT,
    custodyOwner,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  let yes0 = await readOutcomeBal(params.connection, userYesAta);
  let no0 = await readOutcomeBal(params.connection, userNoAta);

  const requested = parseOutcomeHumanToBaseUnits(params.outcomeAmountHuman.trim());
  if (requested <= 0n) {
    throw new Error("Enter a position size greater than zero to sell.");
  }

  const cap =
    params.side === "yes"
      ? (requested > yes0 ? yes0 : requested)
      : (requested > no0 ? no0 : requested);

  if (cap <= 0n) {
    throw new Error("Insufficient outcome token balance to sell.");
  }

  const pairInfo = await params.connection.getAccountInfo(
    params.pairAddress,
    "confirmed",
  );
  if (!pairInfo?.data) throw new Error("Omnipair pair account missing");
  const pairDecoded = decodeOmnipairPairAccount(pairInfo.data);
  const { reserveYes, reserveNo } = vaultReservesForMints(
    pairDecoded,
    params.yesMint,
  );

  const [futarchyPk] = getGlobalFutarchyAuthorityPDA(programId);
  const futarchyInfo = await params.connection.getAccountInfo(futarchyPk, "confirmed");
  if (!futarchyInfo?.data) throw new Error("Futarchy authority account missing");
  const futarchySwapShareBps = decodeFutarchySwapShareBps(futarchyInfo.data);

  const custodyUsdcBal = await readUsdcBal(params.connection, custodyUsdcAta);
  const maxPairByCustody = maxPairedBurnAtomsForCustody(custodyUsdcBal);

  logSell("pre-execution", {
    marketSlug: params.marketSlug,
    side: params.side,
    outcomeAmountHuman: params.outcomeAmountHuman,
    reserveYes: reserveYes.toString(),
    reserveNo: reserveNo.toString(),
    yes0: yes0.toString(),
    no0: no0.toString(),
    cap: cap.toString(),
    maxPairByCustody: maxPairByCustody.toString(),
    custodyUsdcAtoms: custodyUsdcBal.toString(),
  });

  let swapIn = 0n;
  let swapIx: TransactionInstruction | null = null;

  if (params.side === "yes") {
    swapIn = bestSwapInSellYes({
      yes0,
      no0,
      cap,
      maxPairByCustody,
      pairDecoded,
      futarchySwapShareBps,
      yesMint: params.yesMint,
      slippageBps,
    });
    if (swapIn > 0n) {
      const minOut = applySlippageFloor(
        estimateOmnipairSwapAmountOut({
          pair: pairDecoded,
          futarchySwapShareBps,
          amountIn: swapIn,
          isToken0In: params.yesMint.equals(pairDecoded.token0),
        }),
        slippageBps,
      );
      if (minOut <= 0n) {
        swapIn = 0n;
      } else {
        swapIx = buildOmnipairSwapInstruction({
          programId,
          pair: params.pairAddress,
          rateModel: pairDecoded.rateModel,
          tokenInMint: params.yesMint,
          tokenOutMint: params.noMint,
          user: params.user,
          userTokenIn: userYesAta,
          userTokenOut: userNoAta,
          amountIn: swapIn,
          minAmountOut: minOut,
        });
      }
    }
  } else {
    swapIn = bestSwapInSellNo({
      yes0,
      no0,
      cap,
      maxPairByCustody,
      pairDecoded,
      futarchySwapShareBps,
      noMint: params.noMint,
      slippageBps,
    });
    if (swapIn > 0n) {
      const minOut = applySlippageFloor(
        estimateOmnipairSwapAmountOut({
          pair: pairDecoded,
          futarchySwapShareBps,
          amountIn: swapIn,
          isToken0In: params.noMint.equals(pairDecoded.token0),
        }),
        slippageBps,
      );
      if (minOut <= 0n) {
        swapIn = 0n;
      } else {
        swapIx = buildOmnipairSwapInstruction({
          programId,
          pair: params.pairAddress,
          rateModel: pairDecoded.rateModel,
          tokenInMint: params.noMint,
          tokenOutMint: params.yesMint,
          user: params.user,
          userTokenIn: userNoAta,
          userTokenOut: userYesAta,
          amountIn: swapIn,
          minAmountOut: minOut,
        });
      }
    }
  }

  const minOutYesSwap =
    swapIn > 0n && params.side === "yes"
      ? applySlippageFloor(
          estimateOmnipairSwapAmountOut({
            pair: pairDecoded,
            futarchySwapShareBps,
            amountIn: swapIn,
            isToken0In: params.yesMint.equals(pairDecoded.token0),
          }),
          slippageBps,
        )
      : 0n;
  const minOutNoSwap =
    swapIn > 0n && params.side === "no"
      ? applySlippageFloor(
          estimateOmnipairSwapAmountOut({
            pair: pairDecoded,
            futarchySwapShareBps,
            amountIn: swapIn,
            isToken0In: params.noMint.equals(pairDecoded.token0),
          }),
          slippageBps,
        )
      : 0n;

  let yes1: bigint;
  let no1Worst: bigint;

  if (swapIx === null) {
    yes1 = yes0;
    no1Worst = no0;
  } else if (params.side === "yes") {
    yes1 = yes0 - swapIn;
    no1Worst = no0 + minOutYesSwap;
  } else {
    no1Worst = no0 - swapIn;
    yes1 = yes0 + minOutNoSwap;
  }

  if (yes1 < 0n || no1Worst < 0n) {
    throw new Error(
      "Not enough opposite-side liquidity to fully exit into USDC right now.",
    );
  }

  const sellBudgetRemain = cap > swapIn ? cap - swapIn : 0n;
  const pairSideMin = yes1 < no1Worst ? yes1 : no1Worst;
  const econEligible =
    pairSideMin < sellBudgetRemain ? pairSideMin : sellBudgetRemain;
  const eligiblePairedBurnOutcomeAtomsStr =
    floorOutcomeAtomsToRedemptionGrid(econEligible).toString();
  let rawEligible =
    econEligible > maxPairByCustody ? maxPairByCustody : econEligible;
  let pairedBurn = floorOutcomeAtomsToRedemptionGrid(rawEligible);

  let usdcOut = 0n;
  let routeKindUsdc: "full_usdc_exit" | "partial_usdc_exit" | null = null;

  if (pairedBurn > 0n) {
    usdcOut = outcomeBaseUnitsToUsdcBaseUnits(pairedBurn);
    if (usdcOut <= 0n) {
      pairedBurn = 0n;
    }
  }

  if (pairedBurn > 0n && usdcOut > 0n) {
    const totalExitOnSide = swapIn + pairedBurn;
    routeKindUsdc =
      totalExitOnSide >= cap ? "full_usdc_exit" : "partial_usdc_exit";
  }

  let routeKind: SellRouteKind =
    routeKindUsdc === "partial_usdc_exit"
      ? "partial_usdc_exit"
      : routeKindUsdc === "full_usdc_exit"
        ? "full_usdc_exit"
        : "fallback_pool_swap";

  let fallbackSwapIn = 0n;
  let fallbackMinOut = 0n;
  let fallbackIx: TransactionInstruction | null = null;

  const rebalanceSwapInSnapshot = swapIn;

  if (pairedBurn <= 0n || usdcOut <= 0n) {
    const hi =
      params.side === "yes" ? (cap < yes0 ? cap : yes0) : (cap < no0 ? cap : no0);
    if (hi <= 0n) {
      throw new Error(
        "Not enough opposite-side liquidity to fully exit into USDC right now.",
      );
    }
    fallbackSwapIn = hi;
    const estOut = estimateOmnipairSwapAmountOut({
      pair: pairDecoded,
      futarchySwapShareBps,
      amountIn: fallbackSwapIn,
      isToken0In:
        params.side === "yes"
          ? params.yesMint.equals(pairDecoded.token0)
          : params.noMint.equals(pairDecoded.token0),
    });
    fallbackMinOut = applySlippageFloor(estOut, slippageBps);
    if (fallbackMinOut <= 0n) {
      throw new Error(
        "Not enough opposite-side liquidity to fully exit into USDC right now.",
      );
    }
    if (params.side === "yes") {
      fallbackIx = buildOmnipairSwapInstruction({
        programId,
        pair: params.pairAddress,
        rateModel: pairDecoded.rateModel,
        tokenInMint: params.yesMint,
        tokenOutMint: params.noMint,
        user: params.user,
        userTokenIn: userYesAta,
        userTokenOut: userNoAta,
        amountIn: fallbackSwapIn,
        minAmountOut: fallbackMinOut,
      });
    } else {
      fallbackIx = buildOmnipairSwapInstruction({
        programId,
        pair: params.pairAddress,
        rateModel: pairDecoded.rateModel,
        tokenInMint: params.noMint,
        tokenOutMint: params.yesMint,
        user: params.user,
        userTokenIn: userNoAta,
        userTokenOut: userYesAta,
        amountIn: fallbackSwapIn,
        minAmountOut: fallbackMinOut,
      });
    }
    routeKind = "fallback_pool_swap";
    pairedBurn = 0n;
    usdcOut = 0n;
    swapIx = fallbackIx;
    swapIn = fallbackSwapIn;
  }

  let leftoverYes: bigint;
  let leftoverNo: bigint;
  if (routeKind === "fallback_pool_swap") {
    if (params.side === "yes") {
      leftoverYes = yes0 - fallbackSwapIn;
      leftoverNo = no0 + fallbackMinOut;
    } else {
      leftoverYes = yes0 + fallbackMinOut;
      leftoverNo = no0 - fallbackSwapIn;
    }
  } else {
    leftoverYes = yes1 - pairedBurn;
    leftoverNo = no1Worst - pairedBurn;
  }

  let uiSummary: string;
  if (routeKind === "fallback_pool_swap") {
    uiSummary =
      "USDC exit unavailable for this amount right now; swapped into the opposite side instead.";
  } else if (routeKind === "partial_usdc_exit") {
    uiSummary = uiSummaryForUsdc({
      routeKind: "partial_usdc_exit",
      pairedBurn,
      cap,
    });
  } else {
    uiSummary = uiSummaryForUsdc({
      routeKind: "full_usdc_exit",
      pairedBurn,
      cap,
    });
  }

  const microLamports = Math.floor(Math.random() * 900_000) + 1;
  const ixs: TransactionInstruction[] = [];
  ixs.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports }));

  const ixUserUsdc = await maybeCreateUserUsdcAtaIx(
    params.connection,
    params.user,
  );
  if (routeKind !== "fallback_pool_swap") {
    if (ixUserUsdc) ixs.push(ixUserUsdc);
    if (swapIx) ixs.push(swapIx);
    ixs.push(
      createBurnInstruction(
        userYesAta,
        params.yesMint,
        params.user,
        pairedBurn,
        [],
        TOKEN_PROGRAM_ID,
      ),
      createBurnInstruction(
        userNoAta,
        params.noMint,
        params.user,
        pairedBurn,
        [],
        TOKEN_PROGRAM_ID,
      ),
      createTransferInstruction(
        custodyUsdcAta,
        userUsdcAta,
        custodyOwner,
        usdcOut,
        [],
        TOKEN_PROGRAM_ID,
      ),
    );
  } else {
    if (swapIx) ixs.push(swapIx);
  }

  const log: SellOutcomeForUsdcBuildLog = {
    lastValidBlockHeight: 0,
    recentBlockhash: "",
    user: params.user.toBase58(),
    marketSlug: params.marketSlug,
    side: params.side,
    yesMint: params.yesMint.toBase58(),
    noMint: params.noMint.toBase58(),
    pairAddress: params.pairAddress.toBase58(),
    routeKind,
    reserveYes: reserveYes.toString(),
    reserveNo: reserveNo.toString(),
    requestedCapOutcomeAtoms: cap.toString(),
    eligiblePairedBurnOutcomeAtoms: eligiblePairedBurnOutcomeAtomsStr,
    pairedBurnOutcomeAtoms: pairedBurn.toString(),
    usdcOutAtoms: usdcOut.toString(),
    rebalanceSwapAmountIn:
      routeKind === "fallback_pool_swap"
        ? "0"
        : rebalanceSwapInSnapshot.toString(),
    leftoverYesAtoms: leftoverYes.toString(),
    leftoverNoAtoms: leftoverNo.toString(),
    fallbackSwapAmountIn:
      routeKind === "fallback_pool_swap" ? fallbackSwapIn.toString() : undefined,
    fallbackOppositeMinOut:
      routeKind === "fallback_pool_swap" ? fallbackMinOut.toString() : undefined,
    uiSummary,
    computeBudgetMicroLamports: microLamports,
    custodyOwner: custodyOwner.toBase58(),
  };

  logSell("route-selected", {
    marketSlug: params.marketSlug,
    side: params.side,
    estimatedRoute: log.routeKind,
    reserveYes: log.reserveYes,
    reserveNo: log.reserveNo,
    requestedCapOutcomeAtoms: log.requestedCapOutcomeAtoms,
    eligiblePairedBurnOutcomeAtoms: log.eligiblePairedBurnOutcomeAtoms,
    pairedBurnOutcomeAtoms: log.pairedBurnOutcomeAtoms,
    usdcOutAtoms: log.usdcOutAtoms,
    rebalanceSwapAmountIn: log.rebalanceSwapAmountIn,
    leftoverYesAtoms: log.leftoverYesAtoms,
    leftoverNoAtoms: log.leftoverNoAtoms,
    fallbackSwapAmountIn: log.fallbackSwapAmountIn,
    fallbackOppositeMinOut: log.fallbackOppositeMinOut,
  });

  if (!params.engine) {
    const { blockhash, lastValidBlockHeight } =
      await params.connection.getLatestBlockhash("confirmed");
    return {
      log: { ...log, recentBlockhash: blockhash, lastValidBlockHeight },
      recentBlockhash: blockhash,
      lastValidBlockHeight,
    };
  }

  const tx = new Transaction();
  tx.add(...ixs);
  tx.feePayer = params.user;
  const { blockhash, lastValidBlockHeight } =
    await params.connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.partialSign(params.engine);

  log.recentBlockhash = blockhash;
  log.lastValidBlockHeight = lastValidBlockHeight;

  logSell("built", {
    ...log,
    custodyOwner: custodyOwner.toBase58(),
  });

  return {
    log,
    serialized: tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }),
    recentBlockhash: blockhash,
    lastValidBlockHeight,
  };
}

/**
 * Build a partially signed transaction: optional Omnipair rebalance or fallback swap, then paired burn + custody USDC when applicable.
 */
export async function buildSellOutcomeForUsdcTransactionEngineSigned(params: {
  connection: Connection;
  engine: Keypair;
  user: PublicKey;
  side: SellOutcomeSide;
  yesMint: PublicKey;
  noMint: PublicKey;
  pairAddress: PublicKey;
  outcomeAmountHuman: string;
  marketSlug?: string;
  slippageBps?: number;
}): Promise<{
  serialized: Uint8Array;
  log: SellOutcomeForUsdcBuildLog;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}> {
  const result = await computeSellOutcomeCore({ ...params, engine: params.engine });
  if (!result.serialized) {
    throw new Error("Sell builder did not produce a transaction.");
  }
  return {
    serialized: result.serialized,
    log: result.log,
    recentBlockhash: result.recentBlockhash,
    lastValidBlockHeight: result.lastValidBlockHeight,
  };
}

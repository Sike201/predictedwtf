/**
 * Unwind an Omnipair leveraged YES/NO position: optional AMM swap to source debt token,
 * then `repay` up to min(wallet balance, position debt) on that leg (avoids InsufficientBalance
 * when wallet is a few atoms short of recorded debt), then `remove_collateral` on the collateral leg.
 */
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  Transaction,
} from "@solana/web3.js";

import {
  decodeFutarchySwapShareBps,
  decodeOmnipairPairAccount,
} from "@/lib/solana/decode-omnipair-accounts";
import {
  buildRemoveCollateralInstruction,
  buildRepayInstruction,
  OMNIPAIR_U64_MAX,
} from "@/lib/solana/omnipair-lending-instructions";

const REPAY_ADJUSTED_LOG = "[predicted][repay-adjusted]";

function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
import {
  getAssociatedTokenAddressForMint,
  resolveSplTokenProgramForMint,
} from "@/lib/solana/omnipair-leverage-common";
import { deriveOmnipairLayout } from "@/lib/solana/omnipair-pda";
import { DEFAULT_OMNIPAIR_POOL_PARAMS } from "@/lib/solana/omnipair-params-hash";
import { requireOmnipairProgramId } from "@/lib/solana/omnipair-program";
import {
  getGlobalFutarchyAuthorityPDA,
  getReserveVaultPDA,
  getUserPositionPDA,
} from "@/lib/solana/omnipair-pda";
import { readOmnipairUserPositionSnapshot } from "@/lib/solana/read-omnipair-position";
import {
  estimateOmnipairSwapAmountOut,
  applySlippageFloor,
} from "@/lib/solana/omnipair-swap-math";
import { buildOmnipairSwapInstruction } from "@/lib/solana/omnipair-swap-instruction";

function ceilDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) return a;
  return (a + b - 1n) / b;
}

/** Find minimum `amountIn` such that estimated out >= `minOut` (binary search). */
function minSwapInForMinOut(params: {
  minOut: bigint;
  maxIn: bigint;
  estimateOut: (amountIn: bigint) => bigint;
}): bigint {
  const { minOut, maxIn, estimateOut } = params;
  if (minOut <= 0n) return 0n;
  if (estimateOut(maxIn) < minOut) {
    throw new Error(
      "Wallet balance too small to obtain enough of the debt token via one pool swap.",
    );
  }
  let lo = 0n;
  let hi = maxIn;
  let best = hi;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1n;
    const out = estimateOut(mid);
    if (out >= minOut) {
      best = mid;
      if (mid === 0n) break;
      hi = mid - 1n;
    } else {
      lo = mid + 1n;
    }
  }
  return best;
}

export type CloseLeverageBuildLog = {
  direction: "yes" | "no";
  repayMint: string;
  hadPreSwap: boolean;
};

export async function buildCloseLeveragedYesPositionTransaction(params: {
  connection: Connection;
  user: PublicKey;
  pairAddress: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
  slippageBps: number;
}): Promise<{ transaction: Transaction; log: CloseLeverageBuildLog }> {
  const programId = requireOmnipairProgramId();
  const layout = deriveOmnipairLayout(
    programId,
    params.yesMint,
    params.noMint,
    DEFAULT_OMNIPAIR_POOL_PARAMS,
  );
  if (!layout.pairAddress.equals(params.pairAddress)) {
    throw new Error("pairAddress does not match derived layout for these mints.");
  }

  const snap = await readOmnipairUserPositionSnapshot({
    connection: params.connection,
    pairAddress: params.pairAddress,
    yesMint: params.yesMint,
    noMint: params.noMint,
    owner: params.user,
  });
  if (!snap) throw new Error("No Omnipair user position account for this market.");

  const pairInfo = await params.connection.getAccountInfo(params.pairAddress, "confirmed");
  if (!pairInfo?.data) throw new Error("Pair account missing.");
  const pairDecoded = decodeOmnipairPairAccount(pairInfo.data);

  const [futarchyPda] = getGlobalFutarchyAuthorityPDA(programId);
  const futarchyInfo = await params.connection.getAccountInfo(futarchyPda, "confirmed");
  if (!futarchyInfo?.data) throw new Error("Futarchy authority missing.");
  const futarchySwapShareBps = decodeFutarchySwapShareBps(futarchyInfo.data);

  const yesProg = await resolveSplTokenProgramForMint(params.connection, params.yesMint);
  const noProg = await resolveSplTokenProgramForMint(params.connection, params.noMint);
  const yesAta = getAssociatedTokenAddressForMint(
    params.yesMint,
    params.user,
    yesProg,
  );
  const noAta = getAssociatedTokenAddressForMint(
    params.noMint,
    params.user,
    noProg,
  );

  const yesBal = BigInt(
    (await params.connection.getTokenAccountBalance(yesAta).catch(() => ({ value: { amount: "0" } })))
      .value.amount,
  );
  const noBal = BigInt(
    (await params.connection.getTokenAccountBalance(noAta).catch(() => ({ value: { amount: "0" } })))
      .value.amount,
  );

  const debtNo = snap.debtNoAtoms;
  const collYes = snap.collateralYesAtoms;

  /** NO tokens available in wallet for repay, after the optional pre-swap (if any). */
  let noWalletForRepay = noBal;

  if (debtNo === 0n && collYes === 0n) {
    throw new Error("Nothing to close — no debt and no YES collateral in the lending position.");
  }

  const [userPosition] = getUserPositionPDA(programId, params.pairAddress, params.user);
  const [reserveNoVault] = getReserveVaultPDA(
    programId,
    params.pairAddress,
    params.noMint,
  );
  const collateralVaultYes = layout.collateralForMint(params.yesMint);

  const tx = new Transaction();
  /** Unique per build so retries / double-submits never reuse identical serialized bytes. */
  const microLamports = Math.floor(Math.random() * 900_000) + 1;
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports }));
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_200_000 }));

  let hadPreSwap = false;
  let preSwapInYes = 0n;

  if (debtNo > 0n && noBal < debtNo) {
    const shortfall = debtNo - noBal;
    const bufferOut = ceilDiv(shortfall * 10050n, 10_000n);
    const isToken0In = params.yesMint.equals(pairDecoded.token0);
    const estOut = (amountIn: bigint) =>
      estimateOmnipairSwapAmountOut({
        pair: pairDecoded,
        futarchySwapShareBps,
        amountIn,
        isToken0In,
      });
    const swapInYes = minSwapInForMinOut({
      minOut: bufferOut,
      maxIn: yesBal,
      estimateOut: estOut,
    });
    preSwapInYes = swapInYes;
    const est = estOut(swapInYes);
    const minOutSwap = applySlippageFloor(est, params.slippageBps);
    noWalletForRepay = noBal + minOutSwap;
    tx.add(
      buildOmnipairSwapInstruction({
        programId,
        pair: params.pairAddress,
        rateModel: pairDecoded.rateModel,
        tokenInMint: params.yesMint,
        tokenOutMint: params.noMint,
        user: params.user,
        userTokenIn: yesAta,
        userTokenOut: noAta,
        amountIn: swapInYes,
        minAmountOut: minOutSwap,
      }),
    );
    hadPreSwap = true;
  }

  if (debtNo > 0n) {
    const repayNoAtoms = minBig(debtNo, noWalletForRepay);
    console.info(
      REPAY_ADJUSTED_LOG,
      JSON.stringify({
        direction: "yes",
        walletBalance: noWalletForRepay.toString(),
        debtAtoms: debtNo.toString(),
        repayAtoms: repayNoAtoms.toString(),
        hadPreSwap,
      }),
    );
    if (repayNoAtoms > 0n) {
      tx.add(
        buildRepayInstruction({
          programId,
          pair: params.pairAddress,
          rateModel: pairDecoded.rateModel,
          userPosition,
          reserveVault: reserveNoVault,
          userReserveAta: noAta,
          reserveMint: params.noMint,
          user: params.user,
          amount: repayNoAtoms,
        }),
      );
    }
  }

  if (collYes > 0n) {
    tx.add(
      buildRemoveCollateralInstruction({
        programId,
        pair: params.pairAddress,
        rateModel: pairDecoded.rateModel,
        userPosition,
        collateralVault: collateralVaultYes,
        userCollateralAta: yesAta,
        collateralMint: params.yesMint,
        user: params.user,
        amount: OMNIPAIR_U64_MAX,
      }),
    );
  }

  if (typeof process !== "undefined" && process.env.NODE_ENV === "development") {
    console.info(
      "[predicted][close-leverage-build]",
      JSON.stringify({
        direction: "yes",
        user: params.user.toBase58(),
        pair: params.pairAddress.toBase58(),
        debtNoAtoms: debtNo.toString(),
        collateralYesAtoms: collYes.toString(),
        yesWalletAtoms: yesBal.toString(),
        noWalletAtoms: noBal.toString(),
        hadPreSwap,
        preSwapInYesAtoms: preSwapInYes.toString(),
        yesAta: yesAta.toBase58(),
        noAta: noAta.toBase58(),
      }),
    );
  }

  return {
    transaction: tx,
    log: {
      direction: "yes",
      repayMint: params.noMint.toBase58(),
      hadPreSwap,
    },
  };
}

export async function buildCloseLeveragedNoPositionTransaction(params: {
  connection: Connection;
  user: PublicKey;
  pairAddress: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
  slippageBps: number;
}): Promise<{ transaction: Transaction; log: CloseLeverageBuildLog }> {
  const programId = requireOmnipairProgramId();
  const layout = deriveOmnipairLayout(
    programId,
    params.yesMint,
    params.noMint,
    DEFAULT_OMNIPAIR_POOL_PARAMS,
  );
  if (!layout.pairAddress.equals(params.pairAddress)) {
    throw new Error("pairAddress does not match derived layout for these mints.");
  }

  const snap = await readOmnipairUserPositionSnapshot({
    connection: params.connection,
    pairAddress: params.pairAddress,
    yesMint: params.yesMint,
    noMint: params.noMint,
    owner: params.user,
  });
  if (!snap) throw new Error("No Omnipair user position account for this market.");

  const pairInfo = await params.connection.getAccountInfo(params.pairAddress, "confirmed");
  if (!pairInfo?.data) throw new Error("Pair account missing.");
  const pairDecoded = decodeOmnipairPairAccount(pairInfo.data);

  const [futarchyPk2] = getGlobalFutarchyAuthorityPDA(programId);
  const futarchyInfo = await params.connection.getAccountInfo(futarchyPk2, "confirmed");
  if (!futarchyInfo?.data) throw new Error("Futarchy authority missing.");
  const futarchySwapShareBps = decodeFutarchySwapShareBps(futarchyInfo.data);

  const yesProg = await resolveSplTokenProgramForMint(params.connection, params.yesMint);
  const noProg = await resolveSplTokenProgramForMint(params.connection, params.noMint);
  const yesAta = getAssociatedTokenAddressForMint(
    params.yesMint,
    params.user,
    yesProg,
  );
  const noAta = getAssociatedTokenAddressForMint(
    params.noMint,
    params.user,
    noProg,
  );

  const yesBal = BigInt(
    (await params.connection.getTokenAccountBalance(yesAta).catch(() => ({ value: { amount: "0" } })))
      .value.amount,
  );
  const noBal = BigInt(
    (await params.connection.getTokenAccountBalance(noAta).catch(() => ({ value: { amount: "0" } })))
      .value.amount,
  );

  const debtYes = snap.debtYesAtoms;
  const collNo = snap.collateralNoAtoms;

  let yesWalletForRepay = yesBal;

  if (debtYes === 0n && collNo === 0n) {
    throw new Error("Nothing to close — no debt and no NO collateral on this position.");
  }

  const [userPosition] = getUserPositionPDA(programId, params.pairAddress, params.user);
  const [reserveYesVault] = getReserveVaultPDA(
    programId,
    params.pairAddress,
    params.yesMint,
  );
  const collateralVaultNo = layout.collateralForMint(params.noMint);

  const tx = new Transaction();
  const microLamports = Math.floor(Math.random() * 900_000) + 1;
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports }));
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_200_000 }));

  let hadPreSwap = false;
  let preSwapInNo = 0n;

  if (debtYes > 0n && yesBal < debtYes) {
    const shortfall = debtYes - yesBal;
    const bufferOut = ceilDiv(shortfall * 10050n, 10_000n);
    const isToken0In = params.noMint.equals(pairDecoded.token0);
    const estOut = (amountIn: bigint) =>
      estimateOmnipairSwapAmountOut({
        pair: pairDecoded,
        futarchySwapShareBps,
        amountIn,
        isToken0In,
      });
    const swapInNo = minSwapInForMinOut({
      minOut: bufferOut,
      maxIn: noBal,
      estimateOut: estOut,
    });
    preSwapInNo = swapInNo;
    const est = estOut(swapInNo);
    const minOutSwap = applySlippageFloor(est, params.slippageBps);
    yesWalletForRepay = yesBal + minOutSwap;
    tx.add(
      buildOmnipairSwapInstruction({
        programId,
        pair: params.pairAddress,
        rateModel: pairDecoded.rateModel,
        tokenInMint: params.noMint,
        tokenOutMint: params.yesMint,
        user: params.user,
        userTokenIn: noAta,
        userTokenOut: yesAta,
        amountIn: swapInNo,
        minAmountOut: minOutSwap,
      }),
    );
    hadPreSwap = true;
  }

  if (debtYes > 0n) {
    const repayYesAtoms = minBig(debtYes, yesWalletForRepay);
    console.info(
      REPAY_ADJUSTED_LOG,
      JSON.stringify({
        direction: "no",
        walletBalance: yesWalletForRepay.toString(),
        debtAtoms: debtYes.toString(),
        repayAtoms: repayYesAtoms.toString(),
        hadPreSwap,
      }),
    );
    if (repayYesAtoms > 0n) {
      tx.add(
        buildRepayInstruction({
          programId,
          pair: params.pairAddress,
          rateModel: pairDecoded.rateModel,
          userPosition,
          reserveVault: reserveYesVault,
          userReserveAta: yesAta,
          reserveMint: params.yesMint,
          user: params.user,
          amount: repayYesAtoms,
        }),
      );
    }
  }

  if (collNo > 0n) {
    tx.add(
      buildRemoveCollateralInstruction({
        programId,
        pair: params.pairAddress,
        rateModel: pairDecoded.rateModel,
        userPosition,
        collateralVault: collateralVaultNo,
        userCollateralAta: noAta,
        collateralMint: params.noMint,
        user: params.user,
        amount: OMNIPAIR_U64_MAX,
      }),
    );
  }

  if (typeof process !== "undefined" && process.env.NODE_ENV === "development") {
    console.info(
      "[predicted][close-leverage-build]",
      JSON.stringify({
        direction: "no",
        user: params.user.toBase58(),
        pair: params.pairAddress.toBase58(),
        debtYesAtoms: debtYes.toString(),
        collateralNoAtoms: collNo.toString(),
        yesWalletAtoms: yesBal.toString(),
        noWalletAtoms: noBal.toString(),
        hadPreSwap,
        preSwapInNoAtoms: preSwapInNo.toString(),
        yesAta: yesAta.toBase58(),
        noAta: noAta.toBase58(),
      }),
    );
  }

  return {
    transaction: tx,
    log: {
      direction: "no",
      repayMint: params.yesMint.toBase58(),
      hadPreSwap,
    },
  };
}

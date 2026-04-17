/**
 * RPC simulation to size Omnipair `borrow` after `add_collateral` using the same
 * transaction shape as the real leverage flow (minus the final swap).
 */
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  decodeFutarchySwapShareBps,
  decodeOmnipairPairAccount,
} from "@/lib/solana/decode-omnipair-accounts";
import {
  buildAddCollateralInstruction,
  buildBorrowInstruction,
  OMNIPAIR_U64_MAX,
} from "@/lib/solana/omnipair-lending-instructions";
import {
  applySlippageFloor,
  estimateOmnipairSwapAmountOut,
} from "@/lib/solana/omnipair-swap-math";
import {
  ataIdempotentIx,
  getAssociatedTokenAddressForMint,
  parseSimulatedTokenAmount,
  resolveSplTokenProgramForMint,
} from "@/lib/solana/omnipair-leverage-common";
import { deriveOmnipairLayout } from "@/lib/solana/omnipair-pda";
import { DEFAULT_OMNIPAIR_POOL_PARAMS } from "@/lib/solana/omnipair-params-hash";
import { requireOmnipairProgramId } from "@/lib/solana/omnipair-program";
import { getGlobalFutarchyAuthorityPDA } from "@/lib/solana/omnipair-pda";
import { getReserveVaultPDA } from "@/lib/solana/omnipair-pda";
import { getUserPositionPDA } from "@/lib/solana/omnipair-pda";

export type LeveragePreviewYesResult = {
  /** Protocol max borrow of reserve (opposite) token at this collateral, before slider scaling. */
  maxBorrowOppositeAtoms: bigint;
  /** Borrowed NO atoms after add_collateral + borrow (scaled by leverageSlider01). */
  borrowNoAtoms: bigint;
  /** Spot-style estimate of YES received if entire borrowed NO is swapped. */
  estimatedYesOutAtoms: bigint;
  /** Min YES out at slippage (for swap leg). */
  minYesOutAtoms: bigint;
  noAta: PublicKey;
  yesAta: PublicKey;
};

export type LeveragePreviewNoResult = {
  maxBorrowOppositeAtoms: bigint;
  borrowYesAtoms: bigint;
  estimatedNoOutAtoms: bigint;
  minNoOutAtoms: bigint;
  noAta: PublicKey;
  yesAta: PublicKey;
};

function applySliderBorrow(maxBorrow: bigint, leverageSlider01: number): bigint {
  if (maxBorrow <= 0n) return 0n;
  const f = Math.min(1, Math.max(0, leverageSlider01));
  const scaled = BigInt(Math.floor(f * 10_000));
  const out = (maxBorrow * scaled) / 10_000n;
  return out > maxBorrow ? maxBorrow : out;
}

/**
 * Simulate add_collateral(YES) + borrow(NO, MAX) and read resulting NO ATA balance delta.
 * `leverageSlider01` ∈ [0,1] scales borrow below max (e.g. 0.75 = 75% of max borrow).
 */
export async function previewLeverageYes(params: {
  connection: Connection;
  user: PublicKey;
  pairAddress: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
  /** Atoms of YES to deposit as collateral. */
  collateralYesAtoms: bigint;
  slippageBps: number;
  /** 0–1 fraction of max borrow to use (default 1). */
  leverageSlider01?: number;
}): Promise<LeveragePreviewYesResult> {
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

  const pairInfo = await params.connection.getAccountInfo(params.pairAddress, "confirmed");
  if (!pairInfo?.data) throw new Error("Pair account missing.");
  const pairDecoded = decodeOmnipairPairAccount(pairInfo.data);

  const [futarchyPk] = getGlobalFutarchyAuthorityPDA(programId);
  const futarchyInfo = await params.connection.getAccountInfo(futarchyPk, "confirmed");
  if (!futarchyInfo?.data) throw new Error("Futarchy authority missing.");
  const futarchySwapShareBps = decodeFutarchySwapShareBps(futarchyInfo.data);

  const [userPosition] = getUserPositionPDA(programId, params.pairAddress, params.user);
  const [reserveNoVault] = getReserveVaultPDA(
    programId,
    params.pairAddress,
    params.noMint,
  );
  const collateralVaultYes = layout.collateralForMint(params.yesMint);

  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    ataIdempotentIx(params.user, params.user, params.yesMint, yesProg),
    ataIdempotentIx(params.user, params.user, params.noMint, noProg),
    buildAddCollateralInstruction({
      programId,
      pair: params.pairAddress,
      rateModel: pairDecoded.rateModel,
      userPosition,
      collateralVault: collateralVaultYes,
      userCollateralAta: yesAta,
      collateralMint: params.yesMint,
      user: params.user,
      amount: params.collateralYesAtoms,
    }),
    buildBorrowInstruction({
      programId,
      pair: params.pairAddress,
      rateModel: pairDecoded.rateModel,
      userPosition,
      reserveVault: reserveNoVault,
      userReserveAta: noAta,
      reserveMint: params.noMint,
      user: params.user,
      amount: OMNIPAIR_U64_MAX,
    }),
  ];

  const { blockhash } = await params.connection.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: params.user,
    recentBlockhash: blockhash,
    instructions: ixs,
  }).compileToV0Message();
  const vtx = new VersionedTransaction(msg);

  const sim = await params.connection.simulateTransaction(vtx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    accounts: {
      encoding: "base64",
      addresses: [noAta.toBase58(), yesAta.toBase58()],
    },
  });

  if (sim.value.err) {
    const msgLog = sim.value.logs?.slice(-8).join("\n") ?? String(sim.value.err);
    throw new Error(`Leverage preview simulation failed: ${msgLog}`);
  }

  const preNo = await params.connection.getTokenAccountBalance(noAta).catch(() => ({ value: { amount: "0" } }));
  const preNoAtoms = BigInt(preNo.value.amount);

  /** Post state: [noAta, yesAta] order same as addresses array */
  const postNo = sim.value.accounts?.[0];
  const postNoAmt =
    parseSimulatedTokenAmount(postNo?.data as string[] | undefined) ?? preNoAtoms;

  const rawBorrow = postNoAmt > preNoAtoms ? postNoAmt - preNoAtoms : 0n;
  const slider = params.leverageSlider01 ?? 1;
  const borrowNoAtoms = applySliderBorrow(rawBorrow, slider);

  const isToken0In = params.noMint.equals(pairDecoded.token0);
  const estimatedYesOutAtoms = estimateOmnipairSwapAmountOut({
    pair: pairDecoded,
    futarchySwapShareBps,
    amountIn: borrowNoAtoms,
    isToken0In,
  });
  const minYesOutAtoms = applySlippageFloor(
    estimatedYesOutAtoms,
    params.slippageBps,
  );

  return {
    maxBorrowOppositeAtoms: rawBorrow,
    borrowNoAtoms,
    estimatedYesOutAtoms,
    minYesOutAtoms,
    noAta,
    yesAta,
  };
}

export async function previewLeverageNo(params: {
  connection: Connection;
  user: PublicKey;
  pairAddress: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
  collateralNoAtoms: bigint;
  slippageBps: number;
  leverageSlider01?: number;
}): Promise<LeveragePreviewNoResult> {
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

  const pairInfo = await params.connection.getAccountInfo(params.pairAddress, "confirmed");
  if (!pairInfo?.data) throw new Error("Pair account missing.");
  const pairDecoded = decodeOmnipairPairAccount(pairInfo.data);

  const [futarchyPk] = getGlobalFutarchyAuthorityPDA(programId);
  const futarchyInfo = await params.connection.getAccountInfo(futarchyPk, "confirmed");
  if (!futarchyInfo?.data) throw new Error("Futarchy authority missing.");
  const futarchySwapShareBps = decodeFutarchySwapShareBps(futarchyInfo.data);

  const [userPosition] = getUserPositionPDA(programId, params.pairAddress, params.user);
  const [reserveYesVault] = getReserveVaultPDA(
    programId,
    params.pairAddress,
    params.yesMint,
  );
  const collateralVaultNo = layout.collateralForMint(params.noMint);

  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    ataIdempotentIx(params.user, params.user, params.yesMint, yesProg),
    ataIdempotentIx(params.user, params.user, params.noMint, noProg),
    buildAddCollateralInstruction({
      programId,
      pair: params.pairAddress,
      rateModel: pairDecoded.rateModel,
      userPosition,
      collateralVault: collateralVaultNo,
      userCollateralAta: noAta,
      collateralMint: params.noMint,
      user: params.user,
      amount: params.collateralNoAtoms,
    }),
    buildBorrowInstruction({
      programId,
      pair: params.pairAddress,
      rateModel: pairDecoded.rateModel,
      userPosition,
      reserveVault: reserveYesVault,
      userReserveAta: yesAta,
      reserveMint: params.yesMint,
      user: params.user,
      amount: OMNIPAIR_U64_MAX,
    }),
  ];

  const { blockhash } = await params.connection.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: params.user,
    recentBlockhash: blockhash,
    instructions: ixs,
  }).compileToV0Message();
  const vtx = new VersionedTransaction(msg);

  const sim = await params.connection.simulateTransaction(vtx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    accounts: {
      encoding: "base64",
      addresses: [yesAta.toBase58()],
    },
  });

  if (sim.value.err) {
    const msgLog = sim.value.logs?.slice(-8).join("\n") ?? String(sim.value.err);
    throw new Error(`Leverage preview simulation failed: ${msgLog}`);
  }

  const preYes = await params.connection.getTokenAccountBalance(yesAta).catch(() => ({ value: { amount: "0" } }));
  const preYesAtoms = BigInt(preYes.value.amount);

  const postYes = sim.value.accounts?.[0];
  const postYesAmt =
    parseSimulatedTokenAmount(postYes?.data as string[] | undefined) ?? preYesAtoms;

  const rawBorrow = postYesAmt > preYesAtoms ? postYesAmt - preYesAtoms : 0n;
  const slider = params.leverageSlider01 ?? 1;
  const borrowYesAtoms = applySliderBorrow(rawBorrow, slider);

  const isToken0In = params.yesMint.equals(pairDecoded.token0);
  const estimatedNoOutAtoms = estimateOmnipairSwapAmountOut({
    pair: pairDecoded,
    futarchySwapShareBps,
    amountIn: borrowYesAtoms,
    isToken0In,
  });
  const minNoOutAtoms = applySlippageFloor(estimatedNoOutAtoms, params.slippageBps);

  return {
    maxBorrowOppositeAtoms: rawBorrow,
    borrowYesAtoms,
    estimatedNoOutAtoms,
    minNoOutAtoms,
    noAta,
    yesAta,
  };
}

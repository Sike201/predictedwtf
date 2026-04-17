/**
 * Leveraged YES: deposit YES collateral → borrow NO → swap NO → YES.
 */
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  Transaction,
} from "@solana/web3.js";

import { decodeOmnipairPairAccount } from "@/lib/solana/decode-omnipair-accounts";
import {
  buildAddCollateralInstruction,
  buildBorrowInstruction,
} from "@/lib/solana/omnipair-lending-instructions";
import {
  ataIdempotentIx,
  getAssociatedTokenAddressForMint,
} from "@/lib/solana/omnipair-leverage-common";
import type { LeveragePreviewYesResult } from "@/lib/solana/omnipair-leverage-preview";
import { previewLeverageYes } from "@/lib/solana/omnipair-leverage-preview";
import { deriveOmnipairLayout } from "@/lib/solana/omnipair-pda";
import { DEFAULT_OMNIPAIR_POOL_PARAMS } from "@/lib/solana/omnipair-params-hash";
import { requireOmnipairProgramId } from "@/lib/solana/omnipair-program";
import { getReserveVaultPDA } from "@/lib/solana/omnipair-pda";
import { getUserPositionPDA } from "@/lib/solana/omnipair-pda";
import { buildOmnipairSwapInstruction } from "@/lib/solana/omnipair-swap-instruction";
import { resolveSplTokenProgramForMint } from "@/lib/solana/omnipair-leverage-common";

export type LeverageYesBuildLog = {
  pairAddress: string;
  collateralYesAtoms: string;
  borrowNoAtoms: string;
  swapMinYesAtoms: string;
  yesMint: string;
  noMint: string;
};

function logLeverage(tag: string, payload: Record<string, unknown>) {
  console.info(`[predicted][leverage-yes] ${tag}`, JSON.stringify(payload));
}

/**
 * Build unsigned transaction: idempotent ATAs → add_collateral(YES) → borrow(NO) → swap(NO→YES).
 * Run `previewLeverageYes` first (or pass explicit borrow + min from a prior preview).
 */
export async function buildLeverageYesTransaction(params: {
  connection: Connection;
  user: PublicKey;
  pairAddress: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
  collateralYesAtoms: bigint;
  slippageBps: number;
  leverageSlider01?: number;
  /** If omitted, runs on-chain preview simulation to size borrow + min out. */
  preview?: LeveragePreviewYesResult;
}): Promise<{ transaction: Transaction; log: LeverageYesBuildLog }> {
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

  const preview =
    params.preview ??
    (await previewLeverageYes({
      connection: params.connection,
      user: params.user,
      pairAddress: params.pairAddress,
      yesMint: params.yesMint,
      noMint: params.noMint,
      collateralYesAtoms: params.collateralYesAtoms,
      slippageBps: params.slippageBps,
      leverageSlider01: params.leverageSlider01,
    }));

  if (preview.borrowNoAtoms <= 0n) {
    throw new Error("Preview returned zero borrow — increase collateral or slider.");
  }

  if (preview.borrowNoAtoms > preview.maxBorrowOppositeAtoms) {
    throw new Error(
      "Borrowing power exceeded — requested borrow exceeds the protocol max for this collateral. Reduce size or leverage.",
    );
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

  const [userPosition] = getUserPositionPDA(programId, params.pairAddress, params.user);
  const [reserveNoVault] = getReserveVaultPDA(
    programId,
    params.pairAddress,
    params.noMint,
  );
  const collateralVaultYes = layout.collateralForMint(params.yesMint);

  const tx = new Transaction();
  const microLamports = Math.floor(Math.random() * 900_000) + 1;
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports }));
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }));

  tx.add(ataIdempotentIx(params.user, params.user, params.yesMint, yesProg));
  tx.add(ataIdempotentIx(params.user, params.user, params.noMint, noProg));

  tx.add(
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
  );

  tx.add(
    buildBorrowInstruction({
      programId,
      pair: params.pairAddress,
      rateModel: pairDecoded.rateModel,
      userPosition,
      reserveVault: reserveNoVault,
      userReserveAta: noAta,
      reserveMint: params.noMint,
      user: params.user,
      amount: preview.borrowNoAtoms,
    }),
  );

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
      amountIn: preview.borrowNoAtoms,
      minAmountOut: preview.minYesOutAtoms,
    }),
  );

  const out: LeverageYesBuildLog = {
    pairAddress: params.pairAddress.toBase58(),
    collateralYesAtoms: params.collateralYesAtoms.toString(),
    borrowNoAtoms: preview.borrowNoAtoms.toString(),
    swapMinYesAtoms: preview.minYesOutAtoms.toString(),
    yesMint: params.yesMint.toBase58(),
    noMint: params.noMint.toBase58(),
  };

  logLeverage("built", out as unknown as Record<string, unknown>);

  return { transaction: tx, log: out };
}

/**
 * Leveraged NO: deposit NO collateral → borrow YES → swap YES → NO.
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
  resolveSplTokenProgramForMint,
} from "@/lib/solana/omnipair-leverage-common";
import type { LeveragePreviewNoResult } from "@/lib/solana/omnipair-leverage-preview";
import { previewLeverageNo } from "@/lib/solana/omnipair-leverage-preview";
import { deriveOmnipairLayout } from "@/lib/solana/omnipair-pda";
import { DEFAULT_OMNIPAIR_POOL_PARAMS } from "@/lib/solana/omnipair-params-hash";
import { requireOmnipairProgramId } from "@/lib/solana/omnipair-program";
import { getReserveVaultPDA } from "@/lib/solana/omnipair-pda";
import { getUserPositionPDA } from "@/lib/solana/omnipair-pda";
import { buildOmnipairSwapInstruction } from "@/lib/solana/omnipair-swap-instruction";

export type LeverageNoBuildLog = {
  pairAddress: string;
  collateralNoAtoms: string;
  borrowYesAtoms: string;
  swapMinNoAtoms: string;
  yesMint: string;
  noMint: string;
};

function logLeverage(tag: string, payload: Record<string, unknown>) {
  console.info(`[predicted][leverage-no] ${tag}`, JSON.stringify(payload));
}

export async function buildLeverageNoTransaction(params: {
  connection: Connection;
  user: PublicKey;
  pairAddress: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
  collateralNoAtoms: bigint;
  slippageBps: number;
  leverageSlider01?: number;
  preview?: LeveragePreviewNoResult;
}): Promise<{ transaction: Transaction; log: LeverageNoBuildLog }> {
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
    (await previewLeverageNo({
      connection: params.connection,
      user: params.user,
      pairAddress: params.pairAddress,
      yesMint: params.yesMint,
      noMint: params.noMint,
      collateralNoAtoms: params.collateralNoAtoms,
      slippageBps: params.slippageBps,
      leverageSlider01: params.leverageSlider01,
    }));

  if (preview.borrowYesAtoms <= 0n) {
    throw new Error("Preview returned zero borrow — increase collateral or slider.");
  }

  if (preview.borrowYesAtoms > preview.maxBorrowOppositeAtoms) {
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
  const [reserveYesVault] = getReserveVaultPDA(
    programId,
    params.pairAddress,
    params.yesMint,
  );
  const collateralVaultNo = layout.collateralForMint(params.noMint);

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
      collateralVault: collateralVaultNo,
      userCollateralAta: noAta,
      collateralMint: params.noMint,
      user: params.user,
      amount: params.collateralNoAtoms,
    }),
  );

  tx.add(
    buildBorrowInstruction({
      programId,
      pair: params.pairAddress,
      rateModel: pairDecoded.rateModel,
      userPosition,
      reserveVault: reserveYesVault,
      userReserveAta: yesAta,
      reserveMint: params.yesMint,
      user: params.user,
      amount: preview.borrowYesAtoms,
    }),
  );

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
      amountIn: preview.borrowYesAtoms,
      minAmountOut: preview.minNoOutAtoms,
    }),
  );

  const out: LeverageNoBuildLog = {
    pairAddress: params.pairAddress.toBase58(),
    collateralNoAtoms: params.collateralNoAtoms.toString(),
    borrowYesAtoms: preview.borrowYesAtoms.toString(),
    swapMinNoAtoms: preview.minNoOutAtoms.toString(),
    yesMint: params.yesMint.toBase58(),
    noMint: params.noMint.toBase58(),
  };

  logLeverage("built", out as unknown as Record<string, unknown>);

  return { transaction: tx, log: out };
}

/**
 * Leverage entry from **USDC** (paired YES+NO mint) → collateral one leg → borrow opposite → swap.
 * Composes engine-signed `mint_market_positions` with existing Omnipair lend + swap instructions.
 */
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import { DEVNET_USDC_MINT } from "@/lib/solana/assets";
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
  ataIdempotentIx,
  getAssociatedTokenAddressForMint,
  parseSimulatedTokenAmount,
  resolveSplTokenProgramForMint,
} from "@/lib/solana/omnipair-leverage-common";
import { buildLeverageNoTransaction } from "@/lib/solana/omnipair-leverage-no";
import { buildLeverageYesTransaction } from "@/lib/solana/omnipair-leverage-yes";
import type {
  LeveragePreviewNoResult,
  LeveragePreviewYesResult,
} from "@/lib/solana/omnipair-leverage-preview";
import {
  applySlippageFloor,
  estimateOmnipairSwapAmountOut,
} from "@/lib/solana/omnipair-swap-math";
import { buildMintPositionsInstructions } from "@/lib/solana/mint-market-positions";
import {
  deriveOmnipairLayout,
  getGlobalFutarchyAuthorityPDA,
  getReserveVaultPDA,
  getUserPositionPDA,
} from "@/lib/solana/omnipair-pda";
import { DEFAULT_OMNIPAIR_POOL_PARAMS } from "@/lib/solana/omnipair-params-hash";
import { requireOmnipairProgramId } from "@/lib/solana/omnipair-program";

function stripLeadingComputeBudgetInstructions(
  ixs: TransactionInstruction[],
): TransactionInstruction[] {
  let i = 0;
  while (
    i < ixs.length &&
    ixs[i].programId.equals(ComputeBudgetProgram.programId)
  ) {
    i += 1;
  }
  return ixs.slice(i);
}

function applySliderBorrow(maxBorrow: bigint, leverageSlider01: number): bigint {
  if (maxBorrow <= 0n) return 0n;
  const f = Math.min(1, Math.max(0, leverageSlider01));
  const scaled = BigInt(Math.floor(f * 10_000));
  const out = (maxBorrow * scaled) / 10_000n;
  return out > maxBorrow ? maxBorrow : out;
}

function logLeveragePreviewFromUsdc(payload: Record<string, unknown>) {
  console.info(
    "[predicted][leverage-preview-usdc]",
    JSON.stringify(payload),
  );
}

/**
 * RPC simulation: **mint** paired YES+NO from USDC, then add_collateral + borrow(MAX),
 * matching post-mint wallet state for `previewLeverageYes`-style sizing.
 */
export type MintPositionsInstructionsResult = Awaited<
  ReturnType<typeof buildMintPositionsInstructions>
>;

export async function simulatePreviewLeverageYesFromUsdc(params: {
  connection: Connection;
  engine: Keypair;
  user: PublicKey;
  pairAddress: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
  usdcAmountAtoms: bigint;
  leverageSlider01: number;
  slippageBps: number;
  /** When true, skips on-chain USDC balance read (caller must validate). */
  skipUsdcBalanceCheck?: boolean;
  /**
   * When set, must match `buildMintPositionsInstructions` for the same USDC amount
   * so borrow sizing uses the exact collateral atoms that the submit tx will use.
   */
  mintPart?: MintPositionsInstructionsResult;
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

  const mintPart =
    params.mintPart ??
    (await buildMintPositionsInstructions(
      {
        connection: params.connection,
        user: params.user,
        mintAuthority: params.engine.publicKey,
        custodyOwner: params.engine.publicKey,
        yesMint: params.yesMint,
        noMint: params.noMint,
        usdcMint: DEVNET_USDC_MINT,
        usdcAmountAtoms: params.usdcAmountAtoms,
      },
      { skipUsdcBalanceCheck: params.skipUsdcBalanceCheck ?? false },
    ));

  const outcomeMintAtoms = mintPart.outcomeMintAtoms;
  const yesProg = await resolveSplTokenProgramForMint(
    params.connection,
    params.yesMint,
  );
  const noProg = await resolveSplTokenProgramForMint(
    params.connection,
    params.noMint,
  );
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

  const pairInfo = await params.connection.getAccountInfo(
    params.pairAddress,
    "confirmed",
  );
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
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_800_000 }),
    ...mintPart.instructions,
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
      amount: outcomeMintAtoms,
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

  const microLamports = Math.floor(Math.random() * 900_000) + 1;
  const { blockhash } = await params.connection.getLatestBlockhash("confirmed");
  const allIxs = [
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
    ...ixs,
  ];
  const vmsg = new TransactionMessage({
    payerKey: params.user,
    recentBlockhash: blockhash,
    instructions: allIxs,
  }).compileToV0Message();
  const vtx = new VersionedTransaction(vmsg);
  vtx.sign([params.engine]);

  logLeveragePreviewFromUsdc({
    route: "yes_from_usdc",
    inputUsdcAtoms: params.usdcAmountAtoms.toString(),
    mintedYesAtoms: outcomeMintAtoms.toString(),
    mintedNoAtoms: outcomeMintAtoms.toString(),
    collateralSide: "YES",
    borrowSide: "NO",
    leverageSlider01: params.leverageSlider01,
  });

  const sim = await params.connection.simulateTransaction(vtx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    accounts: {
      encoding: "base64",
      addresses: [noAta.toBase58(), yesAta.toBase58()],
    },
  });

  if (sim.value.err) {
    const msgLog = sim.value.logs?.slice(-12).join("\n") ?? String(sim.value.err);
    throw new Error(`Leverage preview (USDC→YES) simulation failed: ${msgLog}`);
  }

  const preNo = await params.connection
    .getTokenAccountBalance(noAta)
    .catch(() => ({ value: { amount: "0" } }));
  const preNoAtoms = BigInt(preNo.value.amount);

  const postNo = sim.value.accounts?.[0];
  const postNoAmt =
    parseSimulatedTokenAmount(postNo?.data as string[] | undefined) ?? preNoAtoms;

  const rawBorrow = postNoAmt > preNoAtoms ? postNoAmt - preNoAtoms : 0n;
  const borrowNoAtoms = applySliderBorrow(rawBorrow, params.leverageSlider01);

  const isToken0In = params.noMint.equals(pairDecoded.token0);
  const estimatedYesOutAtoms = estimateOmnipairSwapAmountOut({
    pair: pairDecoded,
    futarchySwapShareBps,
    amountIn: borrowNoAtoms,
    isToken0In,
  });
  const minYesOutAtoms = applySlippageFloor(estimatedYesOutAtoms, params.slippageBps);

  logLeveragePreviewFromUsdc({
    route: "yes_from_usdc_result",
    rawBorrowNoAtoms: rawBorrow.toString(),
    maxBorrowOppositeAtoms: rawBorrow.toString(),
    borrowNoAtoms: borrowNoAtoms.toString(),
    swapBorrowNoAtoms: borrowNoAtoms.toString(),
    estimatedYesOutAtoms: estimatedYesOutAtoms.toString(),
    estimatedLeveragedExposureYes: (outcomeMintAtoms + estimatedYesOutAtoms).toString(),
  });

  return {
    maxBorrowOppositeAtoms: rawBorrow,
    borrowNoAtoms,
    estimatedYesOutAtoms,
    minYesOutAtoms,
    noAta,
    yesAta,
  };
}

export async function simulatePreviewLeverageNoFromUsdc(params: {
  connection: Connection;
  engine: Keypair;
  user: PublicKey;
  pairAddress: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
  usdcAmountAtoms: bigint;
  leverageSlider01: number;
  slippageBps: number;
  skipUsdcBalanceCheck?: boolean;
  mintPart?: MintPositionsInstructionsResult;
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

  const mintPart =
    params.mintPart ??
    (await buildMintPositionsInstructions(
      {
        connection: params.connection,
        user: params.user,
        mintAuthority: params.engine.publicKey,
        custodyOwner: params.engine.publicKey,
        yesMint: params.yesMint,
        noMint: params.noMint,
        usdcMint: DEVNET_USDC_MINT,
        usdcAmountAtoms: params.usdcAmountAtoms,
      },
      { skipUsdcBalanceCheck: params.skipUsdcBalanceCheck ?? false },
    ));

  const outcomeMintAtoms = mintPart.outcomeMintAtoms;
  const yesProg = await resolveSplTokenProgramForMint(
    params.connection,
    params.yesMint,
  );
  const noProg = await resolveSplTokenProgramForMint(
    params.connection,
    params.noMint,
  );
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

  const pairInfo = await params.connection.getAccountInfo(
    params.pairAddress,
    "confirmed",
  );
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
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_800_000 }),
    ...mintPart.instructions,
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
      amount: outcomeMintAtoms,
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

  const microLamports = Math.floor(Math.random() * 900_000) + 1;
  const { blockhash } = await params.connection.getLatestBlockhash("confirmed");
  const allIxsNo = [
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
    ...ixs,
  ];
  const vmsgNo = new TransactionMessage({
    payerKey: params.user,
    recentBlockhash: blockhash,
    instructions: allIxsNo,
  }).compileToV0Message();
  const vtxNo = new VersionedTransaction(vmsgNo);
  vtxNo.sign([params.engine]);

  logLeveragePreviewFromUsdc({
    route: "no_from_usdc",
    inputUsdcAtoms: params.usdcAmountAtoms.toString(),
    mintedYesAtoms: outcomeMintAtoms.toString(),
    mintedNoAtoms: outcomeMintAtoms.toString(),
    collateralSide: "NO",
    borrowSide: "YES",
    leverageSlider01: params.leverageSlider01,
  });

  const sim = await params.connection.simulateTransaction(vtxNo, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    accounts: {
      encoding: "base64",
      addresses: [yesAta.toBase58()],
    },
  });

  if (sim.value.err) {
    const msgLog = sim.value.logs?.slice(-12).join("\n") ?? String(sim.value.err);
    throw new Error(`Leverage preview (USDC→NO) simulation failed: ${msgLog}`);
  }

  const preYes = await params.connection
    .getTokenAccountBalance(yesAta)
    .catch(() => ({ value: { amount: "0" } }));
  const preYesAtoms = BigInt(preYes.value.amount);

  const postYes = sim.value.accounts?.[0];
  const postYesAmt =
    parseSimulatedTokenAmount(postYes?.data as string[] | undefined) ?? preYesAtoms;

  const rawBorrow = postYesAmt > preYesAtoms ? postYesAmt - preYesAtoms : 0n;
  const borrowYesAtoms = applySliderBorrow(rawBorrow, params.leverageSlider01);

  const isToken0In = params.yesMint.equals(pairDecoded.token0);
  const estimatedNoOutAtoms = estimateOmnipairSwapAmountOut({
    pair: pairDecoded,
    futarchySwapShareBps,
    amountIn: borrowYesAtoms,
    isToken0In,
  });
  const minNoOutAtoms = applySlippageFloor(estimatedNoOutAtoms, params.slippageBps);

  logLeveragePreviewFromUsdc({
    route: "no_from_usdc_result",
    rawBorrowYesAtoms: rawBorrow.toString(),
    maxBorrowOppositeAtoms: rawBorrow.toString(),
    borrowYesAtoms: borrowYesAtoms.toString(),
    estimatedNoOutAtoms: estimatedNoOutAtoms.toString(),
    estimatedLeveragedExposureNo: (outcomeMintAtoms + estimatedNoOutAtoms).toString(),
  });

  return {
    maxBorrowOppositeAtoms: rawBorrow,
    borrowYesAtoms,
    estimatedNoOutAtoms,
    minNoOutAtoms,
    noAta,
    yesAta,
  };
}

/** Single atomic tx: USDC→mint→collateral→borrow→swap (engine partial-sign on mint). */
export async function buildLeverageYesFromUsdcTransactionEngineSigned(params: {
  connection: Connection;
  engine: Keypair;
  user: PublicKey;
  pairAddress: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
  usdcAmountAtoms: bigint;
  slippageBps: number;
  leverageSlider01?: number;
}): Promise<{
  transaction: Transaction;
  log: Record<string, string>;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}> {
  const mintPart = await buildMintPositionsInstructions({
    connection: params.connection,
    user: params.user,
    mintAuthority: params.engine.publicKey,
    custodyOwner: params.engine.publicKey,
    yesMint: params.yesMint,
    noMint: params.noMint,
    usdcMint: DEVNET_USDC_MINT,
    usdcAmountAtoms: params.usdcAmountAtoms,
  });

  const preview = await simulatePreviewLeverageYesFromUsdc({
    connection: params.connection,
    engine: params.engine,
    user: params.user,
    pairAddress: params.pairAddress,
    yesMint: params.yesMint,
    noMint: params.noMint,
    usdcAmountAtoms: params.usdcAmountAtoms,
    leverageSlider01: params.leverageSlider01 ?? 1,
    slippageBps: params.slippageBps,
    mintPart,
  });

  if (process.env.NODE_ENV !== "production") {
    const impliedMaxLev =
      mintPart.outcomeMintAtoms > 0n
        ? Number(
            mintPart.outcomeMintAtoms + preview.estimatedYesOutAtoms,
          ) / Number(mintPart.outcomeMintAtoms)
        : 1;
    console.info(
      "[predicted][leverage][borrow-power][yes-usdc]",
      JSON.stringify({
        collateralSide: "YES",
        collateralOutcomeAtoms: mintPart.outcomeMintAtoms.toString(),
        maxBorrowOppositeAtoms: preview.maxBorrowOppositeAtoms.toString(),
        requestedBorrowNoAtoms: preview.borrowNoAtoms.toString(),
        impliedMaxLeverageMultiple: Number.isFinite(impliedMaxLev)
          ? impliedMaxLev
          : null,
      }),
    );
  }

  const lev = await buildLeverageYesTransaction({
    connection: params.connection,
    user: params.user,
    pairAddress: params.pairAddress,
    yesMint: params.yesMint,
    noMint: params.noMint,
    collateralYesAtoms: mintPart.outcomeMintAtoms,
    slippageBps: params.slippageBps,
    leverageSlider01: params.leverageSlider01,
    preview,
  });

  const merged = new Transaction();
  const microLamports = Math.floor(Math.random() * 900_000) + 1;
  merged.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports }));
  merged.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 2_000_000 }));
  merged.add(...mintPart.instructions);
  for (const ix of stripLeadingComputeBudgetInstructions(
    lev.transaction.instructions,
  )) {
    merged.add(ix);
  }
  const { blockhash, lastValidBlockHeight } =
    await params.connection.getLatestBlockhash("confirmed");
  merged.feePayer = params.user;
  merged.recentBlockhash = blockhash;
  merged.partialSign(params.engine);

  const log: Record<string, string> = {
    usdcAmountAtoms: params.usdcAmountAtoms.toString(),
    outcomeMintAtoms: mintPart.outcomeMintAtoms.toString(),
    maxBorrowOppositeAtoms: preview.maxBorrowOppositeAtoms.toString(),
    borrowNoAtoms: preview.borrowNoAtoms.toString(),
    minYesOut: preview.minYesOutAtoms.toString(),
  };

  return {
    transaction: merged,
    log,
    recentBlockhash: blockhash,
    lastValidBlockHeight,
  };
}

export async function buildLeverageNoFromUsdcTransactionEngineSigned(params: {
  connection: Connection;
  engine: Keypair;
  user: PublicKey;
  pairAddress: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
  usdcAmountAtoms: bigint;
  slippageBps: number;
  leverageSlider01?: number;
}): Promise<{
  transaction: Transaction;
  log: Record<string, string>;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}> {
  const mintPart = await buildMintPositionsInstructions({
    connection: params.connection,
    user: params.user,
    mintAuthority: params.engine.publicKey,
    custodyOwner: params.engine.publicKey,
    yesMint: params.yesMint,
    noMint: params.noMint,
    usdcMint: DEVNET_USDC_MINT,
    usdcAmountAtoms: params.usdcAmountAtoms,
  });

  const preview = await simulatePreviewLeverageNoFromUsdc({
    connection: params.connection,
    engine: params.engine,
    user: params.user,
    pairAddress: params.pairAddress,
    yesMint: params.yesMint,
    noMint: params.noMint,
    usdcAmountAtoms: params.usdcAmountAtoms,
    leverageSlider01: params.leverageSlider01 ?? 1,
    slippageBps: params.slippageBps,
    mintPart,
  });

  if (process.env.NODE_ENV !== "production") {
    const impliedMaxLev =
      mintPart.outcomeMintAtoms > 0n
        ? Number(
            mintPart.outcomeMintAtoms + preview.estimatedNoOutAtoms,
          ) / Number(mintPart.outcomeMintAtoms)
        : 1;
    console.info(
      "[predicted][leverage][borrow-power][no-usdc]",
      JSON.stringify({
        collateralSide: "NO",
        collateralOutcomeAtoms: mintPart.outcomeMintAtoms.toString(),
        maxBorrowOppositeAtoms: preview.maxBorrowOppositeAtoms.toString(),
        requestedBorrowYesAtoms: preview.borrowYesAtoms.toString(),
        impliedMaxLeverageMultiple: Number.isFinite(impliedMaxLev)
          ? impliedMaxLev
          : null,
      }),
    );
  }

  const lev = await buildLeverageNoTransaction({
    connection: params.connection,
    user: params.user,
    pairAddress: params.pairAddress,
    yesMint: params.yesMint,
    noMint: params.noMint,
    collateralNoAtoms: mintPart.outcomeMintAtoms,
    slippageBps: params.slippageBps,
    leverageSlider01: params.leverageSlider01,
    preview,
  });

  const merged = new Transaction();
  const microLamports = Math.floor(Math.random() * 900_000) + 1;
  merged.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports }));
  merged.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 2_000_000 }));
  merged.add(...mintPart.instructions);
  for (const ix of stripLeadingComputeBudgetInstructions(
    lev.transaction.instructions,
  )) {
    merged.add(ix);
  }
  const { blockhash, lastValidBlockHeight } =
    await params.connection.getLatestBlockhash("confirmed");
  merged.feePayer = params.user;
  merged.recentBlockhash = blockhash;
  merged.partialSign(params.engine);

  const log: Record<string, string> = {
    usdcAmountAtoms: params.usdcAmountAtoms.toString(),
    outcomeMintAtoms: mintPart.outcomeMintAtoms.toString(),
    maxBorrowOppositeAtoms: preview.maxBorrowOppositeAtoms.toString(),
    borrowYesAtoms: preview.borrowYesAtoms.toString(),
    minNoOut: preview.minNoOutAtoms.toString(),
  };

  return {
    transaction: merged,
    log,
    recentBlockhash: blockhash,
    lastValidBlockHeight,
  };
}

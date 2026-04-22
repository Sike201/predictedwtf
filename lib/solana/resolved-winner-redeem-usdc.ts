/**
 * **Resolved** binary markets: deterministic USDC for winning outcome tokens only.
 * No Omnipair swap, no paired YES+NO burn — user burns winning mint, receives USDC from custody
 * at mint parity (`outcomeBaseUnitsToUsdcBaseUnits`). Losing side is worthless.
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
} from "@solana/web3.js";

import { DEVNET_USDC_MINT } from "@/lib/solana/assets";
import { OUTCOME_MINT_DECIMALS } from "@/lib/solana/create-outcome-mints";
import {
  floorOutcomeAtomsToRedemptionGrid,
  getMintPositionsCustodyOwnerFromEnv,
  MINT_POSITIONS_USDC_DECIMALS,
  outcomeBaseUnitsToUsdcBaseUnits,
  parseOutcomeHumanToBaseUnits,
  usdcBaseUnitsToOutcomeBaseUnits,
} from "@/lib/solana/mint-market-positions";
import type { SellOutcomeForUsdcBuildLog } from "@/lib/solana/sell-outcome-for-usdc";
import { loadMarketEngineAuthority } from "@/lib/solana/treasury";

const ATOMS_GRID =
  10n **
  (BigInt(OUTCOME_MINT_DECIMALS) - BigInt(MINT_POSITIONS_USDC_DECIMALS));

async function maybeCreateUserUsdcAtaIx(
  connection: Connection,
  user: PublicKey,
): Promise<import("@solana/web3.js").TransactionInstruction | null> {
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

const SETTLEMENT = "[predicted][resolved-settlement]";

type CoreParams = {
  connection: Connection;
  user: PublicKey;
  side: "yes" | "no";
  winningOutcome: "yes" | "no";
  yesMint: PublicKey;
  noMint: PublicKey;
  poolAddress: PublicKey;
  outcomeAmountHuman: string;
  marketSlug?: string;
  engine: Keypair | null;
};

function logResolvedSettlement(payload: Record<string, unknown>) {
  console.info(SETTLEMENT, JSON.stringify(payload));
}

function sizeBurnToCustody(
  cap: bigint,
  custodyUsdcBal: bigint,
): { burnAtoms: bigint; usdcOut: bigint } {
  if (cap <= 0n || custodyUsdcBal <= 0n) {
    return { burnAtoms: 0n, usdcOut: 0n };
  }
  const maxByCustody = floorOutcomeAtomsToRedemptionGrid(
    usdcBaseUnitsToOutcomeBaseUnits(custodyUsdcBal),
  );
  const raw = cap < maxByCustody ? cap : maxByCustody;
  let burnAtoms = floorOutcomeAtomsToRedemptionGrid(raw);
  if (burnAtoms <= 0n) {
    return { burnAtoms: 0n, usdcOut: 0n };
  }
  let usdcOut = outcomeBaseUnitsToUsdcBaseUnits(burnAtoms);
  while (usdcOut > custodyUsdcBal && burnAtoms >= ATOMS_GRID) {
    burnAtoms -= ATOMS_GRID;
    burnAtoms = floorOutcomeAtomsToRedemptionGrid(burnAtoms);
    if (burnAtoms <= 0n) return { burnAtoms: 0n, usdcOut: 0n };
    usdcOut = outcomeBaseUnitsToUsdcBaseUnits(burnAtoms);
  }
  if (usdcOut > custodyUsdcBal) {
    return { burnAtoms: 0n, usdcOut: 0n };
  }
  return { burnAtoms, usdcOut };
}

export type PlanResolvedWinnerResult = Pick<
  SellOutcomeForUsdcBuildLog,
  | "routeKind"
  | "reserveYes"
  | "reserveNo"
  | "requestedCapOutcomeAtoms"
  | "eligiblePairedBurnOutcomeAtoms"
  | "pairedBurnOutcomeAtoms"
  | "custodyUsdcAtoms"
  | "usdcOutAtoms"
  | "rebalanceSwapAmountIn"
  | "leftoverYesAtoms"
  | "leftoverNoAtoms"
  | "uiSummary"
> & { winningBurnOutcomeAtoms: string };

/**
 * Server-side plan: same USDC amount the signed tx will use.
 */
export async function planResolvedWinnerRedeem(
  p: Omit<CoreParams, "engine" | "poolAddress">,
): Promise<PlanResolvedWinnerResult> {
  const {
    user,
    side,
    winningOutcome,
    yesMint,
    noMint,
    connection,
    outcomeAmountHuman,
    marketSlug,
  } = p;

  if (side !== winningOutcome) {
    throw new Error(
      "After resolution, only the winning outcome can be redeemed for USDC. The losing side has no value.",
    );
  }

  const custodyOwner =
    getMintPositionsCustodyOwnerFromEnv() ?? loadMarketEngineAuthority()?.publicKey;
  if (!custodyOwner) {
    throw new Error(
      "Cannot resolve custody USDC owner — set MINT_POSITIONS_CUSTODY_PUBKEY or MARKET_ENGINE_AUTHORITY_SECRET.",
    );
  }

  const custodyUsdcAta = getAssociatedTokenAddressSync(
    DEVNET_USDC_MINT,
    custodyOwner,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const custodyUsdcBal = await readUsdcBal(connection, custodyUsdcAta);

  const winMint = side === "yes" ? yesMint : noMint;
  const userWinAta = getAssociatedTokenAddressSync(
    winMint,
    user,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const winBal = await readOutcomeBal(connection, userWinAta);
  const userYesAta = getAssociatedTokenAddressSync(
    yesMint,
    user,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const userNoAta = getAssociatedTokenAddressSync(
    noMint,
    user,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const yes0 = await readOutcomeBal(connection, userYesAta);
  const no0 = await readOutcomeBal(connection, userNoAta);

  const requested = parseOutcomeHumanToBaseUnits(outcomeAmountHuman.trim());
  if (requested <= 0n) {
    throw new Error("Enter a position size greater than zero to redeem.");
  }
  const cap = requested > winBal ? winBal : requested;
  if (cap <= 0n) {
    throw new Error("No winning outcome balance to redeem.");
  }

  const { burnAtoms, usdcOut } = sizeBurnToCustody(cap, custodyUsdcBal);
  if (burnAtoms <= 0n || usdcOut <= 0n) {
    throw new Error(
      "Insufficient USDC in protocol custody to complete this redemption. Try a smaller amount.",
    );
  }

  const leftYes = side === "yes" ? yes0 - burnAtoms : yes0;
  const leftNo = side === "no" ? no0 - burnAtoms : no0;

  logResolvedSettlement({
    slug: marketSlug ?? "",
    winningOutcome,
    userYesBalance: yes0.toString(),
    userNoBalance: no0.toString(),
    payoutUsdc: usdcOut.toString(),
  });

  return {
    routeKind: "resolved_winner_redeem",
    reserveYes: "0",
    reserveNo: "0",
    requestedCapOutcomeAtoms: cap.toString(),
    eligiblePairedBurnOutcomeAtoms: "0",
    pairedBurnOutcomeAtoms: "0",
    custodyUsdcAtoms: custodyUsdcBal.toString(),
    usdcOutAtoms: usdcOut.toString(),
    winningBurnOutcomeAtoms: burnAtoms.toString(),
    rebalanceSwapAmountIn: "0",
    leftoverYesAtoms: leftYes.toString(),
    leftoverNoAtoms: leftNo.toString(),
    uiSummary:
      "Resolved settlement: 1 USDC per outcome unit of the winning side (mint parity), from custody. No AMM or paired burn.",
  };
}

type BuildSignedResult = {
  log: SellOutcomeForUsdcBuildLog;
  serialized: Uint8Array;
  recentBlockhash: string;
  lastValidBlockHeight: number;
};

/**
 * Build tx: burn winning tokens (user) then transfer USDC from custody (engine signs release).
 */
export async function buildResolvedWinnerRedeemTransactionEngineSigned(
  params: CoreParams,
): Promise<BuildSignedResult> {
  if (!params.engine) {
    throw new Error("Engine keypair required to sign custody USDC transfer.");
  }
  const plan = await planResolvedWinnerRedeem({
    connection: params.connection,
    user: params.user,
    side: params.side,
    winningOutcome: params.winningOutcome,
    yesMint: params.yesMint,
    noMint: params.noMint,
    outcomeAmountHuman: params.outcomeAmountHuman,
    marketSlug: params.marketSlug,
  });
  const burnAtoms = BigInt(plan.winningBurnOutcomeAtoms);
  const usdcOut = BigInt(plan.usdcOutAtoms);
  if (burnAtoms <= 0n || usdcOut <= 0n) {
    throw new Error("Invalid resolved redemption build.");
  }

  const { user, side, yesMint, noMint, marketSlug, connection } = params;
  const custodyOwner =
    getMintPositionsCustodyOwnerFromEnv() ?? params.engine.publicKey;
  if (!custodyOwner.equals(params.engine.publicKey)) {
    throw new Error(
      "MINT_POSITIONS_CUSTODY_PUBKEY must be the market engine for custody USDC release.",
    );
  }

  const winMint = side === "yes" ? yesMint : noMint;
  const userWinAta = getAssociatedTokenAddressSync(
    winMint,
    user,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const userUsdcAta = getAssociatedTokenAddressSync(
    DEVNET_USDC_MINT,
    user,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const custodyUsdcAta = getAssociatedTokenAddressSync(
    DEVNET_USDC_MINT,
    custodyOwner,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const microLamports = Math.floor(Math.random() * 900_000) + 1;
  const ixs: import("@solana/web3.js").TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
  ];
  const ixUserUsdc = await maybeCreateUserUsdcAtaIx(connection, user);
  if (ixUserUsdc) ixs.push(ixUserUsdc);
  ixs.push(
    createBurnInstruction(
      userWinAta,
      winMint,
      user,
      burnAtoms,
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

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction();
  tx.add(...ixs);
  tx.feePayer = user;
  tx.recentBlockhash = blockhash;
  tx.partialSign(params.engine);

  const fullLog: SellOutcomeForUsdcBuildLog = {
    lastValidBlockHeight,
    recentBlockhash: blockhash,
    user: user.toBase58(),
    marketSlug,
    side: params.side,
    yesMint: yesMint.toBase58(),
    noMint: noMint.toBase58(),
    pairAddress: params.poolAddress.toBase58(),
    routeKind: "resolved_winner_redeem",
    reserveYes: plan.reserveYes,
    reserveNo: plan.reserveNo,
    requestedCapOutcomeAtoms: plan.requestedCapOutcomeAtoms,
    eligiblePairedBurnOutcomeAtoms: plan.eligiblePairedBurnOutcomeAtoms,
    pairedBurnOutcomeAtoms: plan.pairedBurnOutcomeAtoms,
    custodyUsdcAtoms: plan.custodyUsdcAtoms,
    usdcOutAtoms: plan.usdcOutAtoms,
    rebalanceSwapAmountIn: "0",
    leftoverYesAtoms: plan.leftoverYesAtoms,
    leftoverNoAtoms: plan.leftoverNoAtoms,
    uiSummary: plan.uiSummary,
    computeBudgetMicroLamports: microLamports,
    custodyOwner: custodyOwner.toBase58(),
    winningBurnOutcomeAtoms: plan.winningBurnOutcomeAtoms,
  };

  return {
    log: fullLog,
    serialized: tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
    recentBlockhash: blockhash,
    lastValidBlockHeight,
  };
}

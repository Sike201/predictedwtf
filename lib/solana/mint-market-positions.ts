/**
 * MVP "mint paired positions" bridge between **devnet USDC** (6 decimals) and YES/NO outcome
 * mints (9 decimals, SPL `mintAuthority` = market engine).
 *
 * **Why this exists:** Omnipair pools for prediction markets are YES/NO `swap` only (NO↔YES).
 * There is **no** in-pool USDC leg. Direct USDC→YES would need Jupiter or a pool that lists USDC,
 * or a custom program. This module implements the correct MVP path: user **locks USDC** to protocol
 * custody, and the **engine mints equal YES + NO** to the user so they can rebalance via the pool.
 *
 * Custody: `MINT_POSITIONS_CUSTODY_PUBKEY` or falling back to the market engine authority pubkey
 * (same wallet that can `mintTo` outcomes). USDC is transferred to that wallet's devnet USDC ATA.
 */
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

import { DEVNET_USDC_MINT } from "@/lib/solana/assets";
import { OUTCOME_MINT_DECIMALS } from "@/lib/solana/create-outcome-mints";

export const MINT_POSITIONS_USDC_DECIMALS = 6;

/** 1e9 outcome atoms per 1e6 USDC atoms (3 decimal places shift). */
const OUTCOME_PER_USDC_EXP =
  BigInt(OUTCOME_MINT_DECIMALS) - BigInt(MINT_POSITIONS_USDC_DECIMALS);

/** `10^(outcome_dp - usdc_dp)` for paired full-set ↔ USDC custody mapping. */
export function redemptionAtomsExponent(
  outcomeDecimals: number,
  usdcDecimals: number,
): bigint {
  if (outcomeDecimals < usdcDecimals) {
    throw new Error(
      "outcomeDecimals must be >= usdcDecimals for custody redemption mapping.",
    );
  }
  return BigInt(outcomeDecimals - usdcDecimals);
}

export function usdcBaseUnitsToOutcomeBaseUnitsDynamic(
  usdcAtoms: bigint,
  outcomeDecimals: number,
  usdcDecimals: number,
): bigint {
  return usdcAtoms * 10n ** redemptionAtomsExponent(outcomeDecimals, usdcDecimals);
}

/** Paired outcome atoms (same raw amount burned on YES and NO) → USDC atoms. */
export function pairedOutcomeAtomsToUsdcAtomsDynamic(
  outcomeAtoms: bigint,
  outcomeDecimals: number,
  usdcDecimals: number,
): bigint {
  if (outcomeAtoms <= 0n) return 0n;
  return outcomeAtoms / 10n ** redemptionAtomsExponent(outcomeDecimals, usdcDecimals);
}

export function floorOutcomeToUsdcRedemptionGrid(
  outcomeAtoms: bigint,
  outcomeDecimals: number,
  usdcDecimals: number,
): bigint {
  const grid = 10n ** redemptionAtomsExponent(outcomeDecimals, usdcDecimals);
  return (outcomeAtoms / grid) * grid;
}

/** Max paired-burn outcome atoms allowed by custody USDC balance (grid-aligned). */
export function maxPairedBurnOutcomeAtomsForCustodyUsdc(
  custodyUsdcAtoms: bigint,
  outcomeDecimals: number,
  usdcDecimals: number,
): bigint {
  if (custodyUsdcAtoms <= 0n) return 0n;
  const atoms = usdcBaseUnitsToOutcomeBaseUnitsDynamic(
    custodyUsdcAtoms,
    outcomeDecimals,
    usdcDecimals,
  );
  return floorOutcomeToUsdcRedemptionGrid(atoms, outcomeDecimals, usdcDecimals);
}

/** env: optional custodian wallet; if unset, callers should use engine authority pubkey */
export function getMintPositionsCustodyOwnerFromEnv(): PublicKey | null {
  const raw = process.env.MINT_POSITIONS_CUSTODY_PUBKEY?.trim();
  if (!raw) return null;
  try {
    return new PublicKey(raw);
  } catch {
    return null;
  }
}

/**
 * MVP mapping: USDC (6 dp) → outcome mint atoms (9 dp), preserving a simple 1 USDC : 1 outcome token UI
 * mapping at the token program level (1e6 USDC atoms → 1e9 outcome atoms each side).
 */
export function usdcBaseUnitsToOutcomeBaseUnits(usdcAtoms: bigint): bigint {
  return usdcBaseUnitsToOutcomeBaseUnitsDynamic(
    usdcAtoms,
    OUTCOME_MINT_DECIMALS,
    MINT_POSITIONS_USDC_DECIMALS,
  );
}

/** Inverse of `usdcBaseUnitsToOutcomeBaseUnits` — paired burn size → custody USDC atoms. */
export function outcomeBaseUnitsToUsdcBaseUnits(outcomeAtoms: bigint): bigint {
  return pairedOutcomeAtomsToUsdcAtomsDynamic(
    outcomeAtoms,
    OUTCOME_MINT_DECIMALS,
    MINT_POSITIONS_USDC_DECIMALS,
  );
}

/** Floor outcome atoms so USDC redemption is whole microunits (same as mint path). */
export function floorOutcomeAtomsToRedemptionGrid(outcomeAtoms: bigint): bigint {
  return floorOutcomeToUsdcRedemptionGrid(
    outcomeAtoms,
    OUTCOME_MINT_DECIMALS,
    MINT_POSITIONS_USDC_DECIMALS,
  );
}

export function parseOutcomeHumanToBaseUnits(amountHuman: string): bigint {
  const cleaned = amountHuman.replace(/[^0-9.]/g, "");
  if (!cleaned || cleaned === ".") return 0n;
  const [wholeRaw, fracRaw = ""] = cleaned.split(".");
  const whole = wholeRaw || "0";
  const fracPadded = (fracRaw + "0".repeat(OUTCOME_MINT_DECIMALS)).slice(
    0,
    OUTCOME_MINT_DECIMALS,
  );
  return (
    BigInt(whole) * 10n ** BigInt(OUTCOME_MINT_DECIMALS) +
    BigInt(fracPadded || "0")
  );
}

export function parseUsdcHumanToBaseUnits(usdcHuman: string): bigint {
  const cleaned = usdcHuman.replace(/[^0-9.]/g, "");
  if (!cleaned || cleaned === ".") return 0n;
  const [wholeRaw, fracRaw = ""] = cleaned.split(".");
  const whole = wholeRaw || "0";
  const fracPadded = (fracRaw + "0".repeat(MINT_POSITIONS_USDC_DECIMALS)).slice(
    0,
    MINT_POSITIONS_USDC_DECIMALS,
  );
  return (
    BigInt(whole) * 10n ** BigInt(MINT_POSITIONS_USDC_DECIMALS) +
    BigInt(fracPadded || "0")
  );
}

export type MintPositionsAccountsParams = {
  connection: Connection;
  /** Wallet receiving YES/NO and paying fees / USDC. */
  user: PublicKey;
  /** Outcome mint authority (must sign mint_to). */
  mintAuthority: PublicKey;
  /** Receives USDC (custody). */
  custodyOwner: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
  usdcMint: PublicKey;
  usdcAmountAtoms: bigint;
};

/** SPL Token classic program for devnet USDC + outcome mints in this app */
async function maybeIxCreateAtaIdempotent(params: {
  connection: Connection;
  payer: PublicKey;
  owner: PublicKey;
  mint: PublicKey;
}): Promise<TransactionInstruction | null> {
  const ata = getAssociatedTokenAddressSync(
    params.mint,
    params.owner,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const info = await params.connection.getAccountInfo(ata, "confirmed");
  if (info) return null;
  return createAssociatedTokenAccountIdempotentInstruction(
    params.payer,
    ata,
    params.owner,
    params.mint,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
}

/**
 * Build user-USDC-transfer + equal mint_to YES/NO instructions.
 * Caller must attach recent blockhash, set fee payer = user, and **partialSign(mintAuthority)**.
 */
export async function buildMintPositionsInstructions(
  p: MintPositionsAccountsParams,
  options?: { skipUsdcBalanceCheck?: boolean },
): Promise<{
  instructions: TransactionInstruction[];
  userUsdcAta: PublicKey;
  custodyUsdcAta: PublicKey;
  userYesAta: PublicKey;
  userNoAta: PublicKey;
  outcomeMintAtoms: bigint;
}> {
  const {
    connection,
    user,
    mintAuthority,
    custodyOwner,
    yesMint,
    noMint,
    usdcMint,
    usdcAmountAtoms,
  } = p;

  if (usdcAmountAtoms <= 0n) {
    throw new Error("USDC amount must be greater than zero.");
  }

  const outcomeMintAtoms = usdcBaseUnitsToOutcomeBaseUnits(usdcAmountAtoms);
  if (outcomeMintAtoms <= 0n) {
    throw new Error("Outcome mint amount rounded to zero.");
  }

  const userUsdcAta = getAssociatedTokenAddressSync(
    usdcMint,
    user,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const custodyUsdcAta = getAssociatedTokenAddressSync(
    usdcMint,
    custodyOwner,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

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

  const ixs: TransactionInstruction[] = [];

  const ixCustodyAta = await maybeIxCreateAtaIdempotent({
    connection,
    payer: mintAuthority,
    owner: custodyOwner,
    mint: usdcMint,
  });
  if (ixCustodyAta) ixs.push(ixCustodyAta);

  const ixUserUsdc = await maybeIxCreateAtaIdempotent({
    connection,
    payer: user,
    owner: user,
    mint: usdcMint,
  });
  if (ixUserUsdc) ixs.push(ixUserUsdc);

  const ixYes = await maybeIxCreateAtaIdempotent({
    connection,
    payer: user,
    owner: user,
    mint: yesMint,
  });
  if (ixYes) ixs.push(ixYes);

  const ixNo = await maybeIxCreateAtaIdempotent({
    connection,
    payer: user,
    owner: user,
    mint: noMint,
  });
  if (ixNo) ixs.push(ixNo);

  if (!options?.skipUsdcBalanceCheck) {
    try {
      const info = await getAccount(connection, userUsdcAta, "confirmed", TOKEN_PROGRAM_ID);
      if (info.amount < usdcAmountAtoms) {
        throw new Error(
          `Insufficient devnet USDC: need ${usdcAmountAtoms.toString()} atoms, have ${info.amount.toString()}.`,
        );
      }
    } catch (e) {
      if (
        e instanceof Error &&
        (e.message.startsWith("Insufficient") || e.message.includes("Insufficient"))
      ) {
        throw e;
      }
      throw new Error(
        "No devnet USDC token account — fund the wallet with devnet USDC first.",
      );
    }
  }

  ixs.push(
    createTransferInstruction(
      userUsdcAta,
      custodyUsdcAta,
      user,
      usdcAmountAtoms,
      [],
      TOKEN_PROGRAM_ID,
    ),
  );

  ixs.push(
    createMintToInstruction(
      yesMint,
      userYesAta,
      mintAuthority,
      outcomeMintAtoms,
      [],
      TOKEN_PROGRAM_ID,
    ),
    createMintToInstruction(
      noMint,
      userNoAta,
      mintAuthority,
      outcomeMintAtoms,
      [],
      TOKEN_PROGRAM_ID,
    ),
  );

  return {
    instructions: ixs,
    userUsdcAta,
    custodyUsdcAta,
    userYesAta,
    userNoAta,
    outcomeMintAtoms,
  };
}

/**
 * Assemble + engine-partial-sign. Client adds user signature and broadcasts.
 */
export async function buildMintPositionsTransactionEngineSigned(params: {
  connection: Connection;
  /** Loaded engine keypair — must equal `mintAuthority` used at market creation */
  engine: Keypair;
  user: PublicKey;
  /** Defaults to `engine.publicKey` when env unset */
  custodyOwner?: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
  usdcMint?: PublicKey;
  usdcAmountAtoms: bigint;
}): Promise<{
  serialized: Uint8Array;
  outcomeMintAtoms: bigint;
}> {
  const usdcMint = params.usdcMint ?? DEVNET_USDC_MINT;
  const custodyOwner =
    params.custodyOwner ??
    getMintPositionsCustodyOwnerFromEnv() ??
    params.engine.publicKey;

  const mintAuthority = params.engine.publicKey;
  const { instructions, outcomeMintAtoms } = await buildMintPositionsInstructions(
    {
      connection: params.connection,
      user: params.user,
      mintAuthority,
      custodyOwner,
      yesMint: params.yesMint,
      noMint: params.noMint,
      usdcMint,
      usdcAmountAtoms: params.usdcAmountAtoms,
    },
  );

  const tx = new Transaction();
  tx.add(...instructions);
  tx.feePayer = params.user;
  const { blockhash } = await params.connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.partialSign(params.engine);

  return {
    serialized: tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }),
    outcomeMintAtoms,
  };
}

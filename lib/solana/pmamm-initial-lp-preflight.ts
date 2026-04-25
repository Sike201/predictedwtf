import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
} from "@solana/spl-token";

import { PipelineStageError } from "@/lib/market/pipeline-errors";

/** Human-readable USDC (or other fixed-decimal collateral) for UI and errors. */
export function formatPmammCollateralHuman(
  amountAtoms: bigint,
  decimals: number,
): string {
  if (decimals <= 0) return amountAtoms.toString();
  const base = 10n ** BigInt(decimals);
  const whole = amountAtoms / base;
  const frac = amountAtoms % base;
  const fracStr = frac
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return fracStr.length > 0 ? `${whole}.${fracStr}` : `${whole}`;
}

export async function readPmammDepositorUsdcBalance(params: {
  connection: Connection;
  collateralMint: PublicKey;
  depositor: PublicKey;
}): Promise<{ ata: PublicKey; balanceAtoms: bigint }> {
  const { connection, collateralMint, depositor } = params;
  const ata = getAssociatedTokenAddressSync(
    collateralMint,
    depositor,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  let balanceAtoms = 0n;
  try {
    const acc = await getAccount(connection, ata, "confirmed");
    balanceAtoms = acc.amount;
  } catch {
    balanceAtoms = 0n;
  }
  return { ata, balanceAtoms };
}

/** Who funds the initial `deposit_liquidity` (server init authority vs creator wallet). */
export type PmammInitialLpDepositorRole =
  | "MARKET_ENGINE_AUTHORITY_SERVER"
  | "CREATOR_WALLET";

/**
 * Ensures the depositor has enough SPL collateral on the pmAMM USDC mint before sending seed `deposit_liquidity`.
 * Logs mint, wallet, ATA, balance, requirement, and decimals.
 */
export async function preflightPmammInitialLpUsdc(params: {
  connection: Connection;
  collateralMint: PublicKey;
  collateralDecimals: number;
  depositor: PublicKey;
  requiredAtoms: bigint;
  role: PmammInitialLpDepositorRole;
}): Promise<void> {
  const {
    connection,
    collateralMint,
    collateralDecimals,
    depositor,
    requiredAtoms,
    role,
  } = params;

  const { ata, balanceAtoms } = await readPmammDepositorUsdcBalance({
    connection,
    collateralMint,
    depositor,
  });

  const roleLabel =
    role === "MARKET_ENGINE_AUTHORITY_SERVER"
      ? "MARKET_ENGINE_AUTHORITY (server treasury — signs initial LP deposit)"
      : role === "CREATOR_WALLET"
        ? "CREATOR_WALLET (connected user — signs initial LP deposit)"
        : role;

  console.info("[predicted][pmamm] initial LP USDC preflight", {
    pmammUsdcMint: collateralMint.toBase58(),
    collateralDecimals,
    initialLpDepositorRole: roleLabel,
    initialLpDepositor: depositor.toBase58(),
    usdcSourceAta: ata.toBase58(),
    depositorUsdcBalanceAtoms: balanceAtoms.toString(),
    requiredDepositAtoms: requiredAtoms.toString(),
  });

  if (balanceAtoms < requiredAtoms) {
    const need = formatPmammCollateralHuman(requiredAtoms, collateralDecimals);
    const have = formatPmammCollateralHuman(balanceAtoms, collateralDecimals);
    console.warn("[predicted][pmamm] initial LP underfunded", {
      fundWallet: depositor.toBase58(),
      collateralMint: collateralMint.toBase58(),
      collateralDecimals,
    });
    const msg =
      role === "CREATOR_WALLET"
        ? `You need ${need} USDC, but your wallet has ${have} USDC.`
        : `Initial LP wallet needs ${need} USDC, but only has ${have} USDC.`;
    throw new PipelineStageError("FAILED_AT_PRECONDITION", msg);
  }
}

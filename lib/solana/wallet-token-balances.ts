import { Connection, PublicKey } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import { DEVNET_USDC_MINT } from "@/lib/solana/assets";
import { TOKEN_2022_PROGRAM_ID } from "@/lib/solana/omnipair-constants";

async function splProgramForMint(
  connection: Connection,
  mint: PublicKey,
): Promise<PublicKey> {
  const acc = await connection.getAccountInfo(mint, "confirmed");
  if (!acc) throw new Error(`Mint not found: ${mint.toBase58()}`);
  if (acc.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  return TOKEN_PROGRAM_ID;
}

export async function readWalletTokenBalance(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey,
): Promise<{ raw: bigint; decimals: number }> {
  const programId = await splProgramForMint(connection, mint);
  const ata = getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    programId,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const info = await connection.getAccountInfo(ata, "confirmed");
  if (!info) {
    const mintInfo = await getMint(connection, mint, undefined, programId);
    return { raw: 0n, decimals: mintInfo.decimals };
  }
  const account = await getAccount(connection, ata, "confirmed", info.owner);
  const mintInfo = await getMint(connection, mint, undefined, programId);
  return { raw: account.amount, decimals: mintInfo.decimals };
}

/** YES + NO outcome balances for a binary market pool. */
export async function readOutcomeBalances(
  connection: Connection,
  owner: PublicKey,
  yesMint: PublicKey,
  noMint: PublicKey,
): Promise<{
  yes: { raw: bigint; decimals: number };
  no: { raw: bigint; decimals: number };
}> {
  const [yes, no] = await Promise.all([
    readWalletTokenBalance(connection, owner, yesMint),
    readWalletTokenBalance(connection, owner, noMint),
  ]);
  return { yes, no };
}

export async function readUsdcBalance(
  connection: Connection,
  owner: PublicKey,
): Promise<{ raw: bigint; decimals: number }> {
  return readWalletTokenBalance(connection, owner, DEVNET_USDC_MINT);
}

/** Trim trailing zeros after decimal point. */
export function formatBaseUnitsToDecimalString(
  raw: bigint,
  decimals: number,
  maxFractionDigits = 8,
): string {
  if (decimals === 0) return raw.toString();
  const neg = raw < 0n;
  const abs = neg ? -raw : raw;
  const whole = abs / 10n ** BigInt(decimals);
  let frac = abs % 10n ** BigInt(decimals);
  if (frac === 0n) return (neg ? "-" : "") + whole.toString();
  let fracStr = frac.toString().padStart(decimals, "0");
  fracStr = fracStr.slice(0, maxFractionDigits).replace(/0+$/, "");
  if (!fracStr) return (neg ? "-" : "") + whole.toString();
  return `${neg ? "-" : ""}${whole.toString()}.${fracStr}`;
}

export function parseDecimalStringToBaseUnits(
  human: string,
  decimals: number,
): bigint {
  const cleaned = human.replace(/[^0-9.]/g, "");
  if (!cleaned || cleaned === ".") return 0n;
  const [w = "0", f = ""] = cleaned.split(".");
  const frac = (f + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(w) * 10n ** BigInt(decimals) + BigInt(frac || "0");
}

/** `pct` is 0–100; uses integer math on base units. */
export function percentOfBalance(balance: bigint, pct: number): bigint {
  if (balance <= 0n || pct <= 0) return 0n;
  if (pct >= 100) return balance;
  const bps = Math.round(pct * 100);
  return (balance * BigInt(bps)) / 10000n;
}

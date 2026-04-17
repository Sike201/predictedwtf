import { Connection, PublicKey } from "@solana/web3.js";
import { getAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { decodeOmnipairPairAccount } from "@/lib/solana/decode-omnipair-accounts";
import { DEFAULT_OMNIPAIR_POOL_PARAMS } from "@/lib/solana/omnipair-params-hash";
import { deriveOmnipairLayout } from "@/lib/solana/omnipair-pda";
import { requireOmnipairProgramId } from "@/lib/solana/omnipair-program";

/** On-chain Omnipair pool snapshot for YES/NO binary markets. */
export type OmnipairPoolChainState = {
  pairAddress: string;
  token0Mint: string;
  token1Mint: string;
  yesMint: string;
  noMint: string;
  /** Whether YES mint is lexicographically token0. */
  yesIsToken0: boolean;
  decimalsYes: number;
  decimalsNo: number;
  /** Reserve vault SPL balances (canonical for display). */
  reserveYes: bigint;
  reserveNo: bigint;
  reserve0Vault: string;
  reserve1Vault: string;
  vault0Amount: bigint;
  vault1Amount: bigint;
  /** Cached reserves inside the pair account (should match vaults after instruction sync). */
  pairReserve0: bigint;
  pairReserve1: bigint;
};

/**
 * Loads the Omnipair pair account, derives reserve vault PDAs, and reads SPL token vault balances.
 * Reserves used for pricing are the vault amounts (user-facing “what’s in the pool”).
 */
export async function readOmnipairPoolState(
  connection: Connection,
  params: {
    pairAddress: PublicKey;
    yesMint: PublicKey;
    noMint: PublicKey;
  },
): Promise<OmnipairPoolChainState> {
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

  const pairInfo = await connection.getAccountInfo(params.pairAddress, "confirmed");
  if (!pairInfo?.data) {
    throw new Error("Omnipair pair account missing");
  }
  const decoded = decodeOmnipairPairAccount(pairInfo.data);

  const vault0 = await getAccount(
    connection,
    layout.reserve0Vault,
    "confirmed",
    TOKEN_PROGRAM_ID,
  );
  const vault1 = await getAccount(
    connection,
    layout.reserve1Vault,
    "confirmed",
    TOKEN_PROGRAM_ID,
  );

  const yesIsToken0 = params.yesMint.equals(layout.token0Mint);
  const reserveYes = yesIsToken0 ? vault0.amount : vault1.amount;
  const reserveNo = yesIsToken0 ? vault1.amount : vault0.amount;
  const decimalsYes = yesIsToken0 ? decoded.token0Decimals : decoded.token1Decimals;
  const decimalsNo = yesIsToken0 ? decoded.token1Decimals : decoded.token0Decimals;

  if (process.env.NODE_ENV === "development") {
    console.info(
      "[predicted][read-pool]",
      JSON.stringify({
        token0Mint: layout.token0Mint.toBase58(),
        token1Mint: layout.token1Mint.toBase58(),
        reserveVault0Balance: vault0.amount.toString(),
        reserveVault1Balance: vault1.amount.toString(),
        marketYesMint: params.yesMint.toBase58(),
        marketNoMint: params.noMint.toBase58(),
        reserveYes: reserveYes.toString(),
        reserveNo: reserveNo.toString(),
        yesIsToken0,
      }),
    );
  }

  return {
    pairAddress: params.pairAddress.toBase58(),
    token0Mint: layout.token0Mint.toBase58(),
    token1Mint: layout.token1Mint.toBase58(),
    yesMint: params.yesMint.toBase58(),
    noMint: params.noMint.toBase58(),
    yesIsToken0,
    decimalsYes,
    decimalsNo,
    reserveYes,
    reserveNo,
    reserve0Vault: layout.reserve0Vault.toBase58(),
    reserve1Vault: layout.reserve1Vault.toBase58(),
    vault0Amount: vault0.amount,
    vault1Amount: vault1.amount,
    pairReserve0: decoded.reserve0,
    pairReserve1: decoded.reserve1,
  };
}

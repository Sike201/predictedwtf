import { AccountLayout, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  type AccountInfo,
  Connection,
  PublicKey,
} from "@solana/web3.js";

import { decodeOmnipairPairAccount } from "@/lib/solana/decode-omnipair-accounts";
import { DEFAULT_OMNIPAIR_POOL_PARAMS } from "@/lib/solana/omnipair-params-hash";
import { deriveOmnipairLayout } from "@/lib/solana/omnipair-pda";
import { requireOmnipairProgramId } from "@/lib/solana/omnipair-program";

function splTokenVaultAmountOrThrow(
  info: AccountInfo<Buffer> | null,
  label: string,
): bigint {
  if (!info?.data?.length) {
    throw new Error(`${label}: account missing`);
  }
  if (!info.owner.equals(TOKEN_PROGRAM_ID)) {
    throw new Error(`${label}: not a legacy SPL token account`);
  }
  if (info.data.length < AccountLayout.span) {
    throw new Error(`${label}: invalid token account data`);
  }
  return AccountLayout.decode(info.data).amount;
}

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
  /** Swap fee configured on the pair (basis points). */
  swapFeeBps: number;
  /** LP mint for this pair (pool shares). */
  lpMint: string;
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

  const [pairInfo, vault0Info, vault1Info] =
    await connection.getMultipleAccountsInfo(
      [params.pairAddress, layout.reserve0Vault, layout.reserve1Vault],
      "confirmed",
    );
  if (!pairInfo?.data) {
    throw new Error("Omnipair pair account missing");
  }
  const decoded = decodeOmnipairPairAccount(pairInfo.data);

  const vault0Amount = splTokenVaultAmountOrThrow(
    vault0Info,
    "Omnipair reserve vault 0",
  );
  const vault1Amount = splTokenVaultAmountOrThrow(
    vault1Info,
    "Omnipair reserve vault 1",
  );

  const yesIsToken0 = params.yesMint.equals(layout.token0Mint);
  const reserveYes = yesIsToken0 ? vault0Amount : vault1Amount;
  const reserveNo = yesIsToken0 ? vault1Amount : vault0Amount;
  const decimalsYes = yesIsToken0 ? decoded.token0Decimals : decoded.token1Decimals;
  const decimalsNo = yesIsToken0 ? decoded.token1Decimals : decoded.token0Decimals;

  if (process.env.NODE_ENV === "development") {
    console.info(
      "[predicted][read-pool]",
      JSON.stringify({
        token0Mint: layout.token0Mint.toBase58(),
        token1Mint: layout.token1Mint.toBase58(),
        reserveVault0Balance: vault0Amount.toString(),
        reserveVault1Balance: vault1Amount.toString(),
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
    vault0Amount,
    vault1Amount,
    pairReserve0: decoded.reserve0,
    pairReserve1: decoded.reserve1,
    swapFeeBps: decoded.swapFeeBps,
    lpMint: decoded.lpMint.toBase58(),
  };
}

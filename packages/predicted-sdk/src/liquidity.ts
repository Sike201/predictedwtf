import { Connection, Keypair, Transaction } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import { decodeOmnipairPairAccount } from "@/lib/solana/decode-omnipair-accounts";
import { buildProvideLiquidityWithUsdcTransactionEngineSigned } from "@/lib/solana/provide-liquidity-usdc";
import { buildWithdrawOmnipairLiquidityToUsdcTransactionEngineSigned } from "@/lib/solana/withdraw-omnipair-liquidity-to-usdc";
import { sendSignedTransaction } from "@/lib/solana/send-transaction";
import { parseUsdcHumanToBaseUnits } from "@/lib/solana/mint-market-positions";
import { solanaTransactionExplorerUrl } from "./explorer.js";
import type {
  DepositLiquidityResult,
  MarketRef,
  PredictedCluster,
  PredictedWallet,
  WithdrawLiquidityResult,
} from "./types.js";
import { humanToTokenAtoms, toPublicKey } from "./utils.js";

export type DepositLiquidityCallParams = {
  connection: Connection;
  engine: Keypair;
  wallet: PredictedWallet;
  cluster: PredictedCluster;
  market: MarketRef;
  /** Devnet USDC to convert into a balanced add (full-set mint + add_liquidity). */
  usdcAmount: string;
  slippageBps?: number;
  marketSlug?: string;
};

/**
 * **Devnet (current):** full-set USDC → YES+NO mint, then add_liquidity on the Omnipair pool.
 *
 * // TODO: mainnet — USDC leg + pool / custody alignment.
 */
export async function runDepositLiquidity(
  p: DepositLiquidityCallParams,
): Promise<DepositLiquidityResult> {
  const usdcAmountAtoms = parseUsdcHumanToBaseUnits(p.usdcAmount);
  if (usdcAmountAtoms <= 0n) {
    throw new Error("usdcAmount must be greater than zero.");
  }
  const { serialized, log } = await buildProvideLiquidityWithUsdcTransactionEngineSigned(
    {
      connection: p.connection,
      engine: p.engine,
      user: p.wallet.publicKey,
      yesMint: toPublicKey(p.market.yesMint, "yesMint"),
      noMint: toPublicKey(p.market.noMint, "noMint"),
      pairAddress: toPublicKey(p.market.pairAddress, "pairAddress"),
      usdcAmountAtoms,
      marketSlug: p.marketSlug,
      slippageBps: p.slippageBps,
    },
  );
  const tx = Transaction.from(serialized);
  const signature = await sendSignedTransaction({
    connection: p.connection,
    transaction: tx,
    signTransaction: (t) =>
      p.wallet.signTransaction(t as Transaction),
  });
  return {
    signature,
    explorerUrl: solanaTransactionExplorerUrl(signature, p.cluster),
    estimated: { lpTokens: log.estimatedLiquidityOut },
  };
}

export type WithdrawLiquidityCallParams = {
  connection: Connection;
  engine: Keypair;
  wallet: PredictedWallet;
  cluster: PredictedCluster;
  market: MarketRef;
  /**
   * Human LP size (omLP) — on-chain omLP decimal count is read from the LP mint; no raw units required.
   */
  lpAmount: string;
  slippageBps?: number;
  marketSlug?: string;
};

/**
 * **Devnet (current):** `remove_liquidity` and redeem to devnet USDC in one user + engine co-signed
 * transaction.
 *
 * // TODO: mainnet — custody / fee profile parity.
 */
export async function runWithdrawLiquidityToUsdc(
  p: WithdrawLiquidityCallParams,
): Promise<WithdrawLiquidityResult> {
  const pairAddress = toPublicKey(p.market.pairAddress, "pairAddress");
  const acc = await p.connection.getAccountInfo(pairAddress, "confirmed");
  if (!acc?.data) throw new Error("Omnipair pair account not found for pairAddress.");
  const decoded = decodeOmnipairPairAccount(acc.data);
  const lpDec = (await getMint(p.connection, decoded.lpMint, "confirmed")).decimals;
  const liquidityIn = humanToTokenAtoms(p.lpAmount, lpDec, "lpAmount");
  if (liquidityIn <= 0n) {
    throw new Error("lpAmount must be greater than zero.");
  }
  const { serialized, log } = await buildWithdrawOmnipairLiquidityToUsdcTransactionEngineSigned({
    connection: p.connection,
    engine: p.engine,
    user: p.wallet.publicKey,
    yesMint: toPublicKey(p.market.yesMint, "yesMint"),
    noMint: toPublicKey(p.market.noMint, "noMint"),
    pairAddress,
    liquidityIn,
    marketSlug: p.marketSlug,
    slippageBps: p.slippageBps,
  });
  const tx = Transaction.from(serialized);
  const signature = await sendSignedTransaction({
    connection: p.connection,
    transaction: tx,
    signTransaction: (t) =>
      p.wallet.signTransaction(t as Transaction),
  });
  return {
    signature,
    explorerUrl: solanaTransactionExplorerUrl(signature, p.cluster),
    estimated: { usdcOut: log.redeem.usdcOutAtoms },
  };
}

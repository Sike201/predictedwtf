import { Connection, Keypair, Transaction, type PublicKey } from "@solana/web3.js";
import { buildBuyOutcomeWithUsdcTransactionEngineSigned } from "@/lib/solana/buy-outcome-with-usdc";
import { buildSellOutcomeForUsdcTransactionEngineSigned } from "@/lib/solana/sell-outcome-for-usdc";
import { sendSignedTransaction } from "@/lib/solana/send-transaction";
import { parseUsdcHumanToBaseUnits } from "@/lib/solana/mint-market-positions";
import { solanaTransactionExplorerUrl } from "./explorer.js";
import type {
  BuyOutcomeResult,
  MarketRef,
  PredictedCluster,
  PredictedWallet,
  SellOutcomeResult,
} from "./types.js";
import { toPublicKey } from "./utils.js";

export type BuyOutcomeCallParams = {
  connection: Connection;
  engine: Keypair;
  wallet: PredictedWallet;
  cluster: PredictedCluster;
  market: MarketRef;
  side: "yes" | "no";
  /** Devnet USDC, e.g. "25.5" (6 dp). */
  usdcAmount: string;
  slippageBps?: number;
  marketSlug?: string;
};

/**
 * **Devnet (current):** mint YES+NO from USDC via custody, then directionally swap the unwanted leg
 * on Omnipair (USDC is never the pool asset; this route matches the app).
 *
 * // TODO: mainnet USDC mint + verified custody and pool deployment id.
 */
export async function runBuyOutcome(
  p: BuyOutcomeCallParams,
): Promise<BuyOutcomeResult> {
  const usdcAmountAtoms = parseUsdcHumanToBaseUnits(p.usdcAmount);
  if (usdcAmountAtoms <= 0n) {
    throw new Error("usdcAmount must be greater than zero.");
  }
  const { serialized, log } = await buildBuyOutcomeWithUsdcTransactionEngineSigned({
    connection: p.connection,
    engine: p.engine,
    user: p.wallet.publicKey,
    side: p.side,
    yesMint: toPublicKey(p.market.yesMint, "yesMint"),
    noMint: toPublicKey(p.market.noMint, "noMint"),
    pairAddress: toPublicKey(p.market.pairAddress, "pairAddress"),
    usdcAmountAtoms,
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
    estimated: { chosenSideTokens: log.estimatedFinalChosenSideAtoms },
  };
}

export type SellOutcomeCallParams = {
  connection: Connection;
  engine: Keypair;
  wallet: PredictedWallet;
  cluster: PredictedCluster;
  market: MarketRef;
  side: "yes" | "no";
  /** Outcome size on the selling leg (outcome human string, 9 dp on devnet). */
  outcomeAmount: string;
  slippageBps?: number;
  marketSlug?: string;
};

/**
 * **Devnet (current):** best-effort paired burn + custody USDC, with optional AMM leg.
 *
 * // TODO: mainnet USDC + custody invariants and routing parity with production.
 */
export async function runSellOutcome(
  p: SellOutcomeCallParams,
): Promise<SellOutcomeResult> {
  const { serialized, log } = await buildSellOutcomeForUsdcTransactionEngineSigned({
    connection: p.connection,
    engine: p.engine,
    user: p.wallet.publicKey,
    side: p.side,
    yesMint: toPublicKey(p.market.yesMint, "yesMint"),
    noMint: toPublicKey(p.market.noMint, "noMint"),
    pairAddress: toPublicKey(p.market.pairAddress, "pairAddress"),
    outcomeAmountHuman: p.outcomeAmount,
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
    estimated: { usdcOut: log.usdcOutAtoms },
    summary: log.uiSummary,
  };
}

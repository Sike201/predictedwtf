import { Keypair, Transaction, type Connection } from "@solana/web3.js";
import { buildResolvedWinnerRedeemTransactionEngineSigned } from "@/lib/solana/resolved-winner-redeem-usdc";
import { sendSignedTransaction } from "@/lib/solana/send-transaction";
import { solanaTransactionExplorerUrl } from "./explorer.js";
import type { MarketRef, PredictedCluster, PredictedWallet, ResolveMarketResult } from "./types.js";
import { toPublicKey } from "./utils.js";

export type ResolveMarketCallParams = {
  connection: Connection;
  engine: Keypair;
  wallet: PredictedWallet;
  cluster: PredictedCluster;
  market: MarketRef;
  /**
   * Which side you are redeeming (must equal `winningOutcome` after on-chain or social resolution
   * for this market).
   */
  side: "yes" | "no";
  /** Declared resolution outcome. */
  winningOutcome: "yes" | "no";
  /**
   * Human burn size on the winning leg (9 dp on devnet; matches the app’s outcome inputs).
   */
  outcomeAmount: string;
  marketSlug?: string;
};

/**
 * **Devnet (current):** after a market is resolved, burn winning tokens for devnet USDC at custody
 * parity. This is *not* an oracle/resolve instruction; it is the user redemption path once the
 * winning outcome is known.
 *
 * // TODO: mainnet — custody limits, KYC, and on-chain attestation of resolution if applicable.
 */
export async function runResolveMarketRedemption(
  p: ResolveMarketCallParams,
): Promise<ResolveMarketResult> {
  const { log, serialized } = await buildResolvedWinnerRedeemTransactionEngineSigned({
    connection: p.connection,
    user: p.wallet.publicKey,
    side: p.side,
    winningOutcome: p.winningOutcome,
    yesMint: toPublicKey(p.market.yesMint, "yesMint"),
    noMint: toPublicKey(p.market.noMint, "noMint"),
    poolAddress: toPublicKey(p.market.pairAddress, "pairAddress"),
    outcomeAmountHuman: p.outcomeAmount,
    marketSlug: p.marketSlug,
    engine: p.engine,
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

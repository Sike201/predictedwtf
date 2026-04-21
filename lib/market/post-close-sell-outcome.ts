"use client";

/**
 * Optional follow-up: sell outcome tokens for USDC via `/api/market/sell-outcome`.
 * Default “Close position” in the app unwinds to YES/NO in the user wallet only — use this
 * when building a separate explicit “Close to USDC” (or similar) action.
 */

import {
  Connection,
  PublicKey,
  SendTransactionError,
  Transaction,
} from "@solana/web3.js";

import type { Market } from "@/lib/types/market";
import { isDuplicateSolanaSubmitError } from "@/lib/market/solana-submit-errors";
import type { SellOutcomeForUsdcBuildLog } from "@/lib/solana/sell-outcome-for-usdc";
import {
  formatBaseUnitsToDecimalString,
  readOutcomeBalances,
  readUsdcBalance,
} from "@/lib/solana/wallet-token-balances";

const LOG = "[predicted][post-close-usdc]";

function errorText(e: unknown): string {
  if (e instanceof SendTransactionError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

function dustThresholdAtoms(decimals: number): bigint {
  return 10n ** BigInt(Math.max(0, decimals - 3));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type PostCloseUsdcSettlement = {
  sellSignatures: string[];
  totalUsdcOutAtoms: bigint;
  buildLogs: SellOutcomeForUsdcBuildLog[];
  lastError: string | null;
  finalYesRaw: bigint;
  finalNoRaw: bigint;
  finalUsdcRaw: bigint;
  yesDecimals: number;
  noDecimals: number;
};

/**
 * After a close-leverage tx, convert free YES/NO in the wallet to USDC via the same
 * `/api/market/sell-outcome` path as the trading UI (engine-partial-signed burn + custody USDC).
 */
export async function sellWalletOutcomesToUsdcAfterClose(params: {
  market: Market;
  user: PublicKey;
  connection: Connection;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  /** Lending track that was closed — we try this side first when both have balance. */
  closedTrack: "yes" | "no";
}): Promise<PostCloseUsdcSettlement> {
  const { market, user, connection, signTransaction, closedTrack } = params;
  const sellSignatures: string[] = [];
  const buildLogs: SellOutcomeForUsdcBuildLog[] = [];
  let totalUsdcOutAtoms = 0n;
  let lastError: string | null = null;

  if (market.kind !== "binary" || !market.pool?.yesMint || !market.pool?.noMint) {
    return {
      sellSignatures,
      totalUsdcOutAtoms,
      buildLogs,
      lastError: "Market is not a binary pool — skipping USDC settlement.",
      finalYesRaw: 0n,
      finalNoRaw: 0n,
      finalUsdcRaw: 0n,
      yesDecimals: 9,
      noDecimals: 9,
    };
  }

  const yesMint = new PublicKey(market.pool.yesMint);
  const noMint = new PublicKey(market.pool.noMint);

  await sleep(400);

  for (let round = 0; round < 8; round++) {
    const outcomes = await readOutcomeBalances(connection, user, yesMint, noMint);
    const yd = outcomes.yes.decimals;
    const nd = outcomes.no.decimals;
    const ty = dustThresholdAtoms(yd);
    const tn = dustThresholdAtoms(nd);
    const yesRaw = outcomes.yes.raw;
    const noRaw = outcomes.no.raw;

    if (yesRaw <= ty && noRaw <= tn) {
      if (process.env.NODE_ENV === "development") {
        console.info(
          LOG,
          "sell_round_skip_dust",
          JSON.stringify({ round, yesRaw: yesRaw.toString(), noRaw: noRaw.toString() }),
        );
      }
      break;
    }

    let side: "yes" | "no";
    if (yesRaw > ty && noRaw > tn) {
      side = closedTrack;
    } else if (yesRaw > ty) {
      side = "yes";
    } else if (noRaw > tn) {
      side = "no";
    } else {
      break;
    }

    const raw = side === "yes" ? yesRaw : noRaw;
    const dec = side === "yes" ? yd : nd;
    const thr = side === "yes" ? ty : tn;
    if (raw <= thr) break;

    const outcomeAmountHuman = formatBaseUnitsToDecimalString(raw, dec, 12);

    if (process.env.NODE_ENV === "development") {
      console.info(
        LOG,
        "sell_request",
        JSON.stringify({
          round,
          side,
          outcomeAmountHuman,
          yesRaw: yesRaw.toString(),
          noRaw: noRaw.toString(),
        }),
      );
    }

    try {
      const res = await fetch("/api/market/sell-outcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: market.id,
          userWallet: user.toBase58(),
          outcomeAmountHuman,
          side,
        }),
      });

      const data = (await res.json()) as {
        error?: string;
        transaction?: string;
        log?: SellOutcomeForUsdcBuildLog;
        recentBlockhash?: string;
        lastValidBlockHeight?: number;
      };

      if (!res.ok || data.error || !data.transaction) {
        throw new Error(data.error ?? "Sell request failed");
      }

      const tx = Transaction.from(Buffer.from(data.transaction, "base64"));
      const signed = await signTransaction(tx);
      const rawBytes = signed.serialize();

      if (process.env.NODE_ENV === "development") {
        console.info(LOG, "sell_tx_send", JSON.stringify({ side, bytes: rawBytes.length }));
      }

      const sig = await connection.sendRawTransaction(rawBytes, {
        skipPreflight: false,
        maxRetries: 0,
      });

      const bh =
        data.recentBlockhash ?? data.log?.recentBlockhash ?? tx.recentBlockhash;
      const lvh = data.lastValidBlockHeight ?? data.log?.lastValidBlockHeight;

      if (bh != null && lvh != null) {
        await connection.confirmTransaction(
          { signature: sig, blockhash: bh, lastValidBlockHeight: lvh },
          "confirmed",
        );
      } else {
        await connection.confirmTransaction(sig, "confirmed");
      }

      sellSignatures.push(sig);
      if (data.log) buildLogs.push(data.log);
      const atoms = data.log?.usdcOutAtoms;
      if (atoms != null && /^\d+$/.test(atoms)) {
        totalUsdcOutAtoms += BigInt(atoms);
      }

      if (process.env.NODE_ENV === "development") {
        console.info(
          LOG,
          "sell_tx_confirmed",
          JSON.stringify({ signature: sig, usdcOutAtoms: data.log?.usdcOutAtoms }),
        );
      }
    } catch (e: unknown) {
      const raw = errorText(e);
      if (isDuplicateSolanaSubmitError(raw)) {
        if (process.env.NODE_ENV === "development") {
          console.warn(LOG, "sell_duplicate_submit", JSON.stringify({ message: raw }));
        }
        await sleep(600);
        continue;
      }
      lastError = raw;
      if (process.env.NODE_ENV === "development") {
        console.warn(LOG, "sell_error", JSON.stringify({ message: raw }));
      }
      break;
    }
  }

  const finalOutcomes = await readOutcomeBalances(connection, user, yesMint, noMint);
  const finalUsdc = await readUsdcBalance(connection, user);

  if (process.env.NODE_ENV === "development") {
    console.info(
      LOG,
      "wallet_balances_after_settlement",
      JSON.stringify({
        yes: finalOutcomes.yes.raw.toString(),
        no: finalOutcomes.no.raw.toString(),
        usdc: finalUsdc.raw.toString(),
      }),
    );
  }

  return {
    sellSignatures,
    totalUsdcOutAtoms,
    buildLogs,
    lastError,
    finalYesRaw: finalOutcomes.yes.raw,
    finalNoRaw: finalOutcomes.no.raw,
    finalUsdcRaw: finalUsdc.raw,
    yesDecimals: finalOutcomes.yes.decimals,
    noDecimals: finalOutcomes.no.decimals,
  };
}

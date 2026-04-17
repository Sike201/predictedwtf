"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { useWallet } from "@/lib/hooks/use-wallet";
import type { Market } from "@/lib/types/market";
import type { BuyOutcomeWithUsdcBuildLog } from "@/lib/solana/buy-outcome-with-usdc";
import type { TradeOutcomeSide } from "@/lib/solana/trade-outcome";
import { cn } from "@/lib/utils/cn";

type MarketTradingPrimaryButtonProps = {
  className?: string;
  market: Market;
  side: TradeOutcomeSide;
  /** Devnet USDC amount (human, 6 dp). */
  usdcAmountHuman: string;
  buyLabel: string;
  /**
   * Called after the transaction is confirmed on-chain. Parent can show signature + explorer.
   */
  onTradeSuccess?: (args: {
    signature: string;
    side: TradeOutcomeSide;
    usdcAmountHuman: string;
    /** Optional label (e.g. date window) for analytics / recent txs. */
    outcomeDetail?: string;
  }) => void;
  /** Passed through to `onTradeSuccess` when provided. */
  outcomeDetail?: string;
};

function isAlreadyProcessedError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("already been processed") ||
    m.includes("already processed") ||
    m.includes("transactionalreadyprocessed")
  );
}

function formatTradeError(e: unknown): string {
  if (e instanceof Error) {
    if (isAlreadyProcessedError(e.message)) {
      return "This order was already submitted. Refreshing market state...";
    }
    return e.message;
  }
  const s = String(e);
  if (isAlreadyProcessedError(s)) {
    return "This order was already submitted. Refreshing market state...";
  }
  return s;
}

/**
 * USDC-native buy: server builds mint (engine) + Omnipair swap; user signs once.
 */
export function MarketTradingPrimaryButton({
  className,
  market,
  side,
  usdcAmountHuman,
  buyLabel,
  onTradeSuccess,
  outcomeDetail,
}: MarketTradingPrimaryButtonProps) {
  const router = useRouter();
  const { connection } = useConnection();
  const {
    connected,
    connect,
    wallet,
    connecting,
    publicKey,
    signTransaction,
  } = useWallet();
  const { setVisible } = useWalletModal();
  const buyInFlightRef = useRef(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onClick = useCallback(async () => {
    if (buyInFlightRef.current) {
      console.info(
        "[predicted][buy-outcome-usdc] client: ignored duplicate click (in flight)",
      );
      return;
    }

    if (!connected || !publicKey || !signTransaction) {
      if (wallet) {
        try {
          await connect();
        } catch {
          setVisible(true);
        }
        return;
      }
      setVisible(true);
      return;
    }

    buyInFlightRef.current = true;
    setSubmitting(true);
    setFeedback(null);

    if (market.kind !== "binary") {
      setFeedback("Buys are enabled for binary YES/NO markets only.");
      buyInFlightRef.current = false;
      setSubmitting(false);
      return;
    }

    try {
      console.info(
        "[predicted][buy-outcome-usdc] client: buy request start",
        JSON.stringify({
          market: market.id,
          user: publicKey.toBase58(),
          side,
          usdcAmountHuman,
        }),
      );

      const res = await fetch("/api/market/buy-outcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: market.id,
          userWallet: publicKey.toBase58(),
          usdcAmountHuman,
          side,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        transaction?: string;
        log?: BuyOutcomeWithUsdcBuildLog;
        recentBlockhash?: string;
        lastValidBlockHeight?: number;
      };
      if (!res.ok || data.error || !data.transaction) {
        throw new Error(data.error ?? "Buy request failed");
      }

      console.info(
        "[predicted][buy-outcome-usdc] client: transaction received from API",
        JSON.stringify({
          recentBlockhash: data.recentBlockhash ?? data.log?.recentBlockhash,
          lastValidBlockHeight:
            data.lastValidBlockHeight ?? data.log?.lastValidBlockHeight,
          buildLog: data.log ?? null,
        }),
      );

      const tx = Transaction.from(Buffer.from(data.transaction, "base64"));
      if (data.recentBlockhash && tx.recentBlockhash !== data.recentBlockhash) {
        console.warn(
          "[predicted][buy-outcome-usdc] client: deserialized tx blockhash mismatch",
          { tx: tx.recentBlockhash, api: data.recentBlockhash },
        );
      }

      console.info(
        "[predicted][buy-outcome-usdc] client: signing",
        JSON.stringify({
          recentBlockhash: tx.recentBlockhash,
          feePayer: tx.feePayer?.toBase58(),
        }),
      );

      const signed = await signTransaction(tx);

      const firstSig = signed.signatures[0]?.signature;
      if (firstSig) {
        console.info(
          "[predicted][buy-outcome-usdc] client: signature (before send)",
          bs58.encode(firstSig),
        );
      } else {
        console.info(
          "[predicted][buy-outcome-usdc] client: signature (before send) not available on signatures[0]",
        );
      }

      const raw = signed.serialize();
      console.info(
        "[predicted][buy-outcome-usdc] client: sendRawTransaction starting",
        JSON.stringify({ rawBytes: raw.length }),
      );

      const sig = await connection.sendRawTransaction(raw, {
        skipPreflight: false,
      });

      console.info(
        "[predicted][buy-outcome-usdc] client: sendRawTransaction complete",
        JSON.stringify({ signature: sig }),
      );

      const bh =
        data.recentBlockhash ?? data.log?.recentBlockhash ?? tx.recentBlockhash;
      const lvh = data.lastValidBlockHeight ?? data.log?.lastValidBlockHeight;

      if (bh !== undefined && lvh !== undefined) {
        console.info(
          "[predicted][buy-outcome-usdc] client: confirming (block height strategy)",
          JSON.stringify({
            signature: sig,
            blockhash: bh,
            lastValidBlockHeight: lvh,
          }),
        );
        await connection.confirmTransaction(
          {
            signature: sig,
            blockhash: bh,
            lastValidBlockHeight: lvh,
          },
          "confirmed",
        );
      } else {
        console.info(
          "[predicted][buy-outcome-usdc] client: confirming (signature-only)",
          JSON.stringify({ signature: sig }),
        );
        await connection.confirmTransaction(sig, "confirmed");
      }

      console.info(
        "[predicted][buy-outcome-usdc] client: confirmation complete",
        JSON.stringify({ signature: sig }),
      );

      console.info(
        "[predicted][buy-outcome-usdc] confirmed",
        JSON.stringify({
          signature: sig,
          user: publicKey.toBase58(),
          market: market.id,
          side,
          usdcAmountHuman,
          buildLog: data.log ?? null,
        }),
      );

      onTradeSuccess?.({
        signature: sig,
        side,
        usdcAmountHuman,
        outcomeDetail,
      });
      if (onTradeSuccess) {
        setFeedback(null);
      } else {
        setFeedback(`Confirmed. View: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
      }
    } catch (e) {
      const friendly = formatTradeError(e);
      setFeedback(friendly);
      if (
        typeof friendly === "string" &&
        friendly.includes("already submitted")
      ) {
        router.refresh();
      }
    } finally {
      buyInFlightRef.current = false;
      setSubmitting(false);
    }
  }, [
    connect,
    connected,
    connection,
    market,
    publicKey,
    router,
    setVisible,
    side,
    onTradeSuccess,
    outcomeDetail,
    signTransaction,
    usdcAmountHuman,
    wallet,
  ]);

  const label = connected
    ? buyLabel
    : connecting
      ? "Connecting…"
      : "Connect wallet";

  const canSubmit =
    connected &&
    !!publicKey &&
    !!signTransaction &&
    !submitting &&
    !connecting &&
    (Number.parseFloat(usdcAmountHuman.replace(/[^0-9.]/g, "")) || 0) > 0;

  return (
    <div className="mt-4 space-y-2">
      <button
        type="button"
        onClick={onClick}
        disabled={connected ? !canSubmit : connecting}
        className={cn(
          "relative z-10 w-full rounded-full bg-white py-3 text-[13px] font-semibold text-black transition hover:bg-zinc-100 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      >
        {connected && submitting ? "Processing…" : label}
      </button>
      {feedback ? (
        <p
          className="text-center text-[11px] leading-snug text-zinc-500"
          role="status"
          aria-live="polite"
        >
          {feedback}
        </p>
      ) : null}
    </div>
  );
}

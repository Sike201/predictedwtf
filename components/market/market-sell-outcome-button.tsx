"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { useWallet } from "@/lib/hooks/use-wallet";
import type { Market } from "@/lib/types/market";
import { logOmnipairPoolBeforeTrade } from "@/lib/market/pool-state-debug";
import type {
  SellOutcomeForUsdcBuildLog,
  SellOutcomeSide,
} from "@/lib/solana/sell-outcome-for-usdc";
import { cn } from "@/lib/utils/cn";

type MarketSellOutcomeButtonProps = {
  className?: string;
  market: Market;
  sellSide: SellOutcomeSide;
  outcomeAmountHuman: string;
  sellLabel: string;
  onTradeSuccess?: (args: {
    signature: string;
    sellSide: SellOutcomeSide;
    outcomeAmountHuman: string;
    /** devnet USDC atoms from settlement log */
    usdcOutAtoms: string;
    buildLog?: SellOutcomeForUsdcBuildLog;
  }) => void;
};

function isAlreadyProcessedError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("already been processed") ||
    m.includes("already processed") ||
    m.includes("transactionalreadyprocessed")
  );
}

function formatSellError(e: unknown): string {
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
 * USDC-native sell: server builds optional Omnipair rebalance + paired burn + custody USDC to user.
 */
export function MarketSellOutcomeButton({
  className,
  market,
  sellSide,
  outcomeAmountHuman,
  sellLabel,
  onTradeSuccess,
}: MarketSellOutcomeButtonProps) {
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
  const inFlightRef = useRef(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onClick = useCallback(async () => {
    if (inFlightRef.current) {
      console.info(
        "[predicted][sell-outcome-usdc] client: ignored duplicate click",
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

    inFlightRef.current = true;
    setSubmitting(true);
    setFeedback(null);

    if (market.kind !== "binary") {
      setFeedback("Sells are enabled for binary YES/NO markets only.");
      inFlightRef.current = false;
      setSubmitting(false);
      return;
    }

    try {
      console.info("[predicted][sell-volume-trace]", {
        step: "sell_click",
        marketSlug: market.id,
        sellSide,
      });
      console.info(
        "[predicted][sell-outcome-usdc] client: request start",
        JSON.stringify({
          market: market.id,
          user: publicKey.toBase58(),
          side: sellSide,
          outcomeAmountHuman,
        }),
      );

      const res = await fetch("/api/market/sell-outcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: market.id,
          userWallet: publicKey.toBase58(),
          outcomeAmountHuman,
          side: sellSide,
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

      console.info(
        "[predicted][sell-outcome-usdc] client: tx from API",
        JSON.stringify({
          build: data.log ?? null,
          recentBlockhash: data.recentBlockhash ?? data.log?.recentBlockhash,
        }),
      );

      const tx = Transaction.from(Buffer.from(data.transaction, "base64"));
      const signed = await signTransaction(tx);

      const firstSig = signed.signatures[0]?.signature;
      if (firstSig) {
        console.info(
          "[predicted][sell-outcome-usdc] client: signature (before send)",
          bs58.encode(firstSig),
        );
      }

      const raw = signed.serialize();

      await logOmnipairPoolBeforeTrade(connection, market);

      const sig = await connection.sendRawTransaction(raw, {
        skipPreflight: false,
      });

      const bh =
        data.recentBlockhash ?? data.log?.recentBlockhash ?? tx.recentBlockhash;
      const lvh = data.lastValidBlockHeight ?? data.log?.lastValidBlockHeight;

      if (bh !== undefined && lvh !== undefined) {
        await connection.confirmTransaction(
          {
            signature: sig,
            blockhash: bh,
            lastValidBlockHeight: lvh,
          },
          "confirmed",
        );
      } else {
        await connection.confirmTransaction(sig, "confirmed");
      }

      const usdcOutAtoms = data.log?.usdcOutAtoms ?? "0";

      console.info("[predicted][sell-volume-trace]", {
        step: "tx_signature",
        marketSlug: market.id,
        txSignature: sig,
      });

      onTradeSuccess?.({
        signature: sig,
        sellSide,
        outcomeAmountHuman: outcomeAmountHuman.trim() || "0",
        usdcOutAtoms,
        buildLog: data.log,
      });
      if (onTradeSuccess) {
        setFeedback(null);
      }
    } catch (e) {
      const friendly = formatSellError(e);
      setFeedback(friendly);
      if (
        typeof friendly === "string" &&
        friendly.includes("already submitted")
      ) {
        router.refresh();
      }
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }, [
    connect,
    connected,
    connection,
    market,
    onTradeSuccess,
    outcomeAmountHuman,
    publicKey,
    router,
    sellSide,
    setVisible,
    signTransaction,
    wallet,
  ]);

  const label = connected
    ? sellLabel
    : connecting
      ? "Connecting…"
      : "Connect wallet";

  const parsed =
    Number.parseFloat(outcomeAmountHuman.replace(/[^0-9.]/g, "")) || 0;
  const canSubmit =
    connected &&
    !!publicKey &&
    !!signTransaction &&
    !submitting &&
    !connecting &&
    parsed > 0;

  return (
    <div className="mt-4 space-y-2">
      <button
        type="button"
        onClick={onClick}
        disabled={connected ? !canSubmit : connecting}
        className={cn(
          "relative z-10 w-full rounded-full bg-white/[0.08] py-3 text-[13px] font-semibold text-zinc-100 ring-1 ring-white/[0.1] transition hover:bg-white/[0.12] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50",
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

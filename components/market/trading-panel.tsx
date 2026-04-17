"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "@/lib/hooks/use-wallet";
import { useMarketTradingBalances } from "@/lib/hooks/use-market-trading-balances";
import type { Market } from "@/lib/types/market";
import { MarketOutcomeLeveragePanel } from "@/components/market/market-outcome-leverage-panel";
import { MarketSellOutcomeButton } from "@/components/market/market-sell-outcome-button";
import { MarketTradingPrimaryButton } from "@/components/market/market-trading-primary-button";
import { TxExplorerLink } from "@/components/market/tx-explorer-link";
import { pushRecentMarketTransaction } from "@/lib/market/recent-market-transactions";
import {
  formatBaseUnitsToDecimalString,
  percentOfBalance,
} from "@/lib/solana/wallet-token-balances";
import type {
  SellOutcomeForUsdcBuildLog,
  SellOutcomePlan,
  SellRouteKind,
} from "@/lib/solana/sell-outcome-for-usdc";
import {
  formatProbabilityAsWholeCents,
  formatUsdPerShareAsCents,
} from "@/lib/format/price-cents";
import type { OmnipairUserPositionSnapshot } from "@/lib/hooks/use-omnipair-user-position";
import { cn } from "@/lib/utils/cn";

function formatUsdcAtomsHuman(atoms: string): string {
  try {
    const a = BigInt(atoms);
    const whole = a / 1_000_000n;
    const frac = (a % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
    if (frac.length === 0) return `$${whole}.0`;
    return `$${whole}.${frac}`;
  } catch {
    return "—";
  }
}

function sellRouteHeadline(kind: SellRouteKind): string {
  switch (kind) {
    case "full_usdc_exit":
      return "Full USDC exit (est.)";
    case "partial_usdc_exit":
      return "Partial USDC exit (est.)";
    case "fallback_pool_swap":
      return "Pool swap to opposite side (est.)";
    default:
      return "Exit route";
  }
}

export type TradePanelMode = "buy_yes" | "buy_no" | "sell_yes" | "sell_no";

type TradingPanelProps = {
  market: Market;
  /** Live Omnipair-derived probabilities when provided (binary trading markets). */
  liveYesProbability?: number | null;
  liveNoProbability?: number | null;
  livePriceUnavailable?: boolean;
  /** Pool readable but one vault empty — do not show extreme mids as valid. */
  oneSidedLiquidity?: boolean;
  /** Called after a confirmed buy/sell so the parent can refetch pool state. */
  onPoolTxSettled?: () => void;
  /** Refetch lending position after a spot trade (shared with Your position). */
  onOmnipairRefresh?: () => void;
  /** Persist pool snapshot to `market_price_history` and refresh the probability chart. */
  onTradePriceSnapshot?: (txSignature: string) => void | Promise<void>;
  /** Omnipair snapshot for the **Leverage** tab (binary + pool). */
  omnipairSnapshot?: OmnipairUserPositionSnapshot | null;
  /** After leverage tx — refetch position and pool (same as `onOmnipairRefresh` + pool). */
  onLeverageAfterTx?: () => void | Promise<void>;
};

type Tab = "buy" | "sell" | "leverage";
type BuyExposureEstimate = {
  estimatedFinalChosenSideAtoms: string;
};

/** Premium white primary CTA — shared by buy / sell Trade */
const tradeButtonClass =
  "min-h-[48px] rounded-2xl border border-white/10 bg-white py-3.5 text-[14px] font-semibold tracking-tight text-neutral-950 ring-0 " +
  "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.9),0_10px_28px_-8px_rgba(0,0,0,0.65),0_0_0_1px_rgba(0,0,0,0.12)] " +
  "transition duration-200 ease-out " +
  "hover:border-white/20 hover:bg-zinc-50 hover:shadow-[inset_0_1px_0_0_rgb(255,255,255),0_14px_40px_-10px_rgba(0,0,0,0.55)] " +
  "active:scale-[0.985] active:bg-zinc-100 active:shadow-[inset_0_1px_1px_rgba(0,0,0,0.06)] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:ring-offset-2 focus-visible:ring-offset-[#111] " +
  "disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-white/[0.06] disabled:bg-white/[0.65] disabled:text-neutral-500 disabled:shadow-none";

export function TradingPanel({
  market,
  liveYesProbability,
  liveNoProbability,
  livePriceUnavailable,
  oneSidedLiquidity,
  onPoolTxSettled,
  onOmnipairRefresh,
  onTradePriceSnapshot,
  omnipairSnapshot,
  onLeverageAfterTx,
}: TradingPanelProps) {
  const router = useRouter();
  const { publicKey, connected } = useWallet();
  const balances = useMarketTradingBalances(market, publicKey);

  const [tab, setTab] = useState<Tab>("buy");
  const [outcome, setOutcome] = useState<"yes" | "no">("yes");
  const [usdcAmount, setUsdcAmount] = useState("");
  const [outcomeAmount, setOutcomeAmount] = useState("");
  const [sellPlan, setSellPlan] = useState<SellOutcomePlan | null>(null);
  const [sellPlanLoading, setSellPlanLoading] = useState(false);
  const [sellPlanError, setSellPlanError] = useState<string | null>(null);
  const [buyExposureEstimate, setBuyExposureEstimate] =
    useState<BuyExposureEstimate | null>(null);
  const [buyExposureLoading, setBuyExposureLoading] = useState(false);
  const [buyExposureError, setBuyExposureError] = useState<string | null>(null);
  const [tradeSuccess, setTradeSuccess] = useState<{
    signature: string;
    action:
      | "buy_yes"
      | "buy_no"
      | "sell_yes"
      | "sell_no";
    amountLabel: string;
    receiveNote?: string;
  } | null>(null);

  const refreshOmnipairPosition = onOmnipairRefresh ?? (() => {});

  const showLeverageTab =
    market.kind === "binary" &&
    !!market.pool?.poolId &&
    typeof onLeverageAfterTx === "function";

  useEffect(() => {
    setTradeSuccess(null);
  }, [usdcAmount, outcomeAmount, tab, outcome]);

  useEffect(() => {
    if (tab !== "sell" || market.kind !== "binary") {
      setSellPlan(null);
      setSellPlanError(null);
      setSellPlanLoading(false);
      return;
    }

    const trimmed = outcomeAmount.trim();
    const parsed = Number.parseFloat(trimmed.replace(/[^0-9.]/g, "")) || 0;
    if (!connected || !publicKey || parsed <= 0) {
      setSellPlan(null);
      setSellPlanError(null);
      setSellPlanLoading(false);
      return;
    }

    const ac = new AbortController();
    const t = window.setTimeout(() => {
      setSellPlanLoading(true);
      setSellPlanError(null);
      const qs = new URLSearchParams({
        slug: market.id,
        side: outcome === "yes" ? "yes" : "no",
        outcomeAmountHuman: trimmed,
        userWallet: publicKey.toBase58(),
      });
      fetch(`/api/market/sell-outcome?${qs.toString()}`, {
        signal: ac.signal,
        credentials: "same-origin",
      })
        .then(async (res) => {
          const data = (await res.json()) as {
            error?: string;
            plan?: SellOutcomePlan;
          };
          if (!res.ok || data.error) {
            throw new Error(data.error ?? "Could not estimate exit");
          }
          setSellPlan(data.plan ?? null);
        })
        .catch((e: unknown) => {
          if ((e as Error).name === "AbortError") return;
          setSellPlan(null);
          setSellPlanError(
            e instanceof Error ? e.message : "Could not estimate exit",
          );
        })
        .finally(() => {
          setSellPlanLoading(false);
        });
    }, 420);

    return () => {
      ac.abort();
      window.clearTimeout(t);
    };
  }, [tab, market.id, market.kind, outcomeAmount, outcome, connected, publicKey]);

  useEffect(() => {
    if (tab === "buy") setOutcomeAmount("");
    else if (tab === "sell") setUsdcAmount("");
    else if (tab === "leverage") {
      setUsdcAmount("");
      setOutcomeAmount("");
    }
  }, [tab]);

  useEffect(() => {
    if (tab === "sell") setOutcomeAmount("");
  }, [outcome, tab]);

  const isBuy = tab === "buy";
  const isSell = tab === "sell";
  const isLeverage = tab === "leverage";
  const buySide = outcome === "yes" ? "yes" : "no";

  const staticYes = market.pool?.yesPrice ?? market.yesProbability;
  const staticNo = market.pool?.noPrice ?? 1 - market.yesProbability;

  const hasLiveInputs =
    liveYesProbability !== undefined &&
    liveNoProbability !== undefined &&
    livePriceUnavailable !== undefined;

  const useLive =
    hasLiveInputs &&
    !livePriceUnavailable &&
    !oneSidedLiquidity &&
    liveYesProbability !== null &&
    liveNoProbability !== null;

  const yesP = useLive ? (liveYesProbability as number) : staticYes;
  const noP = useLive ? (liveNoProbability as number) : staticNo;
  const showPriceUnavailable =
    !!market.pool && livePriceUnavailable === true;

  const showOneSidedLiquidity =
    !!market.pool && oneSidedLiquidity === true;

  const parsedUsdc =
    Number.parseFloat(usdcAmount.replace(/[^0-9.]/g, "")) || 0;

  const parsedOutcome =
    Number.parseFloat(outcomeAmount.replace(/[^0-9.]/g, "")) || 0;
  const mid = buySide === "yes" ? yesP : noP;
  const estMid =
    showPriceUnavailable || showOneSidedLiquidity
      ? (buySide === "yes" ? staticYes : staticNo)
      : mid;
  useEffect(() => {
    if (tab !== "buy" || market.kind !== "binary") {
      setBuyExposureEstimate(null);
      setBuyExposureLoading(false);
      setBuyExposureError(null);
      return;
    }
    if (parsedUsdc <= 0 || !Number.isFinite(parsedUsdc)) {
      setBuyExposureEstimate(null);
      setBuyExposureLoading(false);
      setBuyExposureError(null);
      return;
    }
    const ac = new AbortController();
    const t = window.setTimeout(() => {
      setBuyExposureLoading(true);
      setBuyExposureError(null);
      fetch("/api/market/preview-buy-outcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ac.signal,
        credentials: "same-origin",
        body: JSON.stringify({
          slug: market.id,
          side: buySide,
          usdcAmountHuman: usdcAmount,
        }),
      })
        .then(async (res) => {
          const data = (await res.json()) as {
            error?: string;
            estimate?: BuyExposureEstimate;
          };
          if (!res.ok || data.error || !data.estimate) {
            throw new Error(data.error ?? "Could not estimate payout route");
          }
          setBuyExposureEstimate(data.estimate);
        })
        .catch((e: unknown) => {
          if ((e as Error).name === "AbortError") return;
          setBuyExposureEstimate(null);
          setBuyExposureError(
            e instanceof Error ? e.message : "Could not estimate payout route",
          );
        })
        .finally(() => {
          if (!ac.signal.aborted) setBuyExposureLoading(false);
        });
    }, 320);

    return () => {
      ac.abort();
      window.clearTimeout(t);
    };
  }, [buySide, market.id, market.kind, parsedUsdc, tab, usdcAmount]);

  const sharesReceived = useMemo(() => {
    if (!buyExposureEstimate?.estimatedFinalChosenSideAtoms) return null;
    try {
      const atoms = BigInt(buyExposureEstimate.estimatedFinalChosenSideAtoms);
      const dec = buySide === "yes" ? balances.yesDecimals : balances.noDecimals;
      return Number(atoms) / 10 ** dec;
    } catch {
      return null;
    }
  }, [balances.noDecimals, balances.yesDecimals, buyExposureEstimate, buySide]);

  const payoutMetrics = useMemo(() => {
    const userCapitalAtRiskUsd = parsedUsdc;
    if (!sharesReceived || sharesReceived <= 0) {
      return {
        userCapitalAtRiskUsd,
        avgEntryPrice: null as number | null,
        maxPayoutUsd: null as number | null,
        netProfitUsd: null as number | null,
      };
    }
    const avgEntryPrice = userCapitalAtRiskUsd / sharesReceived;
    const maxPayoutUsd = sharesReceived;
    const netProfitUsd = maxPayoutUsd - userCapitalAtRiskUsd;
    return { userCapitalAtRiskUsd, avgEntryPrice, maxPayoutUsd, netProfitUsd };
  }, [parsedUsdc, sharesReceived]);

  const buyPayoutDisplay = useMemo(() => {
    const avg =
      payoutMetrics.avgEntryPrice != null
        ? formatUsdPerShareAsCents(payoutMetrics.avgEntryPrice)
        : null;
    const max =
      payoutMetrics.maxPayoutUsd != null
        ? `$${payoutMetrics.maxPayoutUsd.toFixed(2)}`
        : null;
    const profit =
      payoutMetrics.netProfitUsd != null
        ? payoutMetrics.netProfitUsd >= 0
          ? `+$${payoutMetrics.netProfitUsd.toFixed(2)}`
          : `-$${Math.abs(payoutMetrics.netProfitUsd).toFixed(2)}`
        : null;
    return { avg, max, profit };
  }, [
    payoutMetrics.avgEntryPrice,
    payoutMetrics.maxPayoutUsd,
    payoutMetrics.netProfitUsd,
  ]);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" || tab !== "buy") return;
    console.info(
      "[predicted][payout-estimate][spot]",
      JSON.stringify({
        userCapitalAtRiskUsd: payoutMetrics.userCapitalAtRiskUsd,
        sharesReceived,
        avgEntryPrice: payoutMetrics.avgEntryPrice,
        maxPayoutUsd: payoutMetrics.maxPayoutUsd,
        netProfitUsd: payoutMetrics.netProfitUsd,
      }),
    );
  }, [payoutMetrics, sharesReceived, tab]);

  const bumpUsdc = (delta: number) => {
    const n = (parsedUsdc || 0) + delta;
    setUsdcAmount(String(n));
  };

  const sellBalanceRaw = outcome === "yes" ? balances.yesRaw : balances.noRaw;
  const sellDecimals =
    outcome === "yes" ? balances.yesDecimals : balances.noDecimals;

  const setSellPercent = useCallback(
    (pct: number) => {
      const raw = percentOfBalance(sellBalanceRaw, pct);
      setOutcomeAmount(
        formatBaseUnitsToDecimalString(raw, sellDecimals, 8),
      );
    },
    [sellBalanceRaw, sellDecimals],
  );

  const setBuyUsdcMax = useCallback(() => {
    setUsdcAmount(
      formatBaseUnitsToDecimalString(balances.usdcRaw, balances.usdcDecimals, 6),
    );
  }, [balances.usdcRaw, balances.usdcDecimals]);

  const balanceLineSell = useMemo(() => {
    if (!connected || !publicKey) return null;
    const raw = outcome === "yes" ? balances.yesRaw : balances.noRaw;
    const dec = outcome === "yes" ? balances.yesDecimals : balances.noDecimals;
    const label = outcome === "yes" ? "YES" : "NO";
    if (balances.loading) {
      return `Balance (${label}): …`;
    }
    return `Balance (${label}): ${formatBaseUnitsToDecimalString(raw, dec, 6)}`;
  }, [
    connected,
    publicKey,
    outcome,
    balances.yesRaw,
    balances.noRaw,
    balances.yesDecimals,
    balances.noDecimals,
    balances.loading,
  ]);

  const onBuySuccess = useCallback(
    (args: {
      signature: string;
      side: "yes" | "no";
      usdcAmountHuman: string;
    }) => {
      const { signature, side: s, usdcAmountHuman: amt } = args;
      const trimmed = amt.trim() || "0";
      const amountLabel =
        trimmed === "0" || trimmed === "" ? "USDC" : `${trimmed} USDC`;
      pushRecentMarketTransaction(
        market.id,
        {
          action: s === "yes" ? "buy_yes" : "buy_no",
          amount: amountLabel,
          signature,
        },
        publicKey?.toBase58(),
      );
      setTradeSuccess({
        signature,
        action: s === "yes" ? "buy_yes" : "buy_no",
        amountLabel,
      });
      balances.refresh();
      router.refresh();
      refreshOmnipairPosition();
      onPoolTxSettled?.();
      void onTradePriceSnapshot?.(signature);
    },
    [
      balances,
      market.id,
      onPoolTxSettled,
      onTradePriceSnapshot,
      publicKey,
      refreshOmnipairPosition,
      router,
    ],
  );

  const onSellSuccess = useCallback(
    (args: {
      signature: string;
      sellSide: "yes" | "no";
      outcomeAmountHuman: string;
      usdcOutAtoms: string;
      buildLog?: SellOutcomeForUsdcBuildLog;
    }) => {
      const {
        signature,
        sellSide: ss,
        outcomeAmountHuman: amt,
        usdcOutAtoms,
        buildLog,
      } = args;
      const trimmed = amt.trim() || "0";
      const amountLabel =
        trimmed === "0" || trimmed === ""
          ? "shares"
          : `${trimmed} ${ss.toUpperCase()}`;
      const usdcHuman = formatUsdcAtomsHuman(usdcOutAtoms);
      const receiveNote =
        buildLog?.uiSummary ??
        (BigInt(usdcOutAtoms || "0") > 0n
          ? `Receive ~${usdcHuman} devnet USDC`
          : "Trade confirmed.");
      const amountSummary =
        buildLog?.routeKind === "fallback_pool_swap"
          ? `${amountLabel} · pool swap`
          : `${amountLabel} → ~${usdcHuman} USDC`;
      pushRecentMarketTransaction(
        market.id,
        {
          action: ss === "yes" ? "sell_yes" : "sell_no",
          amount: amountSummary,
          signature,
        },
        publicKey?.toBase58(),
      );
      setTradeSuccess({
        signature,
        action: ss === "yes" ? "sell_yes" : "sell_no",
        amountLabel,
        receiveNote,
      });
      balances.refresh();
      router.refresh();
      refreshOmnipairPosition();
      onPoolTxSettled?.();
      void onTradePriceSnapshot?.(signature);
    },
    [
      balances,
      market.id,
      onPoolTxSettled,
      onTradePriceSnapshot,
      publicKey,
      refreshOmnipairPosition,
      router,
    ],
  );

  return (
    <>
    <div className="rounded-xl bg-[#111] p-4 ring-1 ring-white/[0.06]">
      {/* Buy / Sell + order type */}
      <div className="flex items-end justify-between gap-3 border-b border-white/[0.08] pb-2">
        <div className="flex min-w-0 flex-1 flex-wrap gap-x-6 gap-y-1">
          <button
            type="button"
            onClick={() => setTab("buy")}
            className={cn(
              "relative pb-2 text-[14px] font-medium transition",
              tab === "buy"
                ? "text-white after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:rounded-full after:bg-white"
                : "text-zinc-500 hover:text-zinc-300",
            )}
          >
            Buy
          </button>
          <button
            type="button"
            onClick={() => setTab("sell")}
            className={cn(
              "relative pb-2 text-[14px] font-medium transition",
              tab === "sell"
                ? "text-white after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:rounded-full after:bg-white"
                : "text-zinc-500 hover:text-zinc-300",
            )}
          >
            Sell
          </button>
          {showLeverageTab ? (
            <button
              type="button"
              onClick={() => setTab("leverage")}
              className={cn(
                "relative pb-2 text-[14px] font-medium transition",
                tab === "leverage"
                  ? "text-white after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:rounded-full after:bg-white"
                  : "text-zinc-500 hover:text-zinc-300",
              )}
            >
              Leverage
            </button>
          ) : null}
        </div>
        {!isLeverage ? (
          <button
            type="button"
            disabled
            className="shrink-0 rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-zinc-400"
            title="Market orders only in this MVP"
          >
            Market ▾
          </button>
        ) : null}
      </div>

      {/* Yes / No */}
      <div className="mt-4 space-y-3">
      {!isLeverage && showOneSidedLiquidity ? (
        <p className="rounded-lg border border-amber-500/25 bg-amber-950/35 px-3 py-2 text-center text-[11px] font-medium leading-snug text-amber-100/95 ring-1 ring-amber-500/15">
          One-sided liquidity detected — mids hidden until both sides are seeded.
        </p>
      ) : null}
      {!isLeverage ? (
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setOutcome("yes")}
          className={cn(
            "rounded-xl py-3 text-[13px] font-semibold transition",
            outcome === "yes"
              ? "bg-[#22c55e] text-black shadow-[0_0_18px_-4px_rgba(34,197,94,0.35)]"
              : "bg-white/[0.05] text-zinc-500 hover:bg-white/[0.08] hover:text-zinc-300",
          )}
        >
          {showOneSidedLiquidity ? (
            <span className="text-zinc-600">Yes —</span>
          ) : showPriceUnavailable ? (
            <span className="block text-[12px] font-medium text-zinc-500">
              Yes — Price unavailable
            </span>
          ) : (
            <>Yes {formatProbabilityAsWholeCents(yesP)}</>
          )}
        </button>
        <button
          type="button"
          onClick={() => setOutcome("no")}
          className={cn(
            "rounded-xl py-3 text-[13px] font-semibold transition",
            outcome === "no"
              ? "bg-red-600 text-white shadow-[0_0_18px_-4px_rgba(220,38,38,0.4)]"
              : "bg-white/[0.05] text-zinc-500 hover:bg-white/[0.08] hover:text-zinc-300",
          )}
        >
          {showOneSidedLiquidity ? (
            <span className="text-zinc-600">No —</span>
          ) : showPriceUnavailable ? (
            <span className="block text-[12px] font-medium text-red-200/90">
              No — Price unavailable
            </span>
          ) : (
            <>No {formatProbabilityAsWholeCents(noP)}</>
          )}
        </button>
      </div>
      ) : null}
      </div>

      {isBuy ? (
        <>
          <div className="mt-5">
            <div className="trade-field mt-2 flex items-baseline justify-end gap-2 px-4 py-3">
              <span className="text-xl font-medium text-zinc-500">$</span>
              <input
                value={usdcAmount}
                onChange={(e) => setUsdcAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0"
                className="min-w-0 flex-1 border-0 bg-transparent text-right text-2xl font-semibold tabular-nums tracking-tight text-white outline-none placeholder:text-zinc-600 sm:text-[1.6rem]"
              />
            </div>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              {(["+1", "+5", "+10", "+100"] as const).map((label) => {
                const n = Number(label.replace(/\D/g, ""));
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => bumpUsdc(n)}
                    className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-medium text-zinc-400 transition hover:border-white/[0.14] hover:text-zinc-200"
                  >
                    +${n}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setBuyUsdcMax()}
                disabled={!connected || balances.usdcRaw <= 0n}
                className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-medium text-zinc-400 transition hover:border-white/[0.14] hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Max
              </button>
            </div>
            {connected && tab === "buy" && !balances.loading ? (
              <p className="mt-2 text-right text-[10px] tabular-nums text-zinc-600">
                Available: $
                {formatBaseUnitsToDecimalString(
                  balances.usdcRaw,
                  balances.usdcDecimals,
                  2,
                )}{" "}
                USDC
              </p>
            ) : null}
          </div>

          <div className="mt-4">
            <div className="rounded-2xl border border-white/[0.08] bg-[#0a0a0a] px-4 py-4 ring-1 ring-white/[0.04]">
              {buyExposureLoading ? (
                <p className="text-[12px] text-zinc-500">Estimating payout…</p>
              ) : buyExposureError ? (
                <p className="text-[12px] text-amber-200/90">{buyExposureError}</p>
              ) : (
                <>
                  <p className="text-[11px] font-medium text-zinc-500">
                    Max payout if {buySide === "yes" ? "Yes" : "No"} wins
                  </p>
                  <p className="mt-1.5 text-[2rem] font-semibold leading-none tabular-nums tracking-tight text-white sm:text-[2.25rem]">
                    {buyPayoutDisplay.max ?? "—"}
                  </p>
                  <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/[0.06] pt-3">
                    <span className="text-[12px] text-zinc-500">Avg entry</span>
                    <span className="text-[13px] font-medium tabular-nums text-zinc-100">
                      {buyPayoutDisplay.avg ?? "—"}
                    </span>
                  </div>
                  {buyPayoutDisplay.profit != null ? (
                    <div className="mt-2.5 flex items-center justify-between gap-3">
                      <span className="text-[11px] text-zinc-600">Est. profit</span>
                      <span
                        className={cn(
                          "text-[12px] font-semibold tabular-nums",
                          payoutMetrics.netProfitUsd != null &&
                            payoutMetrics.netProfitUsd >= 0
                            ? "text-emerald-400"
                            : "text-red-400/90",
                        )}
                      >
                        {buyPayoutDisplay.profit}
                      </span>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </>
      ) : null}

      {isSell ? (
        <div className="mt-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-zinc-500">
              Shares
            </span>
            {balanceLineSell ? (
              <span className="max-w-[60%] text-right text-[10px] text-zinc-600">
                {balanceLineSell}
              </span>
            ) : null}
          </div>
          <div className="trade-field mt-2 flex items-baseline justify-end px-4 py-3">
            <input
              value={outcomeAmount}
              onChange={(e) => setOutcomeAmount(e.target.value)}
              inputMode="decimal"
              placeholder="0"
              className="min-w-0 flex-1 border-0 bg-transparent text-right text-2xl font-semibold tabular-nums tracking-tight text-white outline-none placeholder:text-zinc-600 sm:text-[1.6rem]"
            />
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            {(
              [
                { label: "25%", pct: 25 },
                { label: "50%", pct: 50 },
                { label: "Max", pct: 100 },
              ] as const
            ).map(({ label, pct }) => (
              <button
                key={label}
                type="button"
                onClick={() => setSellPercent(pct)}
                disabled={!connected || sellBalanceRaw <= 0n}
                className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[11px] font-medium text-zinc-400 transition hover:border-white/[0.14] hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "sell" && connected && publicKey && parsedOutcome > 0 ? (
            <div className="mt-3 space-y-1 border-t border-white/[0.06] pt-3 text-[10px] leading-relaxed text-zinc-500">
              {sellPlanLoading ? (
                <p className="text-zinc-600">Estimating exit route…</p>
              ) : sellPlanError ? (
                <p className="text-amber-200/90">{sellPlanError}</p>
              ) : sellPlan ? (
                <>
                  <p className="font-medium text-zinc-400">
                    {sellRouteHeadline(sellPlan.routeKind)}
                  </p>
                  <p>{sellPlan.uiSummary}</p>
                  <p className="tabular-nums text-zinc-500">
                    Est. USDC:{" "}
                    <span className="text-zinc-300">
                      {sellPlan.routeKind === "fallback_pool_swap"
                        ? "—"
                        : formatUsdcAtomsHuman(sellPlan.usdcOutAtoms)}
                    </span>
                    {" · "}
                    Pool reserves YES / NO:{" "}
                    <span className="text-zinc-400">
                      {sellPlan.reserveYes} / {sellPlan.reserveNo}
                    </span>
                  </p>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {isLeverage && showLeverageTab ? (
        <div className="mt-4">
          <MarketOutcomeLeveragePanel
            market={market}
            snapshot={omnipairSnapshot ?? null}
            onAfterTx={onLeverageAfterTx!}
          />
        </div>
      ) : null}

      {isBuy ? (
        <MarketTradingPrimaryButton
          market={market}
          side={buySide}
          usdcAmountHuman={usdcAmount}
          buyLabel={outcome === "yes" ? "Buy YES" : "Buy NO"}
          onTradeSuccess={onBuySuccess}
          className={tradeButtonClass}
        />
      ) : null}

      {isSell ? (
        <MarketSellOutcomeButton
          market={market}
          sellSide={outcome === "yes" ? "yes" : "no"}
          outcomeAmountHuman={outcomeAmount}
          sellLabel={outcome === "yes" ? "Sell YES" : "Sell NO"}
          onTradeSuccess={onSellSuccess}
          className={tradeButtonClass}
        />
      ) : null}

      {tradeSuccess ? (
        <div className="mt-4 rounded-lg border border-emerald-500/25 bg-emerald-950/30 px-3 py-3 ring-1 ring-emerald-500/15">
          <p className="text-[11px] font-medium text-emerald-200/95">
            Transaction confirmed
          </p>
          <p className="mt-1 text-[10px] text-zinc-500">
            {tradeSuccess.action === "buy_yes" && "Buy YES"}
            {tradeSuccess.action === "buy_no" && "Buy NO"}
            {tradeSuccess.action === "sell_yes" && "Sell YES"}
            {tradeSuccess.action === "sell_no" && "Sell NO"}
            {" · "}
            {tradeSuccess.amountLabel}
          </p>
          {tradeSuccess.receiveNote ? (
            <p className="mt-1 text-[10px] text-amber-200/85">
              {tradeSuccess.receiveNote}
            </p>
          ) : null}
          <div className="mt-2 text-[11px] leading-relaxed">
            <TxExplorerLink signature={tradeSuccess.signature} />
          </div>
        </div>
      ) : null}

      <p className="mt-3 text-center text-[10px] text-zinc-600">
        Connect a wallet to load balances. Estimates are indicative.
      </p>
    </div>

    </>
  );
}

"use client";

import Image from "next/image";
import { useConnection } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useWallet } from "@/lib/hooks/use-wallet";
import { useMarketTradingBalances } from "@/lib/hooks/use-market-trading-balances";
import { addPendingDelta } from "@/lib/hooks/use-pending-volume-delta";
import { runPostTradeRefreshSequence } from "@/lib/market/post-trade-router-refresh";
import { logAndFormatUserTxError } from "@/lib/market/tx-user-message";
import { pushRecentMarketTransaction } from "@/lib/market/recent-market-transactions";
import {
  computeResolvedRedeemFlags,
  winningSideOrNull,
} from "@/lib/market/resolved-redeem-ui";
import { buildWithdrawOmnipairLiquidityTransaction } from "@/lib/solana/withdraw-omnipair-liquidity";
import {
  decodeFutarchySwapShareBps,
  decodeOmnipairPairAccount,
} from "@/lib/solana/decode-omnipair-accounts";
import { getGlobalFutarchyAuthorityPDA } from "@/lib/solana/omnipair-pda";
import { requireOmnipairProgramId } from "@/lib/solana/omnipair-program";
import { readOmnipairPoolState } from "@/lib/solana/read-omnipair-pool-state";
import { formatBaseUnitsToDecimalString, percentOfBalance } from "@/lib/solana/wallet-token-balances";
import { OUTCOME_MINT_DECIMALS } from "@/lib/solana/create-outcome-mints";
import {
  formatProbabilityAsWholeCents,
  formatUsdPerShareAsCents,
} from "@/lib/format/price-cents";
import type { Market } from "@/lib/types/market";
import { devnetTxExplorerUrl, shortenTransactionSignature } from "@/lib/utils/solana-explorer";
import { defiWellPanel } from "@/lib/ui/defi-well";
import { cn } from "@/lib/utils/cn";
import { MarketOutcomeLeveragePanel } from "@/components/market/market-outcome-leverage-panel";
import { MarketSellOutcomeButton } from "@/components/market/market-sell-outcome-button";
import { MarketTradingPrimaryButton } from "@/components/market/market-trading-primary-button";
import type { OmnipairUserPositionSnapshot } from "@/lib/hooks/use-omnipair-user-position";
import type {
  SellOutcomeForUsdcBuildLog,
  SellOutcomePlan,
} from "@/lib/solana/sell-outcome-for-usdc";

const tradeButtonClass =
  "w-full min-h-[48px] rounded-2xl border border-white/10 bg-white py-3.5 text-[14px] font-semibold tracking-tight text-neutral-950 ring-0 " +
  "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.9),0_10px_28px_-8px_rgba(0,0,0,0.65),0_0_0_1px_rgba(0,0,0,0.12)] " +
  "transition duration-200 ease-out " +
  "hover:border-white/20 hover:bg-zinc-50 hover:shadow-[inset_0_1px_0_0_rgb(255,255,255),0_14px_40px_-10px_rgba(0,0,0,0.55)] " +
  "active:scale-[0.985] active:bg-zinc-100 active:shadow-[inset_0_1px_1px_rgba(0,0,0,0.06)] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:ring-offset-2 focus-visible:ring-offset-[#111] " +
  "disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-white/[0.06] disabled:bg-white/[0.65] disabled:text-neutral-500 disabled:shadow-none";

const maxInlineClass =
  "shrink-0 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-medium text-zinc-400 transition " +
  "hover:border-white/[0.14] hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40";

export type MarketActionTab =
  | "deposit"
  | "withdraw"
  | "buy"
  | "sell"
  | "leverage";

type TxResultState =
  | {
      kind: "success";
      line: string;
      signature: string;
      detailLine?: string;
    }
  | { kind: "error"; message: string };

function formatWithdrawUsdcReceivedLabel(atoms: string): string {
  try {
    const a = BigInt(atoms);
    const whole = a / 1_000_000n;
    const frac = (a % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
    return frac.length ? `${whole}.${frac} USDC` : `${whole}.0 USDC`;
  } catch {
    return "USDC";
  }
}

function formatOutcomeLeftoverHuman(atoms: string | undefined, decimals: number): string | null {
  try {
    const a = BigInt(atoms || "0");
    if (a <= 0n) return null;
    return formatBaseUnitsToDecimalString(
      a,
      decimals,
      Math.min(6, decimals),
    );
  } catch {
    return null;
  }
}

function summarizeWithdrawReceiveEstimate(params: {
  usdcOutAtoms: string;
  leftoverYesAtoms: string;
  leftoverNoAtoms: string;
  yesDecimals: number;
  noDecimals: number;
}): string {
  const parts: string[] = [];
  if (BigInt(params.usdcOutAtoms || "0") > 0n) {
    parts.push(formatWithdrawUsdcReceivedLabel(params.usdcOutAtoms));
  }
  const y = formatOutcomeLeftoverHuman(params.leftoverYesAtoms, params.yesDecimals);
  if (y) parts.push(`${y} YES`);
  const n = formatOutcomeLeftoverHuman(params.leftoverNoAtoms, params.noDecimals);
  if (n) parts.push(`${n} NO`);
  if (parts.length === 0) {
    return "Outcome tokens in your wallet";
  }
  return parts.join(" + ");
}

function parseDecimalHumanToAtoms(s: string, decimals: number): bigint {
  const cleaned = s.replace(/[^0-9.]/g, "");
  if (!cleaned || cleaned === ".") return 0n;
  const [wholeRaw, fracRaw = ""] = cleaned.split(".");
  const whole = wholeRaw || "0";
  const fracPadded = (fracRaw + "0".repeat(decimals)).slice(0, decimals);
  return (
    BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fracPadded || "0")
  );
}

function isPlausibleSingleDecimal(s: string): boolean {
  const t = s.trim();
  if (t.length === 0) return true;
  return /^\d*\.?\d*$/.test(t) && t.split(".").length <= 2;
}

function baselineVolumeUsdForPending(m: Market): number {
  const v = m.snapshot?.volumeUsd;
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 0;
}

function parseTradeUsdcFromBuyHuman(s: string): number {
  const n = Number.parseFloat(s.trim().replace(/[^0-9.]/g, "")) || 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function parseTradeUsdFromSellUsdcAtoms(atoms: string): number {
  try {
    const a = BigInt(atoms || "0");
    const usd = Number(a) / 1_000_000;
    return Number.isFinite(usd) && usd > 0 ? usd : 0;
  } catch {
    return 0;
  }
}

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

type BuyExposureEstimate = { estimatedFinalChosenSideAtoms: string };

export type MarketActionsCardProps = {
  market: Market;
  /** `market` = main market page (Buy/Sell/Leverage only). `earn` = full LP + trade tabs. */
  variant?: "market" | "earn";
  /** When true, outer `defiWellPanel` shell (Earn page). */
  wrapInDefiWell?: boolean;
  initialActionTab?: MarketActionTab;
  /** While Omnipair pool price RPC is in flight (enables loading / stale display). */
  poolPriceLoading?: boolean;
  liveYesProbability?: number | null;
  liveNoProbability?: number | null;
  livePriceUnavailable?: boolean;
  oneSidedLiquidity?: boolean;
  onPoolTxSettled?: () => void;
  onOmnipairRefresh?: () => void;
  onTradePriceSnapshot?: (txSignature: string) => void | Promise<unknown>;
  onLeverageAfterTx?: (detail?: { signature?: string }) => void | Promise<void>;
  omnipairSnapshot?: OmnipairUserPositionSnapshot | null;
};

export function MarketActionsCard({
  market,
  variant: variantProp = "earn",
  wrapInDefiWell = false,
  initialActionTab: initialActionTabProp,
  poolPriceLoading: poolPriceLoadingProp = false,
  liveYesProbability,
  liveNoProbability,
  livePriceUnavailable,
  oneSidedLiquidity,
  onPoolTxSettled,
  onOmnipairRefresh,
  onTradePriceSnapshot,
  onLeverageAfterTx,
  omnipairSnapshot,
}: MarketActionsCardProps) {
  const variant = variantProp;
  const poolPriceLoading = poolPriceLoadingProp;
  const { connection } = useConnection();
  const router = useRouter();
  const { setVisible } = useWalletModal();
  const {
    connected,
    connect,
    wallet,
    publicKey,
    signTransaction,
  } = useWallet();
  const balances = useMarketTradingBalances(market, publicKey);
  const refreshOmnipairPosition = onOmnipairRefresh ?? (() => {});

  const [actionTab, setActionTab] = useState<MarketActionTab>(() => {
    if (initialActionTabProp) return initialActionTabProp;
    return variant === "market" ? "buy" : "deposit";
  });

  useEffect(() => {
    if (variant === "market" && (actionTab === "deposit" || actionTab === "withdraw")) {
      setActionTab("buy");
    }
    if (variant === "earn" && actionTab === "leverage") {
      setActionTab("buy");
    }
  }, [variant, actionTab]);
  const [lpSubmitting, setLpSubmitting] = useState(false);
  const [tradeInFlight, setTradeInFlight] = useState(false);
  const [txResult, setTxResult] = useState<TxResultState | null>(null);

  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawAdvancedRawTokens, setWithdrawAdvancedRawTokens] =
    useState(false);
  const [withdrawUsdcPlanLoading, setWithdrawUsdcPlanLoading] = useState(false);
  const [withdrawUsdcPlanError, setWithdrawUsdcPlanError] = useState<
    string | null
  >(null);
  const [withdrawPreview, setWithdrawPreview] = useState<{
    usdcOutAtoms: string;
    leftoverYesAtoms: string;
    leftoverNoAtoms: string;
  } | null>(null);
  /** Exact omLP atoms (e.g. Max); avoids human round-trip on submit. */
  const [withdrawLiquidityInRaw, setWithdrawLiquidityInRaw] = useState<
    bigint | null
  >(null);
  const [usdcAmount, setUsdcAmount] = useState("");
  const [outcome, setOutcome] = useState<"yes" | "no">("yes");
  const [outcomeAmount, setOutcomeAmount] = useState("");

  const [lpAtoms, setLpAtoms] = useState<bigint | null>(null);
  const [lpLoading, setLpLoading] = useState(false);
  const [lpDecimals, setLpDecimals] = useState(OUTCOME_MINT_DECIMALS);
  const [userOmLpAtaStr, setUserOmLpAtaStr] = useState<string | null>(null);

  const [sellPlan, setSellPlan] = useState<SellOutcomePlan | null>(null);
  const [sellPlanLoading, setSellPlanLoading] = useState(false);
  const [sellPlanError, setSellPlanError] = useState<string | null>(null);

  const [buyExposureEstimate, setBuyExposureEstimate] =
    useState<BuyExposureEstimate | null>(null);
  const [buyExposureLoading, setBuyExposureLoading] = useState(false);
  const [buyExposureError, setBuyExposureError] = useState<string | null>(null);

  const isBinary = market.kind === "binary";
  const isResolving = market.resolution.status === "resolving";
  const isResolved = market.resolution.status === "resolved";
  const winningSide = winningSideOrNull(
    market.resolution.status,
    market.resolution.resolvedOutcome,
  );
  const hasPool = !!(
    market.pool?.poolId &&
    market.pool?.yesMint &&
    market.pool?.noMint
  );

  const anyLocked =
    (variant === "earn" && lpSubmitting) || tradeInFlight;

  const redeemFlags = useMemo(
    () =>
      computeResolvedRedeemFlags(winningSide, {
        yesRaw: balances.yesRaw,
        noRaw: balances.noRaw,
        loading: balances.loading,
      }),
    [winningSide, balances.yesRaw, balances.noRaw, balances.loading],
  );

  const useDedicatedResolvedLayout = isResolved && isBinary;
  const sideForSell: "yes" | "no" =
    isResolved && winningSide ? winningSide : outcome;

  useEffect(() => {
    if (isResolved) setActionTab("sell");
  }, [isResolved, market.id]);

  useEffect(() => {
    setTxResult(null);
  }, [actionTab]);

  const refreshLpPosition = useCallback(async () => {
    if (variant !== "earn") return;
    if (!hasPool || !market.pool || !publicKey) {
      setLpAtoms(null);
      setUserOmLpAtaStr(null);
      return;
    }
    setLpLoading(true);
    try {
      const programId = requireOmnipairProgramId();
      const pair = new PublicKey(market.pool.poolId);
      const info = await connection.getAccountInfo(pair, "confirmed");
      if (!info?.data) {
        setLpAtoms(null);
        return;
      }
      const dec = decodeOmnipairPairAccount(info.data);
      const m = await getMint(connection, dec.lpMint);
      if (Number.isFinite(m.decimals) && m.decimals >= 0) {
        setLpDecimals(m.decimals);
      }
      const userLp = getAssociatedTokenAddressSync(
        dec.lpMint,
        publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );
      setUserOmLpAtaStr(userLp.toBase58());
      let atoms = 0n;
      try {
        const acc = await getAccount(
          connection,
          userLp,
          "confirmed",
          TOKEN_PROGRAM_ID,
        );
        atoms = acc.amount;
      } catch {
        atoms = 0n;
      }
      setLpAtoms(atoms);
    } catch {
      setLpAtoms(null);
      setUserOmLpAtaStr(null);
    } finally {
      setLpLoading(false);
    }
  }, [variant, hasPool, market.pool, publicKey, connection]);

  useEffect(() => {
    if (variant !== "earn") return;
    void refreshLpPosition();
  }, [variant, refreshLpPosition]);

  const staticYes = market.pool?.yesPrice ?? market.yesProbability;
  const staticNo = market.pool?.noPrice ?? 1 - market.yesProbability;
  const hasLiveInputs =
    liveYesProbability !== undefined &&
    liveNoProbability !== undefined &&
    livePriceUnavailable !== undefined;

  const lastGoodMid = useRef<{ y: number; n: number } | null>(null);
  useEffect(() => {
    lastGoodMid.current = null;
  }, [market.id]);

  useEffect(() => {
    if (oneSidedLiquidity) return;
    if (poolPriceLoading) return;
    if (
      !livePriceUnavailable &&
      liveYesProbability != null &&
      liveNoProbability != null
    ) {
      lastGoodMid.current = {
        y: liveYesProbability,
        n: liveNoProbability,
      };
    }
  }, [
    poolPriceLoading,
    liveYesProbability,
    liveNoProbability,
    livePriceUnavailable,
    oneSidedLiquidity,
  ]);

  const canUsePoolMid =
    hasLiveInputs &&
    !oneSidedLiquidity &&
    !livePriceUnavailable &&
    liveYesProbability !== null &&
    liveNoProbability !== null;

  const useStaleMid =
    hasLiveInputs &&
    !oneSidedLiquidity &&
    lastGoodMid.current != null &&
    (poolPriceLoading || livePriceUnavailable) &&
    !canUsePoolMid;

  const useLive = canUsePoolMid;
  const yesP = useLive
    ? (liveYesProbability as number)
    : useStaleMid
      ? lastGoodMid.current!.y
      : staticYes;
  const noP = useLive
    ? (liveNoProbability as number)
    : useStaleMid
      ? lastGoodMid.current!.n
      : staticNo;

  const showPriceLoading =
    !!market.pool &&
    hasLiveInputs &&
    !oneSidedLiquidity &&
    !canUsePoolMid &&
    !useStaleMid &&
    poolPriceLoading;
  const showSubtlePriceUnavailable =
    !!market.pool &&
    hasLiveInputs &&
    !oneSidedLiquidity &&
    !canUsePoolMid &&
    !useStaleMid &&
    !poolPriceLoading &&
    !!livePriceUnavailable;

  const showOneSidedLiquidity = !!market.pool && oneSidedLiquidity === true;
  const buySide = outcome === "yes" ? "yes" : "no";
  const parsedUsdc =
    Number.parseFloat(usdcAmount.replace(/[^0-9.]/g, "")) || 0;
  const parsedOutcome =
    Number.parseFloat(outcomeAmount.replace(/[^0-9.]/g, "")) || 0;

  const omlpAvailableLine = useMemo(() => {
    if (!publicKey) return "—";
    if (lpLoading || lpAtoms == null) return "…";
    return formatBaseUnitsToDecimalString(
      lpAtoms,
      lpDecimals,
      Math.min(8, lpDecimals),
    );
  }, [publicKey, lpLoading, lpAtoms, lpDecimals]);

  const effectiveWithdrawLiqAtoms = useMemo(() => {
    if (withdrawLiquidityInRaw != null) return withdrawLiquidityInRaw;
    const t = withdrawAmount.trim();
    if (!t || !isPlausibleSingleDecimal(t)) return 0n;
    return parseDecimalHumanToAtoms(t, lpDecimals);
  }, [withdrawLiquidityInRaw, withdrawAmount, lpDecimals]);

  const withdrawConfirmDisabled = useMemo(() => {
    if (anyLocked) return true;
    if (!connected || !publicKey) return true;
    if (lpLoading || lpAtoms == null) return true;
    if (lpAtoms === 0n) return true;
    const atoms = effectiveWithdrawLiqAtoms;
    if (atoms <= 0n) return true;
    if (atoms > lpAtoms) return true;
    if (!withdrawAdvancedRawTokens) {
      if (withdrawUsdcPlanLoading) return true;
      if (withdrawUsdcPlanError) return true;
      if (!withdrawPreview) return true;
    }
    return false;
  }, [
    anyLocked,
    connected,
    publicKey,
    lpLoading,
    lpAtoms,
    lpDecimals,
    effectiveWithdrawLiqAtoms,
    withdrawAdvancedRawTokens,
    withdrawUsdcPlanError,
    withdrawUsdcPlanLoading,
    withdrawPreview,
  ]);

  useEffect(() => {
    if (
      variant !== "earn" ||
      actionTab !== "withdraw" ||
      !hasPool ||
      withdrawAdvancedRawTokens
    ) {
      setWithdrawUsdcPlanLoading(false);
      setWithdrawUsdcPlanError(null);
      setWithdrawPreview(null);
      return;
    }
    const t = withdrawAmount.trim();
    const atoms =
      withdrawLiquidityInRaw ??
      (t.length && isPlausibleSingleDecimal(t)
        ? parseDecimalHumanToAtoms(t, lpDecimals)
        : 0n);
    if (!connected || !publicKey) {
      setWithdrawUsdcPlanLoading(false);
      setWithdrawUsdcPlanError(null);
      setWithdrawPreview(null);
      return;
    }
    if (
      withdrawLiquidityInRaw == null &&
      (t.length === 0 || !isPlausibleSingleDecimal(t))
    ) {
      setWithdrawUsdcPlanLoading(false);
      setWithdrawUsdcPlanError(null);
      setWithdrawPreview(null);
      return;
    }
    if (atoms <= 0n || (lpAtoms != null && atoms > lpAtoms)) {
      setWithdrawUsdcPlanLoading(false);
      setWithdrawUsdcPlanError(null);
      setWithdrawPreview(null);
      return;
    }

    const ac = new AbortController();
    const timer = window.setTimeout(() => {
      setWithdrawUsdcPlanLoading(true);
      setWithdrawUsdcPlanError(null);
      const qs = new URLSearchParams({
        slug: market.id,
        userWallet: publicKey.toBase58(),
      });
      if (withdrawLiquidityInRaw != null) {
        qs.set("liquidityAtoms", withdrawLiquidityInRaw.toString());
      } else {
        qs.set("liquidityHuman", t);
      }
      fetch(`/api/market/withdraw-liquidity-usdc?${qs.toString()}`, {
        signal: ac.signal,
        credentials: "same-origin",
      })
        .then(async (res) => {
          const data = (await res.json()) as {
            error?: string;
            plan?: {
              usdcOutAtoms?: string;
              leftoverYesAtoms?: string;
              leftoverNoAtoms?: string;
            };
          };
          if (!res.ok || data.error) {
            throw new Error(data.error ?? "Could not estimate withdraw");
          }
          if (!data.plan) {
            throw new Error("Could not estimate withdraw");
          }
          setWithdrawPreview({
            usdcOutAtoms: data.plan.usdcOutAtoms ?? "0",
            leftoverYesAtoms: data.plan.leftoverYesAtoms ?? "0",
            leftoverNoAtoms: data.plan.leftoverNoAtoms ?? "0",
          });
        })
        .catch((e: unknown) => {
          if ((e as Error).name === "AbortError") return;
          setWithdrawPreview(null);
          setWithdrawUsdcPlanError(
            e instanceof Error ? e.message : "Could not estimate withdraw",
          );
        })
        .finally(() => {
          setWithdrawUsdcPlanLoading(false);
        });
    }, 650);

    return () => {
      ac.abort();
      window.clearTimeout(timer);
    };
  }, [
    actionTab,
    connected,
    hasPool,
    lpAtoms,
    lpDecimals,
    market.id,
    publicKey,
    variant,
    withdrawAdvancedRawTokens,
    withdrawAmount,
    withdrawLiquidityInRaw,
  ]);

  const setWithdrawToMax = useCallback(() => {
    if (lpAtoms == null || lpAtoms === 0n) return;
    setWithdrawLiquidityInRaw(lpAtoms);
    setWithdrawAmount(
      formatBaseUnitsToDecimalString(
        lpAtoms,
        lpDecimals,
        Math.min(8, lpDecimals),
      ),
    );
  }, [lpAtoms, lpDecimals]);

  const sellBalanceRaw = sideForSell === "yes" ? balances.yesRaw : balances.noRaw;
  const sellDecimals =
    sideForSell === "yes" ? balances.yesDecimals : balances.noDecimals;

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
      formatBaseUnitsToDecimalString(
        balances.usdcRaw,
        balances.usdcDecimals,
        6,
      ),
    );
  }, [balances.usdcRaw, balances.usdcDecimals]);

  const bumpUsdc = (delta: number) => {
    const n = (parsedUsdc || 0) + delta;
    setUsdcAmount(String(n));
  };

  const balanceLineSell = useMemo(() => {
    if (!connected || !publicKey) return null;
    const raw = sideForSell === "yes" ? balances.yesRaw : balances.noRaw;
    const dec = sideForSell === "yes" ? balances.yesDecimals : balances.noDecimals;
    const label = sideForSell === "yes" ? "YES" : "NO";
    if (balances.loading) {
      return `Balance (${label}): …`;
    }
    return `Balance (${label}): ${formatBaseUnitsToDecimalString(raw, dec, 6)}`;
  }, [
    connected,
    publicKey,
    sideForSell,
    balances.yesRaw,
    balances.noRaw,
    balances.yesDecimals,
    balances.noDecimals,
    balances.loading,
  ]);

  useEffect(() => {
    const wantPlan =
      isBinary &&
      !isResolving &&
      ((isResolved && winningSide && redeemFlags.hasWinningBalance) ||
        (!isResolved && actionTab === "sell"));

    if (!wantPlan) {
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
        side: sideForSell === "yes" ? "yes" : "no",
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
            throw new Error(data.error ?? "Could not load sell preview");
          }
          setSellPlan(data.plan ?? null);
        })
        .catch((e: unknown) => {
          if ((e as Error).name === "AbortError") return;
          setSellPlan(null);
          setSellPlanError(
            e instanceof Error ? e.message : "Could not load sell preview",
          );
        })
        .finally(() => {
          setSellPlanLoading(false);
        });
    }, 650);

    return () => {
      ac.abort();
      window.clearTimeout(t);
    };
  }, [
    actionTab,
    market.id,
    outcomeAmount,
    sideForSell,
    connected,
    publicKey,
    isResolved,
    isResolving,
    winningSide,
    redeemFlags.hasWinningBalance,
    isBinary,
  ]);

  useEffect(() => {
    if (actionTab !== "buy" || !isBinary) {
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
    const timer = window.setTimeout(() => {
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
    }, 650);

    return () => {
      ac.abort();
      window.clearTimeout(timer);
    };
  }, [actionTab, buySide, isBinary, market.id, parsedUsdc, usdcAmount]);

  useEffect(() => {
    if (actionTab === "buy") setOutcomeAmount("");
  }, [actionTab, outcome]);

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

  const onBuySuccess = useCallback(
    (args: {
      signature: string;
      side: "yes" | "no";
      usdcAmountHuman: string;
    }) => {
      const { signature, side: s, usdcAmountHuman: amt } = args;
      const trimmed = amt.trim() || "0";
      const buyVolDelta = parseTradeUsdcFromBuyHuman(trimmed);
      if (buyVolDelta > 0) {
        addPendingDelta(
          market.id,
          buyVolDelta,
          baselineVolumeUsdForPending(market),
        );
      }
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
      setUsdcAmount("");
      setTxResult({
        kind: "success",
        line: `Buy ${s === "yes" ? "YES" : "NO"} confirmed: ${shortenTransactionSignature(signature)}`,
        signature,
      });
      balances.refresh();
      refreshOmnipairPosition();
      onPoolTxSettled?.();
      void runPostTradeRefreshSequence(router, {
        slug: market.id,
        txSignature: signature,
        runVolumeUpdate: async () => {
          await onTradePriceSnapshot?.(signature);
        },
      });
    },
    [balances, market, onPoolTxSettled, onTradePriceSnapshot, publicKey, router],
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
      const sellVolDelta = parseTradeUsdFromSellUsdcAtoms(usdcOutAtoms);
      if (sellVolDelta > 0) {
        addPendingDelta(
          market.id,
          sellVolDelta,
          baselineVolumeUsdForPending(market),
        );
      }
      const receiveNote =
        buildLog?.uiSummary ??
        (BigInt(usdcOutAtoms || "0") > 0n
          ? `Receive ~${usdcHuman} devnet USDC`
          : "Trade confirmed.");
      const amountSummary =
        buildLog?.routeKind === "fallback_pool_swap"
          ? `${amountLabel} · pool swap`
          : buildLog?.routeKind === "resolved_winner_redeem"
            ? `${amountLabel} → ${usdcHuman} USDC (settlement)`
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
      setOutcomeAmount("");
      const label = isResolved
        ? `Redeem confirmed: ${shortenTransactionSignature(signature)}`
        : `Sell ${ss === "yes" ? "YES" : "NO"} confirmed: ${shortenTransactionSignature(signature)}`;
      setTxResult({
        kind: "success",
        line: label,
        signature,
      });
      if (isResolved) {
        console.info("[predicted][resolve]", "redeem_success", {
          marketSlug: market.id,
          sellSide: ss,
        });
      }
      balances.refresh();
      refreshOmnipairPosition();
      onPoolTxSettled?.();
      void runPostTradeRefreshSequence(router, {
        slug: market.id,
        txSignature: signature,
        runVolumeUpdate: async () => {
          await onTradePriceSnapshot?.(signature);
        },
      });
    },
    [
      balances,
      isResolved,
      market,
      onPoolTxSettled,
      onTradePriceSnapshot,
      publicKey,
      router,
    ],
  );

  const onDeposit = useCallback(async () => {
    setTxResult(null);
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
    if (!hasPool) {
      setTxResult({
        kind: "error",
        message: "This market has no on-chain pool.",
      });
      return;
    }
    setLpSubmitting(true);
    try {
      const res = await fetch("/api/market/provide-liquidity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: market.id,
          userWallet: publicKey.toBase58(),
          usdcAmountHuman: depositAmount,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        transaction?: string;
      };
      if (!res.ok || !data.transaction) {
        throw new Error(data.error ?? "Request failed");
      }
      const tx = Transaction.from(Buffer.from(data.transaction, "base64"));
      const signed = await signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
      });
      await connection.confirmTransaction(sig, "confirmed");
      setDepositAmount("");
      await refreshLpPosition();
      setTxResult({
        kind: "success",
        line: `Deposit confirmed: ${shortenTransactionSignature(sig)}`,
        signature: sig,
      });
      onPoolTxSettled?.();
    } catch (e) {
      setTxResult({
        kind: "error",
        message: logAndFormatUserTxError(e, "deposit"),
      });
    } finally {
      setLpSubmitting(false);
    }
  }, [
    connection,
    connect,
    connected,
    depositAmount,
    hasPool,
    market.id,
    publicKey,
    onPoolTxSettled,
    refreshLpPosition,
    signTransaction,
    setVisible,
    wallet,
  ]);

  const onWithdraw = useCallback(async () => {
    setTxResult(null);
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
    if (!hasPool) {
      setTxResult({
        kind: "error",
        message: "This market has no on-chain pool.",
      });
      return;
    }
    const liq =
      withdrawLiquidityInRaw ??
      parseDecimalHumanToAtoms(withdrawAmount.trim(), lpDecimals);
    if (liq <= 0n) {
      setTxResult({
        kind: "error",
        message: "Enter a valid omLP amount to withdraw.",
      });
      return;
    }
    if (lpAtoms != null && liq > lpAtoms) {
      setTxResult({
        kind: "error",
        message: "Amount exceeds your omLP balance.",
      });
      return;
    }

    console.info(
      "[predicted][withdraw-debug-client]",
      JSON.stringify({
        wallet: publicKey.toBase58(),
        withdrawInputHuman: withdrawAmount.trim(),
        withdrawInputRaw: liq.toString(),
        omLpMintDecimals: lpDecimals,
        userOmLpAta: userOmLpAtaStr,
        userOmLpBalanceRaw: lpAtoms?.toString() ?? null,
        userOmLpBalanceHuman:
          lpAtoms == null
            ? null
            : formatBaseUnitsToDecimalString(
                lpAtoms,
                lpDecimals,
                Math.min(8, lpDecimals),
              ),
        plannedOmLpBurnRaw: liq.toString(),
        plannedOmLpBurnHuman: formatBaseUnitsToDecimalString(
          liq,
          lpDecimals,
          Math.min(8, lpDecimals),
        ),
        withdrawMode: withdrawAdvancedRawTokens ? "yes_no" : "usdc",
        userYesBalanceRaw: balances.yesRaw.toString(),
        userNoBalanceRaw: balances.noRaw.toString(),
      }),
    );

    setLpSubmitting(true);
    try {
      if (withdrawAdvancedRawTokens) {
        const { transaction, log } = await buildWithdrawOmnipairLiquidityTransaction({
          connection,
          user: publicKey,
          pairAddress: new PublicKey(market.pool!.poolId),
          yesMint: new PublicKey(market.pool!.yesMint),
          noMint: new PublicKey(market.pool!.noMint),
          liquidityIn: liq,
        });
        const recent = await connection.getLatestBlockhash("confirmed");
        transaction.recentBlockhash = recent.blockhash;
        transaction.lastValidBlockHeight = recent.lastValidBlockHeight;
        if (process.env.NODE_ENV === "development") {
          void log;
        }
        const signed = await signTransaction(transaction);
        const sig = await connection.sendRawTransaction(signed.serialize(), {
          skipPreflight: false,
        });
        await connection.confirmTransaction(sig, "confirmed");
        setWithdrawAmount("");
        setWithdrawLiquidityInRaw(null);
        await refreshLpPosition();
        setTxResult({
          kind: "success",
          line: "Withdraw successful",
          signature: sig,
        });
        onPoolTxSettled?.();
      } else {
        const res = await fetch("/api/market/withdraw-liquidity-usdc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slug: market.id,
            userWallet: publicKey.toBase58(),
            liquidityHuman: withdrawAmount.trim(),
            liquidityAtoms: liq.toString(),
          }),
        });
        const data = (await res.json()) as {
          error?: string;
          transaction?: string;
          log?: {
            redeem?: {
              usdcOutAtoms?: string;
              leftoverYesAtoms?: string;
              leftoverNoAtoms?: string;
            };
          };
        };
        if (!res.ok || !data.transaction) {
          throw new Error(data.error ?? "Withdraw request failed");
        }
        const tx = Transaction.from(Buffer.from(data.transaction, "base64"));
        const signed = await signTransaction(tx);
        const sig = await connection.sendRawTransaction(signed.serialize(), {
          skipPreflight: false,
        });
        await connection.confirmTransaction(sig, "confirmed");
        const r = data.log?.redeem;
        const receivedSummary = r
          ? summarizeWithdrawReceiveEstimate({
              usdcOutAtoms: r.usdcOutAtoms ?? "0",
              leftoverYesAtoms: r.leftoverYesAtoms ?? "0",
              leftoverNoAtoms: r.leftoverNoAtoms ?? "0",
              yesDecimals: balances.yesDecimals,
              noDecimals: balances.noDecimals,
            })
          : "";
        setWithdrawAmount("");
        setWithdrawLiquidityInRaw(null);
        await refreshLpPosition();
        setTxResult({
          kind: "success",
          line: "Withdraw successful",
          detailLine:
            receivedSummary.length > 0 ? `Received: ${receivedSummary}` : undefined,
          signature: sig,
        });
        onPoolTxSettled?.();
      }
    } catch (e) {
      setTxResult({
        kind: "error",
        message: logAndFormatUserTxError(
          e,
          withdrawAdvancedRawTokens ? "withdraw-pool" : "withdraw-usdc",
        ),
      });
    } finally {
      setLpSubmitting(false);
    }
  }, [
    connection,
    connect,
    connected,
    hasPool,
    lpAtoms,
    lpDecimals,
    market.pool,
    market.id,
    onPoolTxSettled,
    publicKey,
    refreshLpPosition,
    signTransaction,
    setVisible,
    wallet,
    withdrawAmount,
    withdrawAdvancedRawTokens,
    withdrawLiquidityInRaw,
    userOmLpAtaStr,
    balances.noDecimals,
    balances.noRaw,
    balances.yesDecimals,
    balances.yesRaw,
  ]);

  const onTradeError = useCallback((e: unknown) => {
    setTxResult({
      kind: "error",
      message: logAndFormatUserTxError(e, "trade"),
    });
  }, []);

  const onTradeInFlightChange = useCallback((inFlight: boolean) => {
    setTradeInFlight(inFlight);
    if (inFlight) setTxResult(null);
  }, []);

  function renderOutcomePriceLabel(side: "yes" | "no", p: number) {
    if (showOneSidedLiquidity) {
      return (
        <span className="text-zinc-600">{side === "yes" ? "Yes —" : "No —"}</span>
      );
    }
    if (showPriceLoading) {
      return (
        <span className="block text-[12px] font-medium text-zinc-500">
          {side === "yes" ? "Yes" : "No"} — Loading price…
        </span>
      );
    }
    if (showSubtlePriceUnavailable) {
      return (
        <span
          className={cn(
            "block text-[12px] font-medium",
            side === "yes" ? "text-zinc-500/70" : "text-red-200/60",
          )}
        >
          {side === "yes" ? "Yes" : "No"} — Price unavailable
        </span>
      );
    }
    return (
      <>
        {side === "yes" ? "Yes" : "No"}{" "}
        {formatProbabilityAsWholeCents(p)}
      </>
    );
  }

  const showResolvedRedeemForm =
    useDedicatedResolvedLayout && winningSide && redeemFlags.hasWinningBalance;
  const showAnySellForm = (!isResolved && actionTab === "sell") || showResolvedRedeemForm;
  const isBuyPanel = !isResolved && !isResolving && actionTab === "buy" && isBinary;
  const isSellPanel = showAnySellForm && !isResolving && isBinary;

  const actionStack = (
    <>
    <div className="rounded-xl bg-[#111] p-4 ring-1 ring-white/[0.06]">
      <h2 className="text-[12px] font-semibold text-zinc-300">Market Actions</h2>
      {isResolving &&
      (actionTab === "buy" ||
        actionTab === "sell" ||
        (variant === "market" && actionTab === "leverage")) ? (
        <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-950/35 px-3 py-2 text-center text-[11px] font-medium leading-snug text-amber-100/95 ring-1 ring-amber-500/15">
          Trading has ended. Resolution is in progress.
        </p>
      ) : null}
      <div
        className={cn(
          "mt-3 flex min-w-0 flex-wrap gap-x-3 gap-y-1 border-b border-white/[0.08] pb-2 sm:gap-x-4",
        )}
      >
        {(
          variant === "market"
            ? ([
                { id: "buy" as const, label: "Buy" },
                { id: "sell" as const, label: "Sell" },
                { id: "leverage" as const, label: "Leverage" },
              ] as const)
            : ([
                { id: "deposit" as const, label: "Deposit" },
                { id: "withdraw" as const, label: "Withdraw" },
                { id: "buy" as const, label: "Buy" },
                { id: "sell" as const, label: "Sell" },
              ] as const)
        ).map(({ id, label }) => (
          <button
            key={id}
            type="button"
            disabled={anyLocked}
            onClick={() => setActionTab(id)}
            className={cn(
              "relative pb-2 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50 sm:text-[14px]",
              actionTab === id
                ? "text-white after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:rounded-full after:bg-white"
                : "text-zinc-500 hover:text-zinc-300",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {variant === "earn" && actionTab === "deposit" && hasPool ? (
        <div className="mt-5">
          <p className="text-[12px] leading-relaxed text-zinc-500">
            Add devnet USDC. The protocol mints equal YES+NO and provides both
            sides. Network fees apply; the first add may open an LP token
            account.
          </p>
          <div className="trade-field mt-3 flex items-baseline justify-end gap-2 px-4 py-3">
            <span className="text-xl font-medium text-zinc-500">$</span>
            <input
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              inputMode="decimal"
              placeholder="0.00 USDC"
              disabled={anyLocked}
              className="min-w-0 flex-1 border-0 bg-transparent text-right text-2xl font-semibold tabular-nums tracking-tight text-white outline-none placeholder:text-zinc-600 sm:text-[1.6rem]"
            />
          </div>
          <div className="mt-4">
            <button
              type="button"
              onClick={onDeposit}
              disabled={anyLocked}
              className={tradeButtonClass}
            >
              {lpSubmitting && actionTab === "deposit" ? "Confirming..." : "Confirm deposit"}
            </button>
          </div>
        </div>
      ) : null}

      {variant === "earn" && actionTab === "deposit" && !hasPool ? (
        <p className="mt-4 text-[12px] text-zinc-500">
          No on-chain pool for this market.
        </p>
      ) : null}

      {variant === "earn" && actionTab === "withdraw" && hasPool ? (
        <div className="mt-5">
          {withdrawAdvancedRawTokens ? (
            <p className="text-[12px] leading-relaxed text-zinc-500">
              Burn omLP to receive YES and NO directly. A 1% protocol withdrawal
              fee remains in the pool.
            </p>
          ) : (
            <>
              <p className="text-[12px] leading-relaxed text-zinc-500">
                Withdraw converts your LP position back into USDC. A 1% protocol
                withdrawal fee remains in the pool.
              </p>
              {withdrawUsdcPlanLoading ? (
                <p className="mt-2 text-[11px] text-zinc-500">Estimating USDC…</p>
              ) : null}
              {withdrawUsdcPlanError ? (
                <p className="mt-2 text-[11px] font-medium text-amber-200/90" role="alert">
                  {withdrawUsdcPlanError}
                </p>
              ) : null}
              {!withdrawUsdcPlanLoading &&
              !withdrawUsdcPlanError &&
              withdrawPreview ? (
                <p className="mt-2 text-[12px] font-medium tabular-nums text-zinc-200">
                  You will receive:{" "}
                  {summarizeWithdrawReceiveEstimate({
                    usdcOutAtoms: withdrawPreview.usdcOutAtoms,
                    leftoverYesAtoms: withdrawPreview.leftoverYesAtoms,
                    leftoverNoAtoms: withdrawPreview.leftoverNoAtoms,
                    yesDecimals: balances.yesDecimals,
                    noDecimals: balances.noDecimals,
                  })}{" "}
                  <span className="font-normal text-zinc-500">(estimated)</span>
                </p>
              ) : null}
            </>
          )}
          <div className="trade-field mt-3 flex items-center gap-2 px-3 py-2.5 sm:px-4 sm:py-3">
            <input
              value={withdrawAmount}
              onChange={(e) => {
                setWithdrawLiquidityInRaw(null);
                setWithdrawAmount(e.target.value);
              }}
              inputMode="decimal"
              placeholder="0.00 omLP"
              disabled={anyLocked}
              className="min-w-0 flex-1 border-0 bg-transparent text-right text-2xl font-semibold tabular-nums tracking-tight text-white outline-none placeholder:text-zinc-600 sm:text-[1.6rem]"
            />
            <button
              type="button"
              onClick={setWithdrawToMax}
              disabled={
                anyLocked ||
                !connected ||
                !publicKey ||
                lpLoading ||
                lpAtoms == null ||
                lpAtoms === 0n
              }
              className={maxInlineClass}
            >
              Max
            </button>
          </div>
          <p className="mt-2 text-right text-[10px] tabular-nums text-zinc-600">
            Available: {omlpAvailableLine} omLP
          </p>
          <button
            type="button"
            onClick={() => setWithdrawAdvancedRawTokens((v) => !v)}
            disabled={anyLocked}
            className="mt-3 text-left text-[11px] font-medium text-zinc-400 underline decoration-zinc-600 underline-offset-2 hover:text-zinc-200"
          >
            {withdrawAdvancedRawTokens
              ? "Use standard USDC withdraw"
              : "Advanced: Withdraw as YES + NO"}
          </button>
          <div className="mt-4">
            <button
              type="button"
              onClick={onWithdraw}
              disabled={withdrawConfirmDisabled}
              className={tradeButtonClass}
            >
              {lpSubmitting && actionTab === "withdraw" ? "Confirming..." : "Confirm withdraw"}
            </button>
          </div>
        </div>
      ) : null}

      {variant === "earn" && actionTab === "withdraw" && !hasPool ? (
        <p className="mt-4 text-[12px] text-zinc-500">
          No on-chain pool for this market.
        </p>
      ) : null}

      {variant === "market" && actionTab === "leverage" && isBinary ? (
        <div className="mt-4">
          {!hasPool ? (
            <p className="text-[12px] text-zinc-500">
              No on-chain pool for this market.
            </p>
          ) : isResolved ? (
            <p className="text-[12px] text-zinc-500">
              This market is resolved. Outcome leverage is not available.
            </p>
          ) : isResolving ? null : onLeverageAfterTx ? (
            <MarketOutcomeLeveragePanel
              market={market}
              snapshot={omnipairSnapshot ?? null}
              onAfterTx={onLeverageAfterTx}
            />
          ) : (
            <p className="text-[12px] text-zinc-500">Coming soon</p>
          )}
        </div>
      ) : null}

      {isBuyPanel ? (
        <>
          {showOneSidedLiquidity ? (
            <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-950/35 px-3 py-2 text-center text-[11px] font-medium leading-snug text-amber-100/95 ring-1 ring-amber-500/15">
              One-sided liquidity detected — mids hidden until both sides are seeded.
            </p>
          ) : null}
          <div className="mt-4 grid grid-cols-2 gap-2">
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
              {renderOutcomePriceLabel("yes", yesP)}
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
              {renderOutcomePriceLabel("no", noP)}
            </button>
          </div>
          <div className="mt-5">
            <div className="trade-field mt-2 flex items-baseline justify-end gap-2 px-4 py-3">
              <span className="text-xl font-medium text-zinc-500">$</span>
              <input
                value={usdcAmount}
                onChange={(e) => setUsdcAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0"
                disabled={anyLocked}
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
                    disabled={anyLocked}
                    className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-medium text-zinc-400 transition hover:border-white/[0.14] hover:text-zinc-200"
                  >
                    +${n}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={setBuyUsdcMax}
                disabled={!connected || balances.usdcRaw <= 0n || anyLocked}
                className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-medium text-zinc-400 transition hover:border-white/[0.14] hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Max
              </button>
            </div>
            {connected && actionTab === "buy" && !balances.loading ? (
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
          <MarketTradingPrimaryButton
            market={market}
            side={buySide}
            usdcAmountHuman={usdcAmount}
            buyLabel={outcome === "yes" ? "Buy YES" : "Buy NO"}
            className={tradeButtonClass}
            onTradeSuccess={onBuySuccess}
            feedbackMode="none"
            onTxError={onTradeError}
            actionLocked={anyLocked}
            pendingLabel="Confirming..."
            onInFlightChange={onTradeInFlightChange}
          />
        </>
      ) : null}

      {isResolved && actionTab === "buy" ? (
        <p className="mt-4 text-[12px] text-zinc-500">
          This market is resolved. Open the Sell tab to exit or redeem.
        </p>
      ) : null}

      {useDedicatedResolvedLayout && actionTab === "sell" ? (
        <div className="mt-4 space-y-3">
          {!winningSide ? (
            <p className="rounded-lg border border-amber-500/20 bg-amber-950/25 px-3 py-2 text-[11px] text-amber-100/90">
              Outcome not recorded yet. Redeem may be unavailable.
            </p>
          ) : null}
          {showResolvedRedeemForm && connected && publicKey ? (
            <div>
              <p className="mb-2 text-[11px] font-medium text-zinc-400">Redeem</p>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-zinc-500">Shares</span>
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
                  disabled={anyLocked}
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
                    disabled={!connected || sellBalanceRaw <= 0n || anyLocked}
                    className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[11px] font-medium text-zinc-400 transition hover:border-white/[0.14] hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {label}
                  </button>
                ))}
              </div>
              {parsedOutcome > 0 ? (
                <div className="mt-3">
                  {sellPlanLoading ? (
                    <p className="text-[11px] text-zinc-600">Estimating payout…</p>
                  ) : sellPlanError ? (
                    <p className="text-[12px] text-amber-200/90">{sellPlanError}</p>
                  ) : sellPlan ? (
                    <div className="space-y-1.5 text-right">
                      {sellPlan.routeKind === "resolved_winner_redeem" ? (
                        <p className="text-[10px] text-zinc-500">
                          1 USDC per share, custody redemption
                        </p>
                      ) : (
                        <p className="text-[10px] text-zinc-500">
                          Route:{" "}
                          <span className="font-mono text-zinc-400">
                            {sellPlan.routeKind}
                          </span>
                        </p>
                      )}
                      <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
                        <span className="text-[11px] font-medium tracking-wide text-zinc-500">
                          {sellPlan.routeKind === "resolved_winner_redeem"
                            ? "Payout (USDC)"
                            : "Est. USDC (exit route)"}
                        </span>
                        {sellPlan.routeKind === "fallback_pool_swap" ? (
                          <div className="text-right text-[10px] text-amber-200/80">
                            No USDC on this path — {sellPlan.uiSummary}
                          </div>
                        ) : (
                          <>
                            <span className="text-[1.125rem] font-semibold tabular-nums tracking-tight text-zinc-50">
                              {formatUsdcAtomsHuman(sellPlan.usdcOutAtoms)}
                            </span>
                            <Image
                              src="/Circle_USDC_Logo.png"
                              alt=""
                              width={22}
                              height={22}
                              className="h-[22px] w-[22px] shrink-0 rounded-full"
                            />
                          </>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <MarketSellOutcomeButton
                market={market}
                sellSide={sideForSell}
                outcomeAmountHuman={outcomeAmount}
                sellLabel={sideForSell === "yes" ? "Redeem YES" : "Redeem NO"}
                forResolutionRedeem
                onTradeSuccess={onSellSuccess}
                className={tradeButtonClass}
                feedbackMode="none"
                onTxError={onTradeError}
                actionLocked={anyLocked}
                pendingLabel="Confirming..."
                onInFlightChange={onTradeInFlightChange}
              />
            </div>
          ) : null}
          {winningSide && connected && publicKey && !showResolvedRedeemForm ? (
            <p className="mt-2 text-[12px] text-zinc-500">
              No redeemable winning outcome balance in this wallet.
            </p>
          ) : null}
        </div>
      ) : null}

      {isSellPanel && !useDedicatedResolvedLayout ? (
        <>
          {showOneSidedLiquidity && actionTab === "sell" ? (
            <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-950/35 px-3 py-2 text-center text-[11px] font-medium leading-snug text-amber-100/95 ring-1 ring-amber-500/15">
              One-sided liquidity detected — mids hidden until both sides are seeded.
            </p>
          ) : null}
          <div className="mt-4 grid grid-cols-2 gap-2">
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
              {renderOutcomePriceLabel("yes", yesP)}
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
              {renderOutcomePriceLabel("no", noP)}
            </button>
          </div>
          <div className="mt-5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-zinc-500">Shares</span>
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
                disabled={anyLocked}
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
                  disabled={!connected || sellBalanceRaw <= 0n || anyLocked}
                  className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[11px] font-medium text-zinc-400 transition hover:border-white/[0.14] hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {label}
                </button>
              ))}
            </div>
            {connected && publicKey && parsedOutcome > 0 ? (
              <div className="mt-3 border-t border-white/[0.06] pt-3">
                {sellPlanLoading ? (
                  <p className="text-[11px] text-zinc-600">Estimating exit route…</p>
                ) : sellPlanError ? (
                  <p className="text-[12px] text-amber-200/90">{sellPlanError}</p>
                ) : sellPlan ? (
                  <div className="space-y-1.5 text-right">
                    <p className="text-[10px] text-zinc-500">
                      Route:{" "}
                      <span className="font-mono text-zinc-400">
                        {sellPlan.routeKind}
                      </span>
                    </p>
                    <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
                      <span className="text-[11px] font-medium tracking-wide text-zinc-500">
                        Est. USDC (exit route)
                      </span>
                      {sellPlan.routeKind === "fallback_pool_swap" ? (
                        <span className="max-w-full text-right text-[10px] text-amber-200/80">
                          No USDC — {sellPlan.uiSummary}
                        </span>
                      ) : (
                        <>
                          <span className="text-[1.125rem] font-semibold tabular-nums tracking-tight text-zinc-50">
                            {formatUsdcAtomsHuman(sellPlan.usdcOutAtoms)}
                          </span>
                          <Image
                            src="/Circle_USDC_Logo.png"
                            alt=""
                            width={22}
                            height={22}
                            className="h-[22px] w-[22px] shrink-0 rounded-full"
                          />
                        </>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          <MarketSellOutcomeButton
            market={market}
            sellSide={sideForSell}
            outcomeAmountHuman={outcomeAmount}
            sellLabel={
              sideForSell === "yes" ? "Sell YES" : "Sell NO"
            }
            forResolutionRedeem={false}
            onTradeSuccess={onSellSuccess}
            className={tradeButtonClass}
            feedbackMode="none"
            onTxError={onTradeError}
            actionLocked={anyLocked}
            pendingLabel="Confirming..."
            onInFlightChange={onTradeInFlightChange}
          />
        </>
      ) : null}

      {txResult?.kind === "success" ? (
        <div className="mt-4 rounded-lg border border-emerald-500/25 bg-emerald-950/30 px-3 py-2.5 ring-1 ring-emerald-500/15">
          <p className="text-[11px] font-medium text-emerald-200/95">{txResult.line}</p>
          {txResult.detailLine ? (
            <p className="mt-1 text-[11px] text-emerald-100/90">{txResult.detailLine}</p>
          ) : null}
          <a
            href={devnetTxExplorerUrl(txResult.signature)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-block text-[11px] text-emerald-400/95 underline decoration-emerald-500/40 underline-offset-2 hover:text-emerald-300"
          >
            View on Explorer
          </a>
        </div>
      ) : null}

      {txResult?.kind === "error" ? (
        <div className="mt-4 rounded-lg border border-red-500/20 bg-red-950/30 px-3 py-2.5 ring-1 ring-red-500/10">
          <p className="text-[12px] leading-relaxed text-red-200/90" role="alert">
            {txResult.message}
          </p>
        </div>
      ) : null}
    </div>
      {variant === "earn" ? (
        <p className="mt-2 max-w-lg px-1 text-[10px] leading-relaxed text-yellow-300 sm:px-2 sm:text-[11px]">
          <span className="font-medium text-yellow-300">Earn (LP):</span> provide YES+NO
          to the pool (via devnet USDC full-set) and receive LP shares. LPs earn fees
          from trading activity but are exposed to market outcome risk. APR is an
          estimate, not a promise of return.
        </p>
      ) : null}
      {!connected && isBinary ? (
        <p className="mt-2 text-center text-[10px] text-zinc-600">
          Connect a wallet to load balances. Estimates are indicative.
        </p>
      ) : null}
    </>
  );

  if (!isBinary) {
    return null;
  }

  if (wrapInDefiWell) {
    return (
      <div className={cn(defiWellPanel, "overflow-hidden p-0")}>
        <div className="p-3 sm:p-4 sm:pt-3">{actionStack}</div>
      </div>
    );
  }

  return actionStack;
}

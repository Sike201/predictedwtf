"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, SendTransactionError } from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { TxExplorerLink } from "@/components/market/tx-explorer-link";
import { useWallet } from "@/lib/hooks/use-wallet";
import { useMarketTradingBalances } from "@/lib/hooks/use-market-trading-balances";
import type { Market } from "@/lib/types/market";
import {
  buildCloseLeveragedNoPositionTransaction,
  buildCloseLeveragedYesPositionTransaction,
} from "@/lib/solana/omnipair-close-leverage";
import { buildLeverageNoTransaction } from "@/lib/solana/omnipair-leverage-no";
import { buildLeverageYesTransaction } from "@/lib/solana/omnipair-leverage-yes";
import type {
  LeveragePreviewNoResult,
  LeveragePreviewYesResult,
} from "@/lib/solana/omnipair-leverage-preview";
import {
  previewLeverageNo,
  previewLeverageYes,
} from "@/lib/solana/omnipair-leverage-preview";
import {
  ADAPTIVE_LEVERAGE_GLOBAL_CAP,
  type LeverageUiTier,
} from "@/lib/market/adaptive-leverage-cap";
import {
  readWalletOutcomeSnapshot,
  walletOutcomeReturnDelta,
} from "@/lib/market/close-position-wallet-delta";
import { persistLeverageTargetAtOpen } from "@/lib/market/leverage-target-storage";
import { isDuplicateSolanaSubmitError } from "@/lib/market/solana-submit-errors";
import { outcomeLeverageMultiple } from "@/lib/market/outcome-leverage-multiple";
import { LeveragePremiumSlider } from "@/components/trading/leverage-premium-slider";
import { logUserPositionAccountAfterLeverageTx } from "@/lib/solana/log-user-position-debug";
import {
  formatBaseUnitsToDecimalString,
  parseDecimalStringToBaseUnits,
} from "@/lib/solana/wallet-token-balances";
import { cn } from "@/lib/utils/cn";

const SLIPPAGE_BPS = 150;

const LEV_TIER2_THRESHOLD = 1.75;
const LEV_TIER3_THRESHOLD = 2.75;

const LEV_SUBMIT_LOG = "[predicted][leverage-submit]";
const LEV_PAYOUT_LOG = "[predicted][payout-estimate][leverage]";

function errorText(e: unknown): string {
  /** `SendTransactionError` embeds RPC `transactionMessage` in `message` (simulation / send). */
  if (e instanceof SendTransactionError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

function fmtUsd(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `$${v.toFixed(2)}`;
}

function zeroYesPreview(base: LeveragePreviewYesResult): LeveragePreviewYesResult {
  return {
    maxBorrowOppositeAtoms: 0n,
    borrowNoAtoms: 0n,
    estimatedYesOutAtoms: 0n,
    minYesOutAtoms: 0n,
    noAta: base.noAta,
    yesAta: base.yesAta,
  };
}

function zeroNoPreview(base: LeveragePreviewNoResult): LeveragePreviewNoResult {
  return {
    maxBorrowOppositeAtoms: 0n,
    borrowYesAtoms: 0n,
    estimatedNoOutAtoms: 0n,
    minNoOutAtoms: 0n,
    noAta: base.noAta,
    yesAta: base.yesAta,
  };
}

function parseApiYesPreview(p: {
  borrowNoAtoms: string;
  estimatedYesOutAtoms: string;
  minYesOutAtoms: string;
  noAta: string;
  yesAta: string;
  maxBorrowOppositeAtoms?: string;
}): LeveragePreviewYesResult {
  const borrow = BigInt(p.borrowNoAtoms);
  return {
    maxBorrowOppositeAtoms: BigInt(p.maxBorrowOppositeAtoms ?? p.borrowNoAtoms),
    borrowNoAtoms: borrow,
    estimatedYesOutAtoms: BigInt(p.estimatedYesOutAtoms),
    minYesOutAtoms: BigInt(p.minYesOutAtoms),
    noAta: new PublicKey(p.noAta),
    yesAta: new PublicKey(p.yesAta),
  };
}

function parseApiNoPreview(p: {
  borrowYesAtoms: string;
  estimatedNoOutAtoms: string;
  minNoOutAtoms: string;
  noAta: string;
  yesAta: string;
  maxBorrowOppositeAtoms?: string;
}): LeveragePreviewNoResult {
  const borrow = BigInt(p.borrowYesAtoms);
  return {
    maxBorrowOppositeAtoms: BigInt(p.maxBorrowOppositeAtoms ?? p.borrowYesAtoms),
    borrowYesAtoms: borrow,
    estimatedNoOutAtoms: BigInt(p.estimatedNoOutAtoms),
    minNoOutAtoms: BigInt(p.minNoOutAtoms),
    noAta: new PublicKey(p.noAta),
    yesAta: new PublicKey(p.yesAta),
  };
}

/** On-chain lending totals — wallet-free; used for “Increase vs Open” only. */
export type OmnipairPositionSummary = {
  collateralYesAtoms: string;
  collateralNoAtoms: string;
  debtYesAtoms: string;
  debtNoAtoms: string;
};

type Props = {
  market: Market;
  omnipairPosition: OmnipairPositionSummary | null;
  /** Fires after a confirmed leverage or close tx. May return a Promise (e.g. awaited refetch). */
  onSettled?: (
    detail?: { signature: string },
  ) => void | Promise<void>;
  /** When the parent already shows a “Leverage” heading (e.g. collapsible panel). */
  hideSectionTitle?: boolean;
};

export function MarketLeverageSection({
  market,
  omnipairPosition,
  onSettled,
  hideSectionTitle = false,
}: Props) {
  const { connection } = useConnection();
  const { publicKey, connected, signTransaction } = useWallet();
  const balances = useMarketTradingBalances(market, publicKey);

  const pool = market.pool;
  const [internalSide, setInternalSide] = useState<"yes" | "no">("yes");
  const [internalCollateralHuman, setInternalCollateralHuman] = useState("");
  /** 0 = no borrow (~1×), 100 = full pool max borrow for this deposit. */
  const [sliderPct, setSliderPct] = useState(0);
  const [leverageTier, setLeverageTier] = useState<LeverageUiTier>(1);
  /** When true, tier→slider sync does not overwrite `sliderPct` (e.g. after “Max − 0.01”). */
  const [sliderLockMaxMinus, setSliderLockMaxMinus] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [maxPreviewError, setMaxPreviewError] = useState<string | null>(null);
  /** Preview at 100% of max borrow — sets the slider ceiling / “max ×”. */
  const [maxPreviewLoading, setMaxPreviewLoading] = useState(false);
  const [maxPreviewYes, setMaxPreviewYes] = useState<LeveragePreviewYesResult | null>(
    null,
  );
  const [maxPreviewNo, setMaxPreviewNo] = useState<LeveragePreviewNoResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewYes, setPreviewYes] = useState<LeveragePreviewYesResult | null>(null);
  const [previewNo, setPreviewNo] = useState<LeveragePreviewNoResult | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [lastSig, setLastSig] = useState<string | null>(null);
  const [lastCloseDetail, setLastCloseDetail] = useState<{
    closeSig: string;
    returnedYesHuman: string;
    returnedNoHuman: string;
    walletYesAfterHuman: string;
    walletNoAfterHuman: string;
    walletUsdcAfterHuman: string;
  } | null>(null);
  /** Prevents overlapping leverage open/close (React state is async; double-clicks can slip through). */
  const leverageSubmitInFlightRef = useRef(false);
  const pairAddress = useMemo(
    () => (pool?.poolId ? new PublicKey(pool.poolId) : null),
    [pool?.poolId],
  );
  const yesMint = useMemo(
    () => (pool?.yesMint ? new PublicKey(pool.yesMint) : null),
    [pool?.yesMint],
  );
  const noMint = useMemo(
    () => (pool?.noMint ? new PublicKey(pool.noMint) : null),
    [pool?.noMint],
  );

  const slider01 = sliderPct / 100;

  const side = internalSide;

  /** Free outcome tokens in wallet (not locked in Omnipair). */
  const walletFreeYes = balances.yesRaw;
  const walletFreeNo = balances.noRaw;

  const collateralAtoms = useMemo(() => {
    if (!pool) return null;
    const dec = side === "yes" ? balances.yesDecimals : balances.noDecimals;
    try {
      return parseDecimalStringToBaseUnits(
        internalCollateralHuman.trim() || "0",
        dec,
      );
    } catch {
      return null;
    }
  }, [balances.noDecimals, balances.yesDecimals, internalCollateralHuman, pool, side]);

  const walletCapForSide = side === "yes" ? walletFreeYes : walletFreeNo;

  const riskExceedsWallet = useMemo(() => {
    if (collateralAtoms == null) return false;
    return collateralAtoms > walletCapForSide;
  }, [collateralAtoms, walletCapForSide]);

  const hasYesLeverageTrack = useMemo(() => {
    if (!omnipairPosition) return false;
    return (
      BigInt(omnipairPosition.collateralYesAtoms) > 0n ||
      BigInt(omnipairPosition.debtNoAtoms) > 0n
    );
  }, [omnipairPosition]);

  const hasNoLeverageTrack = useMemo(() => {
    if (!omnipairPosition) return false;
    return (
      BigInt(omnipairPosition.collateralNoAtoms) > 0n ||
      BigInt(omnipairPosition.debtYesAtoms) > 0n
    );
  }, [omnipairPosition]);

  const primaryCtaLabel = useMemo(() => {
    if (side === "yes") {
      return hasYesLeverageTrack ? "Increase YES leverage" : "Open YES leverage";
    }
    return hasNoLeverageTrack ? "Increase NO leverage" : "Open NO leverage";
  }, [hasNoLeverageTrack, hasYesLeverageTrack, side]);

  useEffect(() => {
    setInternalCollateralHuman("");
    setSliderPct(0);
    setLeverageTier(1);
    setSliderLockMaxMinus(false);
  }, [internalSide]);

  /** Discover pool max borrow for this collateral (slider = 100% of that cap). */
  useEffect(() => {
    setMaxPreviewError(null);
    setMaxPreviewYes(null);
    setMaxPreviewNo(null);

    if (!connected || !publicKey || !pairAddress || !yesMint || !noMint) return;
    if (collateralAtoms == null || collateralAtoms <= 0n) return;
    if (riskExceedsWallet) return;

    const ac = new AbortController();
    const t = window.setTimeout(() => {
      setMaxPreviewLoading(true);
      const onFail = (e: unknown) => {
        setMaxPreviewError(
          e instanceof Error ? e.message : "Could not estimate max borrow",
        );
        setMaxPreviewYes(null);
        setMaxPreviewNo(null);
      };
      if (side === "yes") {
        previewLeverageYes({
          connection,
          user: publicKey,
          pairAddress,
          yesMint,
          noMint,
          collateralYesAtoms: collateralAtoms,
          slippageBps: SLIPPAGE_BPS,
          leverageSlider01: 1,
        })
          .then((p) => {
            setMaxPreviewYes(p);
            setMaxPreviewNo(null);
            setMaxPreviewError(null);
          })
          .catch(onFail)
          .finally(() => setMaxPreviewLoading(false));
      } else {
        previewLeverageNo({
          connection,
          user: publicKey,
          pairAddress,
          yesMint,
          noMint,
          collateralNoAtoms: collateralAtoms,
          slippageBps: SLIPPAGE_BPS,
          leverageSlider01: 1,
        })
          .then((p) => {
            setMaxPreviewNo(p);
            setMaxPreviewYes(null);
            setMaxPreviewError(null);
          })
          .catch(onFail)
          .finally(() => setMaxPreviewLoading(false));
      }
    }, 380);

    return () => {
      ac.abort();
      window.clearTimeout(t);
    };
  }, [
    connected,
    publicKey,
    pairAddress,
    yesMint,
    noMint,
    connection,
    collateralAtoms,
    riskExceedsWallet,
    side,
    market.id,
  ]);

  /** Apply borrow fraction = slider × max borrow (from pool simulation). */
  useEffect(() => {
    if (!connected || !publicKey || !pairAddress || !yesMint || !noMint) {
      setPreviewError(null);
      setPreviewYes(null);
      setPreviewNo(null);
      return;
    }
    if (collateralAtoms == null || collateralAtoms <= 0n) {
      setPreviewError(null);
      setPreviewYes(null);
      setPreviewNo(null);
      return;
    }
    if (riskExceedsWallet) {
      setPreviewError(null);
      setPreviewYes(null);
      setPreviewNo(null);
      return;
    }

    setPreviewError(null);

    const maxP = side === "yes" ? maxPreviewYes : maxPreviewNo;
    if (!maxP) {
      setPreviewYes(null);
      setPreviewNo(null);
      return;
    }

    const f = slider01;
    if (f <= 0) {
      if (side === "yes") {
        setPreviewYes(zeroYesPreview(maxP as LeveragePreviewYesResult));
        setPreviewNo(null);
      } else {
        setPreviewNo(zeroNoPreview(maxP as LeveragePreviewNoResult));
        setPreviewYes(null);
      }
      setPreviewLoading(false);
      setPreviewError(null);
      return;
    }

    if (f >= 1 - 1e-9) {
      if (side === "yes") {
        setPreviewYes(maxP as LeveragePreviewYesResult);
        setPreviewNo(null);
      } else {
        setPreviewNo(maxP as LeveragePreviewNoResult);
        setPreviewYes(null);
      }
      setPreviewLoading(false);
      setPreviewError(null);
      return;
    }

    const ac = new AbortController();
    const t = window.setTimeout(() => {
      if (ac.signal.aborted) return;
      setPreviewLoading(true);
      const onPreviewFail = (e: unknown) => {
        if (ac.signal.aborted) return;
        setPreviewError(
          e instanceof Error ? e.message : "Could not preview leverage",
        );
        setPreviewYes(null);
        setPreviewNo(null);
      };
      if (side === "yes") {
        previewLeverageYes({
          connection,
          user: publicKey,
          pairAddress,
          yesMint,
          noMint,
          collateralYesAtoms: collateralAtoms,
          slippageBps: SLIPPAGE_BPS,
          leverageSlider01: f,
        })
          .then((p) => {
            if (ac.signal.aborted) return;
            setPreviewYes(p);
            setPreviewNo(null);
            setPreviewError(null);
          })
          .catch(onPreviewFail)
          .finally(() => {
            if (!ac.signal.aborted) setPreviewLoading(false);
          });
      } else {
        previewLeverageNo({
          connection,
          user: publicKey,
          pairAddress,
          yesMint,
          noMint,
          collateralNoAtoms: collateralAtoms,
          slippageBps: SLIPPAGE_BPS,
          leverageSlider01: f,
        })
          .then((p) => {
            if (ac.signal.aborted) return;
            setPreviewNo(p);
            setPreviewYes(null);
            setPreviewError(null);
          })
          .catch(onPreviewFail)
          .finally(() => {
            if (!ac.signal.aborted) setPreviewLoading(false);
          });
      }
    }, 120);

    return () => {
      ac.abort();
      window.clearTimeout(t);
    };
  }, [
    connected,
    publicKey,
    pairAddress,
    yesMint,
    noMint,
    connection,
    collateralAtoms,
    riskExceedsWallet,
    side,
    slider01,
    maxPreviewYes,
    maxPreviewNo,
    market.id,
  ]);

  const maxLeverageMultiple = useMemo(() => {
    if (collateralAtoms == null || collateralAtoms <= 0n) return null;
    const mp = side === "yes" ? maxPreviewYes : maxPreviewNo;
    if (!mp) return null;
    return outcomeLeverageMultiple(side, collateralAtoms, mp);
  }, [collateralAtoms, maxPreviewNo, maxPreviewYes, side]);

  const rawMaxLevForTiers = maxLeverageMultiple;
  const tier2Enabled =
    rawMaxLevForTiers != null &&
    rawMaxLevForTiers >= LEV_TIER2_THRESHOLD - 1e-9;
  const tier3Enabled =
    rawMaxLevForTiers != null &&
    rawMaxLevForTiers >= LEV_TIER3_THRESHOLD - 1e-9;

  useEffect(() => {
    if (!tier3Enabled && leverageTier === 3) {
      setLeverageTier(tier2Enabled ? 2 : 1);
      return;
    }
    if (!tier2Enabled && leverageTier === 2) {
      setLeverageTier(1);
    }
  }, [tier2Enabled, tier3Enabled, leverageTier]);

  /** 1× / 2× / 3× chips → borrow fraction of pool max. */
  useEffect(() => {
    if (sliderLockMaxMinus) return;
    if (leverageTier === 1) {
      setSliderPct(0);
      return;
    }
    if (maxLeverageMultiple == null || maxLeverageMultiple <= 1) {
      setSliderPct(0);
      return;
    }
    const targetMult = Math.min(leverageTier, maxLeverageMultiple);
    const f = (targetMult - 1) / (maxLeverageMultiple - 1);
    setSliderPct(Math.round(Math.max(0, Math.min(1, f)) * 100));
  }, [leverageTier, maxLeverageMultiple, side, sliderLockMaxMinus]);

  const protocolMaxLeverageForSize = useMemo(() => {
    if (maxLeverageMultiple == null || !Number.isFinite(maxLeverageMultiple)) return null;
    const capped = Math.min(ADAPTIVE_LEVERAGE_GLOBAL_CAP, maxLeverageMultiple);
    return capped > 1 ? capped : null;
  }, [maxLeverageMultiple]);

  const applyMaxBorrowMinusEpsilon = useCallback(() => {
    if (maxLeverageMultiple == null || maxLeverageMultiple <= 1) return;
    const denom = maxLeverageMultiple - 1;
    if (denom <= 0) return;
    const capped = Math.min(ADAPTIVE_LEVERAGE_GLOBAL_CAP, maxLeverageMultiple);
    const targetMult = Math.max(1.001, capped - 0.01);
    const f = (targetMult - 1) / denom;
    const pct = Math.round(Math.max(0, Math.min(1, f)) * 100);
    setSliderPct(pct);
    setSliderLockMaxMinus(true);
    if (pct <= 0) {
      setLeverageTier(1);
      return;
    }
    const implied = 1 + (pct / 100) * denom;
    setLeverageTier(implied >= 2.5 ? 3 : implied >= 1.5 ? 2 : 2);
  }, [maxLeverageMultiple]);

  const borrowPowerError = useMemo(() => {
    if (slider01 <= 0) return null;
    const cap =
      side === "yes"
        ? maxPreviewYes?.maxBorrowOppositeAtoms
        : maxPreviewNo?.maxBorrowOppositeAtoms;
    const req =
      side === "yes" ? previewYes?.borrowNoAtoms : previewNo?.borrowYesAtoms;
    if (cap == null || req == null) return null;
    if (req <= cap) return null;
    return "Leverage exceeds current borrowing power. Reduce size or leverage.";
  }, [slider01, side, maxPreviewYes, maxPreviewNo, previewYes, previewNo]);

  const borrowAtomsPositive =
    side === "yes"
      ? previewYes != null && previewYes.borrowNoAtoms > 0n
      : previewNo != null && previewNo.borrowYesAtoms > 0n;

  const setCollateralToWalletMax = useCallback(() => {
    const dec = side === "yes" ? balances.yesDecimals : balances.noDecimals;
    const raw = side === "yes" ? walletFreeYes : walletFreeNo;
    setInternalCollateralHuman(formatBaseUnitsToDecimalString(raw, dec, 8));
  }, [balances.noDecimals, balances.yesDecimals, side, walletFreeNo, walletFreeYes]);

  const onOpenLeverage = useCallback(async () => {
    if (leverageSubmitInFlightRef.current) {
      console.info(LEV_SUBMIT_LOG, "ignored_concurrent_open");
      return;
    }
    leverageSubmitInFlightRef.current = true;
    setActionBusy(true);
    setActionError(null);
    setLastSig(null);
    setLastCloseDetail(null);

    let walletHasSigned = false;
    let submittedSigForLastAttempt: string | undefined;
    try {
      console.info(
        LEV_SUBMIT_LOG,
        "click_start",
        JSON.stringify({ marketId: market.id, side }),
      );

      if (!connected || !publicKey || !signTransaction) {
        setActionError("Connect a wallet.");
        return;
      }
      if (!pairAddress || !yesMint || !noMint || collateralAtoms == null || collateralAtoms <= 0n) {
        setActionError("Enter collateral from your wallet.");
        return;
      }
      if (riskExceedsWallet) {
        setActionError("Collateral exceeds wallet balance.");
        return;
      }
      if (slider01 <= 0) {
        setActionError("Choose 2× or 3× leverage to borrow.");
        return;
      }
      if (borrowPowerError) {
        const extra =
          protocolMaxLeverageForSize != null
            ? ` Max leverage for this size is ${protocolMaxLeverageForSize.toFixed(2)}×.`
            : "";
        setActionError(`${borrowPowerError}${extra}`);
        return;
      }

      if (side === "yes") {
        console.info(LEV_SUBMIT_LOG, "preview_request", JSON.stringify({ side: "yes" }));
        const previewYesOnly = await previewLeverageYes({
          connection,
          user: publicKey,
          pairAddress,
          yesMint,
          noMint,
          collateralYesAtoms: collateralAtoms,
          slippageBps: SLIPPAGE_BPS,
          leverageSlider01: slider01,
        });
        console.info(LEV_SUBMIT_LOG, "build_unsigned_request", JSON.stringify({ side: "yes" }));
        const built = await buildLeverageYesTransaction({
          connection,
          user: publicKey,
          pairAddress,
          yesMint,
          noMint,
          collateralYesAtoms: collateralAtoms,
          slippageBps: SLIPPAGE_BPS,
          leverageSlider01: slider01,
          preview: previewYesOnly,
        });
        const { blockhash, lastValidBlockHeight } =
          await connection.getLatestBlockhash("confirmed");
        console.info(
          LEV_SUBMIT_LOG,
          "tx_recentBlockhash_applied",
          JSON.stringify({
            recentBlockhashPrefix: blockhash.slice(0, 12),
            lastValidBlockHeight,
          }),
        );
        built.transaction.feePayer = publicKey;
        built.transaction.recentBlockhash = blockhash;

        console.info(LEV_SUBMIT_LOG, "wallet_sign_start");
        const signed = await signTransaction(built.transaction);
        walletHasSigned = true;
        console.info(LEV_SUBMIT_LOG, "wallet_sign_complete");

        console.info(LEV_SUBMIT_LOG, "send_start");
        const sig = await connection.sendRawTransaction(signed.serialize(), {
          skipPreflight: false,
          maxRetries: 0,
        });
        submittedSigForLastAttempt = sig;
        console.info(
          LEV_SUBMIT_LOG,
          "signature_returned",
          JSON.stringify({ signature: sig }),
        );
        console.info(
          LEV_SUBMIT_LOG,
          "confirm_start",
          JSON.stringify({ signature: sig }),
        );
        await connection.confirmTransaction(
          { signature: sig, blockhash, lastValidBlockHeight },
          "confirmed",
        );
        console.info(
          LEV_SUBMIT_LOG,
          "confirm_complete",
          JSON.stringify({ signature: sig }),
        );

        setLastSig(sig);
        persistLeverageTargetAtOpen(
          market.id,
          outcomeLeverageMultiple("yes", collateralAtoms, previewYesOnly),
        );
        if (pairAddress && publicKey) {
          await logUserPositionAccountAfterLeverageTx({
            connection,
            pairAddress,
            user: publicKey,
          });
        }
        await Promise.resolve(onSettled?.({ signature: sig }));
      } else {
        console.info(LEV_SUBMIT_LOG, "preview_request", JSON.stringify({ side: "no" }));
        const previewNoOnly = await previewLeverageNo({
          connection,
          user: publicKey,
          pairAddress,
          yesMint,
          noMint,
          collateralNoAtoms: collateralAtoms,
          slippageBps: SLIPPAGE_BPS,
          leverageSlider01: slider01,
        });
        console.info(LEV_SUBMIT_LOG, "build_unsigned_request", JSON.stringify({ side: "no" }));
        const built = await buildLeverageNoTransaction({
          connection,
          user: publicKey,
          pairAddress,
          yesMint,
          noMint,
          collateralNoAtoms: collateralAtoms,
          slippageBps: SLIPPAGE_BPS,
          leverageSlider01: slider01,
          preview: previewNoOnly,
        });
        const { blockhash, lastValidBlockHeight } =
          await connection.getLatestBlockhash("confirmed");
        console.info(
          LEV_SUBMIT_LOG,
          "tx_recentBlockhash_applied",
          JSON.stringify({
            recentBlockhashPrefix: blockhash.slice(0, 12),
            lastValidBlockHeight,
          }),
        );
        built.transaction.feePayer = publicKey;
        built.transaction.recentBlockhash = blockhash;

        console.info(LEV_SUBMIT_LOG, "wallet_sign_start");
        const signed = await signTransaction(built.transaction);
        walletHasSigned = true;
        console.info(LEV_SUBMIT_LOG, "wallet_sign_complete");

        console.info(LEV_SUBMIT_LOG, "send_start");
        const sig = await connection.sendRawTransaction(signed.serialize(), {
          skipPreflight: false,
          maxRetries: 0,
        });
        submittedSigForLastAttempt = sig;
        console.info(
          LEV_SUBMIT_LOG,
          "signature_returned",
          JSON.stringify({ signature: sig }),
        );
        console.info(
          LEV_SUBMIT_LOG,
          "confirm_start",
          JSON.stringify({ signature: sig }),
        );
        await connection.confirmTransaction(
          { signature: sig, blockhash, lastValidBlockHeight },
          "confirmed",
        );
        console.info(
          LEV_SUBMIT_LOG,
          "confirm_complete",
          JSON.stringify({ signature: sig }),
        );

        setLastSig(sig);
        persistLeverageTargetAtOpen(
          market.id,
          outcomeLeverageMultiple("no", collateralAtoms, previewNoOnly),
        );
        if (pairAddress && publicKey) {
          await logUserPositionAccountAfterLeverageTx({
            connection,
            pairAddress,
            user: publicKey,
          });
        }
        await Promise.resolve(onSettled?.({ signature: sig }));
      }
    } catch (e: unknown) {
      const raw = errorText(e);
      if (isDuplicateSolanaSubmitError(raw)) {
        console.warn(
          LEV_SUBMIT_LOG,
          "duplicate_submit_detected",
          JSON.stringify({ message: raw, walletHasSigned }),
        );
        setActionError(
          "This transaction may have already confirmed. Refreshing your balances…",
        );
        balances.refresh();
        if (process.env.NODE_ENV === "development") {
          console.info("[predicted][volume-verify] leverage_duplicate_submit", {
            hadSubmittedSig: Boolean(submittedSigForLastAttempt),
            sig: submittedSigForLastAttempt ?? null,
          });
        }
        await Promise.resolve(
          onSettled?.(
            submittedSigForLastAttempt
              ? { signature: submittedSigForLastAttempt }
              : undefined,
          ),
        );
        return;
      }
      const msg =
        typeof raw === "string" && raw.includes("Transaction failed after signing")
          ? raw
          : walletHasSigned
            ? `Transaction failed after signing: ${raw}`
            : raw;
      const borrowPowerFail =
        /BorrowingPowerExceeded|Borrowing power exceeded/i.test(String(raw)) ||
        raw.includes("borrow exceeds");
      const friendly = borrowPowerFail
        ? protocolMaxLeverageForSize != null
          ? `Borrowing power exceeded. Max leverage for this size is ${protocolMaxLeverageForSize.toFixed(2)}×.`
          : "Borrowing power exceeded."
        : msg;
      setActionError(friendly);
      console.warn(
        LEV_SUBMIT_LOG,
        "error",
        JSON.stringify({
          message: raw,
          displayed: friendly,
          walletHasSigned,
        }),
      );
    } finally {
      leverageSubmitInFlightRef.current = false;
      setActionBusy(false);
    }
  }, [
    collateralAtoms,
    connection,
    market.id,
    onSettled,
    pairAddress,
    previewNo,
    previewYes,
    publicKey,
    riskExceedsWallet,
    side,
    signTransaction,
    slider01,
    borrowPowerError,
    yesMint,
    noMint,
    connected,
    protocolMaxLeverageForSize,
  ]);

  const onCloseLeverage = useCallback(
    async function onCloseLeverage(which: "yes" | "no") {
      if (leverageSubmitInFlightRef.current) {
        console.info(LEV_SUBMIT_LOG, "ignored_concurrent_close");
        return;
      }
      leverageSubmitInFlightRef.current = true;
      setActionBusy(true);
      setActionError(null);
      setLastSig(null);
      setLastCloseDetail(null);

      let closeSubmittedSig: string | undefined;
      try {
        console.info(
          LEV_SUBMIT_LOG,
          "close_click_start",
          JSON.stringify({ which, marketId: market.id }),
        );

        if (!connected || !publicKey || !signTransaction) {
          setActionError("Connect a wallet.");
          return;
        }
        if (!pairAddress || !yesMint || !noMint) return;

        const walletBefore = await readWalletOutcomeSnapshot({
          connection,
          owner: publicKey,
          yesMint,
          noMint,
        });

        console.info(
          LEV_SUBMIT_LOG,
          "close_build_unsigned_request",
          JSON.stringify({ which }),
        );
        const built =
          which === "yes"
            ? await buildCloseLeveragedYesPositionTransaction({
                connection,
                user: publicKey,
                pairAddress,
                yesMint,
                noMint,
                slippageBps: SLIPPAGE_BPS,
              })
            : await buildCloseLeveragedNoPositionTransaction({
                connection,
                user: publicKey,
                pairAddress,
                yesMint,
                noMint,
                slippageBps: SLIPPAGE_BPS,
              });

        console.info(
          LEV_SUBMIT_LOG,
          "close_tx_built",
          JSON.stringify({
            which,
            buildLog: built.log,
            ixCount: built.transaction.instructions.length,
          }),
        );

        const { blockhash, lastValidBlockHeight } =
          await connection.getLatestBlockhash("confirmed");
        console.info(
          LEV_SUBMIT_LOG,
          "close_tx_recentBlockhash_applied",
          JSON.stringify({
            recentBlockhashPrefix: blockhash.slice(0, 12),
            lastValidBlockHeight,
          }),
        );
        built.transaction.feePayer = publicKey;
        built.transaction.recentBlockhash = blockhash;

        console.info(LEV_SUBMIT_LOG, "close_wallet_sign_start");
        const signed = await signTransaction(built.transaction);
        console.info(LEV_SUBMIT_LOG, "close_wallet_sign_complete");

        console.info(LEV_SUBMIT_LOG, "close_send_start");
        const rawClose = signed.serialize();
        const sig = await connection.sendRawTransaction(rawClose, {
          skipPreflight: false,
          maxRetries: 0,
        });
        closeSubmittedSig = sig;
        console.info(
          LEV_SUBMIT_LOG,
          "close_signature_returned",
          JSON.stringify({ signature: sig }),
        );
        console.info(
          LEV_SUBMIT_LOG,
          "close_confirm_start",
          JSON.stringify({ signature: sig }),
        );
        await connection.confirmTransaction(
          { signature: sig, blockhash, lastValidBlockHeight },
          "confirmed",
        );
        console.info(
          LEV_SUBMIT_LOG,
          "close_confirm_complete",
          JSON.stringify({ signature: sig }),
        );

        await new Promise((r) => setTimeout(r, 400));
        const walletAfter = await readWalletOutcomeSnapshot({
          connection,
          owner: publicKey,
          yesMint,
          noMint,
        });
        const { returnedYes, returnedNo } = walletOutcomeReturnDelta(
          walletBefore,
          walletAfter,
        );
        balances.refresh();
        setLastCloseDetail({
          closeSig: sig,
          returnedYesHuman: formatBaseUnitsToDecimalString(
            returnedYes,
            walletAfter.yesDecimals,
            6,
          ),
          returnedNoHuman: formatBaseUnitsToDecimalString(
            returnedNo,
            walletAfter.noDecimals,
            6,
          ),
          walletYesAfterHuman: formatBaseUnitsToDecimalString(
            walletAfter.yesRaw,
            walletAfter.yesDecimals,
            6,
          ),
          walletNoAfterHuman: formatBaseUnitsToDecimalString(
            walletAfter.noRaw,
            walletAfter.noDecimals,
            6,
          ),
          walletUsdcAfterHuman: formatBaseUnitsToDecimalString(
            walletAfter.usdcRaw,
            walletAfter.usdcDecimals,
            2,
          ),
        });
        console.info(
          LEV_SUBMIT_LOG,
          "close_wallet_outcome_delta",
          JSON.stringify({
            returnedYes: returnedYes.toString(),
            returnedNo: returnedNo.toString(),
            walletYesAfter: walletAfter.yesRaw.toString(),
            walletNoAfter: walletAfter.noRaw.toString(),
          }),
        );

        await Promise.resolve(onSettled?.({ signature: sig }));
      } catch (e: unknown) {
        const raw = errorText(e);
        if (isDuplicateSolanaSubmitError(raw)) {
          console.warn(
            LEV_SUBMIT_LOG,
            "close_duplicate_submit_detected",
            JSON.stringify({ message: raw }),
          );
          setActionError(
            "This transaction may have already confirmed. Refreshing your balances…",
          );
          balances.refresh();
          if (process.env.NODE_ENV === "development") {
            console.info(
              "[predicted][volume-verify] leverage_close_duplicate_submit",
              {
                hadSubmittedSig: Boolean(closeSubmittedSig),
                sig: closeSubmittedSig ?? null,
              },
            );
          }
          await Promise.resolve(
            onSettled?.(
              closeSubmittedSig ? { signature: closeSubmittedSig } : undefined,
            ),
          );
          return;
        }
        setActionError(raw || "Close failed");
        console.warn(
          LEV_SUBMIT_LOG,
          "close_error",
          JSON.stringify({ message: raw }),
        );
      } finally {
        leverageSubmitInFlightRef.current = false;
        setActionBusy(false);
      }
    },
    [
      balances.refresh,
      connection,
      onSettled,
      pairAddress,
      publicKey,
      signTransaction,
      connected,
      yesMint,
      noMint,
    ],
  );

  const shellInput =
    "w-full border-0 bg-transparent text-[13px] text-zinc-100 outline-none placeholder:text-zinc-600";

  const decForSide = side === "yes" ? balances.yesDecimals : balances.noDecimals;
  const walletMaxLabel =
    side === "yes"
      ? `Wallet YES (free): ${formatBaseUnitsToDecimalString(walletFreeYes, decForSide, 6)}`
      : `Wallet NO (free): ${formatBaseUnitsToDecimalString(walletFreeNo, decForSide, 6)}`;

  const ctaDisabled =
    !pool?.poolId ||
    actionBusy ||
    !connected ||
    collateralAtoms == null ||
    collateralAtoms <= 0n ||
    riskExceedsWallet ||
    !borrowAtomsPositive ||
    maxPreviewError != null ||
    previewError != null ||
    borrowPowerError != null;

  const leverageSliderDisabled =
    !pool?.poolId ||
    !connected ||
    collateralAtoms == null ||
    collateralAtoms <= 0n ||
    riskExceedsWallet ||
    maxPreviewLoading ||
    maxPreviewError != null;

  const canApplyMaxBorrowMinusEpsilon = useMemo(() => {
    if (maxLeverageMultiple == null || maxLeverageMultiple <= 1) return false;
    if (leverageSliderDisabled) return false;
    const capped = Math.min(ADAPTIVE_LEVERAGE_GLOBAL_CAP, maxLeverageMultiple);
    return capped - 0.01 > 1;
  }, [maxLeverageMultiple, leverageSliderDisabled]);

  const displayTargetMultipleLabel = useMemo(() => {
    if (maxLeverageMultiple != null && maxLeverageMultiple > 1 && sliderPct > 0) {
      return `${(1 + slider01 * (maxLeverageMultiple - 1)).toFixed(2)}×`;
    }
    return `${leverageTier}×`;
  }, [leverageTier, maxLeverageMultiple, slider01, sliderPct]);

  const selectedPrice = useMemo(() => {
    const yes = market.pool?.yesPrice ?? market.yesProbability;
    const no = market.pool?.noPrice ?? 1 - market.yesProbability;
    const p = side === "yes" ? yes : no;
    return Number.isFinite(p) && p > 0 ? p : null;
  }, [market.pool?.noPrice, market.pool?.yesPrice, market.yesProbability, side]);

  const leveragePayoutMetrics = useMemo(() => {
    if (collateralAtoms == null || collateralAtoms <= 0n) return null;
    const dec = side === "yes" ? balances.yesDecimals : balances.noDecimals;
    const previewExposureAtoms =
      side === "yes" ? previewYes?.estimatedYesOutAtoms : previewNo?.estimatedNoOutAtoms;
    if (previewExposureAtoms == null || previewExposureAtoms < 0n) return null;
    const collateralShares = Number(collateralAtoms) / 10 ** dec;
    const routedExposureShares = Number(previewExposureAtoms) / 10 ** dec;
    const finalExposureShares = collateralShares + routedExposureShares;
    if (!Number.isFinite(finalExposureShares) || finalExposureShares <= 0) return null;
    if (selectedPrice == null) return null;
    const userCapitalAtRiskUsd = collateralShares * selectedPrice;
    const avgEntryPrice = userCapitalAtRiskUsd / finalExposureShares;
    const maxPayoutUsd = finalExposureShares;
    const netProfitUsd = maxPayoutUsd - userCapitalAtRiskUsd;
    return {
      userCapitalAtRiskUsd,
      finalExposureShares,
      avgEntryPrice,
      maxPayoutUsd,
      netProfitUsd,
    };
  }, [
    collateralAtoms,
    side,
    balances.noDecimals,
    balances.yesDecimals,
    previewYes?.estimatedYesOutAtoms,
    previewNo?.estimatedNoOutAtoms,
    selectedPrice,
  ]);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    console.info(
      LEV_PAYOUT_LOG,
      JSON.stringify({
        userCapitalAtRiskUsd: leveragePayoutMetrics?.userCapitalAtRiskUsd ?? null,
        finalExposureShares: leveragePayoutMetrics?.finalExposureShares ?? null,
        avgEntryPrice: leveragePayoutMetrics?.avgEntryPrice ?? null,
        maxPayoutUsd: leveragePayoutMetrics?.maxPayoutUsd ?? null,
        netProfitUsd: leveragePayoutMetrics?.netProfitUsd ?? null,
      }),
    );
  }, [leveragePayoutMetrics]);

  if (!pool?.poolId) {
    return null;
  }

  return (
    <div className="pt-0">
      {!hideSectionTitle ? (
        <h4 className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
          Leverage
        </h4>
      ) : null}

      <div
        className={cn(
          "grid grid-cols-2 gap-2",
          hideSectionTitle ? "mt-0" : "mt-3",
        )}
      >
        <button
          type="button"
          onClick={() => setInternalSide("yes")}
          disabled={walletFreeYes <= 0n}
          title={
            walletFreeYes <= 0n ? "No YES in wallet — buy YES in Trade first." : undefined
          }
          className={cn(
            "rounded-xl py-2 text-[12px] font-semibold transition",
            side === "yes"
              ? "bg-[#22c55e]/90 text-black"
              : "bg-white/[0.05] text-zinc-500",
            walletFreeYes <= 0n && "cursor-not-allowed opacity-40",
          )}
        >
          Leverage YES
        </button>
        <button
          type="button"
          onClick={() => setInternalSide("no")}
          disabled={walletFreeNo <= 0n}
          title={
            walletFreeNo <= 0n ? "No NO in wallet — buy NO in Trade first." : undefined
          }
          className={cn(
            "rounded-xl py-2 text-[12px] font-semibold transition",
            side === "no"
              ? "bg-red-600 text-white"
              : "bg-white/[0.05] text-zinc-500",
            walletFreeNo <= 0n && "cursor-not-allowed opacity-40",
          )}
        >
          Leverage NO
        </button>
      </div>

      <label className="mt-3 block">
        <span className="text-[10px] text-zinc-500">
          Add collateral from wallet ({side.toUpperCase()})
        </span>
        <input
          value={internalCollateralHuman}
          onChange={(e) => setInternalCollateralHuman(e.target.value)}
          placeholder="0"
          inputMode="decimal"
          className={cn("search-pill mt-1 block w-full px-4 py-2", shellInput)}
        />
        {connected ? (
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[9px] text-zinc-600">{walletMaxLabel}</p>
            <button
              type="button"
              onClick={() => setCollateralToWalletMax()}
              disabled={walletCapForSide <= 0n}
              className="text-[9px] font-medium text-zinc-500 underline decoration-zinc-600 underline-offset-2 hover:text-zinc-300 disabled:opacity-40"
            >
              Use max (wallet)
            </button>
          </div>
        ) : null}
      </label>

      <div className="mt-3">
        <div className="flex items-center justify-between gap-2 text-[10px] text-zinc-500">
          <span>Target leverage</span>
          <span className="shrink-0 text-[18px] font-semibold tabular-nums text-zinc-100">
            {displayTargetMultipleLabel}
          </span>
        </div>
        <div className="mt-2">
          <LeveragePremiumSlider
            value={leverageTier}
            onChange={(t) => {
              setSliderLockMaxMinus(false);
              setLeverageTier(t);
            }}
            tier2Enabled={tier2Enabled}
            tier3Enabled={tier3Enabled}
            disabled={leverageSliderDisabled}
            loading={maxPreviewLoading}
          />
        </div>
        <p className="mt-1 text-[9px] leading-relaxed text-zinc-600">
          2× and 3× use the pool’s simulated borrow cap for this wallet deposit (may be lower than
          3× if liquidity is tight).
        </p>
        {maxLeverageMultiple != null ? (
          <div className="mt-0.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[9px] text-zinc-500">
            <p className="min-w-0 flex-1">
              Max multiple (simulation) for this deposit:{" "}
              <span className="tabular-nums text-zinc-400">
                {Math.min(ADAPTIVE_LEVERAGE_GLOBAL_CAP, maxLeverageMultiple).toFixed(2)}×
              </span>
            </p>
            <button
              type="button"
              onClick={applyMaxBorrowMinusEpsilon}
              disabled={!canApplyMaxBorrowMinusEpsilon}
              title="Set borrow to slightly below the simulated max (max − 0.01×) to avoid edge cases at the cap."
              className={cn(
                "shrink-0 rounded-lg border border-white/[0.12] px-2 py-0.5 text-[9px] font-semibold text-zinc-300 transition",
                "hover:border-white/[0.2] hover:bg-white/[0.06] hover:text-zinc-100",
                "disabled:cursor-not-allowed disabled:opacity-40",
              )}
            >
              Max − 0.01
            </button>
          </div>
        ) : connected &&
          collateralAtoms != null &&
          collateralAtoms > 0n &&
          !riskExceedsWallet ? (
          <p className="mt-0.5 text-[9px] text-zinc-600">
            {maxPreviewLoading ? "Computing borrow cap…" : null}
            {maxPreviewError ? (
              <span className="text-amber-200/90">{maxPreviewError}</span>
            ) : null}
          </p>
        ) : null}
      </div>

      <div className="mt-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
        <div className="space-y-1 text-[10px] text-zinc-500">
          <div className="flex justify-between gap-3">
            <span>Avg entry price</span>
            <span className="tabular-nums text-zinc-300">
              {leveragePayoutMetrics ? fmtUsd(leveragePayoutMetrics.avgEntryPrice) : "—"}
            </span>
          </div>
          <div className="flex justify-between gap-3">
            <span>Shares / Exposure</span>
            <span className="tabular-nums text-zinc-300">
              {leveragePayoutMetrics
                ? leveragePayoutMetrics.finalExposureShares.toFixed(4)
                : "—"}
            </span>
          </div>
          <div className="flex justify-between gap-3">
            <span>Max payout if correct</span>
            <span className="tabular-nums text-emerald-300">
              {leveragePayoutMetrics ? fmtUsd(leveragePayoutMetrics.maxPayoutUsd) : "Payout estimate unavailable"}
            </span>
          </div>
          <div className="flex justify-between gap-3">
            <span>Net profit if correct</span>
            <span className="tabular-nums text-emerald-300">
              {leveragePayoutMetrics
                ? `${leveragePayoutMetrics.netProfitUsd >= 0 ? "+" : ""}${fmtUsd(leveragePayoutMetrics.netProfitUsd)}`
                : "Payout estimate unavailable"}
            </span>
          </div>
        </div>
      </div>

      {riskExceedsWallet ? (
        <p className="mt-2 text-[10px] text-amber-200/90">
          Collateral exceeds wallet balance
        </p>
      ) : previewError && !previewLoading ? (
        <p className="mt-2 text-[10px] text-amber-200/90">{previewError}</p>
      ) : null}

      <button
        type="button"
        disabled={ctaDisabled}
        onClick={() => void onOpenLeverage()}
        className={cn(
          "mt-3 w-full rounded-xl border border-white/10 bg-white/[0.08] py-2.5 text-[12px] font-semibold text-white transition",
          "hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-40",
        )}
      >
        {actionBusy ? "Working…" : primaryCtaLabel}
      </button>

      <p className="mt-2 text-[9px] leading-snug text-zinc-600">
        Close position repays debt and unlocks collateral. Unwound assets are returned to your
        wallet as <span className="text-zinc-500">YES / NO</span> outcome tokens — not USDC. Use{" "}
        <span className="text-zinc-500">Sell</span> in the trading panel if you want USDC.
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={actionBusy || !connected}
          onClick={() => void onCloseLeverage("yes")}
          title="Repay debt and unlock collateral on the YES track. Returns outcome tokens to your wallet."
          className="rounded-xl border border-white/[0.08] py-2 text-[10px] font-medium text-zinc-400 transition hover:border-white/[0.14] hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Close YES position
        </button>
        <button
          type="button"
          disabled={actionBusy || !connected}
          onClick={() => void onCloseLeverage("no")}
          title="Repay debt and unlock collateral on the NO track. Returns outcome tokens to your wallet."
          className="rounded-xl border border-white/[0.08] py-2 text-[10px] font-medium text-zinc-400 transition hover:border-white/[0.14] hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Close NO position
        </button>
      </div>

      {actionError ? (
        <p className="mt-2 text-[10px] text-amber-200/90">{actionError}</p>
      ) : null}

      {lastCloseDetail ? (
        <div className="mt-2 space-y-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2 text-[10px] text-zinc-400">
          <p className="text-[9px] font-medium text-zinc-500">Position closed</p>
          <p className="text-zinc-300">
            <span className="text-zinc-500">Returned YES</span>{" "}
            <span className="font-semibold tabular-nums text-zinc-100">
              {lastCloseDetail.returnedYesHuman}
            </span>
          </p>
          <p className="text-zinc-300">
            <span className="text-zinc-500">Returned NO</span>{" "}
            <span className="font-semibold tabular-nums text-zinc-100">
              {lastCloseDetail.returnedNoHuman}
            </span>
          </p>
          <p className="text-zinc-600">
            Wallet now — YES:{" "}
            <span className="tabular-nums text-zinc-400">
              {lastCloseDetail.walletYesAfterHuman}
            </span>
            {" · "}
            NO:{" "}
            <span className="tabular-nums text-zinc-400">
              {lastCloseDetail.walletNoAfterHuman}
            </span>
            {" · "}
            USDC:{" "}
            <span className="tabular-nums text-zinc-400">
              {lastCloseDetail.walletUsdcAfterHuman}
            </span>
          </p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5">
            <span className="text-zinc-500">Transaction</span>
            <TxExplorerLink signature={lastCloseDetail.closeSig} />
          </div>
        </div>
      ) : lastSig ? (
        <div className="mt-2 text-[10px]">
          <TxExplorerLink signature={lastSig} />
        </div>
      ) : null}
    </div>
  );
}

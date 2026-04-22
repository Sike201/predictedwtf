"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { ExternalLink } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { TxExplorerLink } from "@/components/market/tx-explorer-link";
import type { OmnipairUserPositionSnapshot } from "@/lib/hooks/use-omnipair-user-position";
import { useWallet } from "@/lib/hooks/use-wallet";
import { useMarketTradingBalances } from "@/lib/hooks/use-market-trading-balances";
import { readLeverageTargetAtOpen } from "@/lib/market/leverage-target-storage";
import {
  computeOmnipairPositionMetricsUsd,
  formatHealthMult,
  formatLeverageMult,
  formatUsd,
  logPositionMetricsDev,
  riskBadgeFromHealthFactor,
  riskBadgeLabel,
} from "@/lib/market/omnipair-position-metrics";
import type { Market } from "@/lib/types/market";
import {
  readWalletOutcomeSnapshot,
  walletOutcomeReturnDelta,
} from "@/lib/market/close-position-wallet-delta";
import { getResolvedBinaryDisplayPrices } from "@/lib/market/resolved-binary-prices";
import {
  estimateAtResolutionPayoutMark,
  logLeverageSettlementResult,
  logLeverageSettlementStart,
  shouldUseLeverageSettlement,
} from "@/lib/market/resolved-leverage-settlement";
import { buildDebtBridgeShortfallDetails } from "@/lib/market/leverage-debt-bridge";
import { isDuplicateSolanaSubmitError } from "@/lib/market/solana-submit-errors";
import {
  buildCloseLeveragedNoPositionTransaction,
  buildCloseLeveragedYesPositionTransaction,
} from "@/lib/solana/omnipair-close-leverage";
import {
  formatBaseUnitsToDecimalString,
} from "@/lib/solana/wallet-token-balances";
import { devnetAccountExplorerUrl } from "@/lib/utils/solana-explorer";
import { cn } from "@/lib/utils/cn";

const SLIPPAGE_BPS = 150;
const CLOSE_LOG = "[predicted][your-position-close]";
const BRIDGE_CALC_LOG = "[predicted][leverage-debt-bridge-calc]";
const BRIDGE_TX_LOG = "[predicted][leverage-debt-bridge-tx]";

const actionBtnClass =
  "rounded-md border border-white/[0.12] px-2 py-1 text-[10px] font-medium text-zinc-200 transition hover:border-white/[0.2] hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-40";

type Props = {
  market: Market;
  snapshot: OmnipairUserPositionSnapshot | null;
  loading: boolean;
  error: string | null;
  onPositionTxSettled?: (detail?: { signature?: string }) => void;
};

function hasActiveLendingPosition(s: OmnipairUserPositionSnapshot | null): boolean {
  if (!s?.userPositionPda) return false;
  return (
    BigInt(s.collateralYesAtoms) > 0n ||
    BigInt(s.collateralNoAtoms) > 0n ||
    BigInt(s.debtYesAtoms) > 0n ||
    BigInt(s.debtNoAtoms) > 0n
  );
}

export function YourPositionPanel({
  market,
  snapshot,
  loading,
  error,
  onPositionTxSettled,
}: Props) {
  const { connection } = useConnection();
  const { publicKey, connected, signTransaction } = useWallet();
  const balances = useMarketTradingBalances(market, publicKey);

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastCloseDetail, setLastCloseDetail] = useState<{
    closeSig: string;
    returnedYesHuman: string;
    returnedNoHuman: string;
    walletYesAfterHuman: string;
    walletNoAfterHuman: string;
    walletUsdcAfterHuman: string;
  } | null>(null);
  const [lastSettledOnResolution, setLastSettledOnResolution] = useState(false);
  const closeInFlightRef = useRef(false);
  const bridgeInFlightRef = useRef(false);
  const bridgeTouched = useRef({ yes: false, no: false });
  const [bridgeUsdcByDir, setBridgeUsdcByDir] = useState<{
    yes: string;
    no: string;
  }>({ yes: "", no: "" });
  const [bridgeBusy, setBridgeBusy] = useState(false);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const settleYesBtnRef = useRef<HTMLButtonElement>(null);
  const settleNoBtnRef = useRef<HTMLButtonElement>(null);
  const settleSingleBtnRef = useRef<HTMLButtonElement>(null);

  const pool = market.pool;
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

  const hasYesTrack =
    snapshot &&
    (BigInt(snapshot.collateralYesAtoms) > 0n ||
      BigInt(snapshot.debtNoAtoms) > 0n);
  const hasNoTrack =
    snapshot &&
    (BigInt(snapshot.collateralNoAtoms) > 0n ||
      BigInt(snapshot.debtYesAtoms) > 0n);

  const useSettlementCta = shouldUseLeverageSettlement(market, snapshot);

  const yesTrackBridge = useMemo(() => {
    if (!useSettlementCta || !snapshot || !hasYesTrack) return null;
    const d = buildDebtBridgeShortfallDetails("yes", {
      debtYesAtoms: BigInt(snapshot.debtYesAtoms),
      debtNoAtoms: BigInt(snapshot.debtNoAtoms),
      yesWalletAtoms: balances.yesRaw,
      noWalletAtoms: balances.noRaw,
    });
    const dec =
      d.debtToken === "yes" ? balances.yesDecimals : balances.noDecimals;
    return {
      ...d,
      shortfall: d.tokenShortfallOutcomeAtoms,
      minUsdcBaseUnits: d.minUsdcBaseUnits,
      minUsdcHuman: formatBaseUnitsToDecimalString(
        d.minUsdcBaseUnits,
        6,
        6,
      ),
      shortfallHuman: formatBaseUnitsToDecimalString(
        d.tokenShortfallOutcomeAtoms,
        dec,
        6,
      ),
      debtOwedHuman: formatBaseUnitsToDecimalString(
        d.debtTokenOwedAtoms,
        dec,
        6,
      ),
      walletDebtTokenHuman: formatBaseUnitsToDecimalString(
        d.debtTokenWalletAtoms,
        dec,
        6,
      ),
    };
  }, [
    useSettlementCta,
    snapshot,
    hasYesTrack,
    balances.yesRaw,
    balances.noRaw,
    balances.yesDecimals,
    balances.noDecimals,
  ]);

  const noTrackBridge = useMemo(() => {
    if (!useSettlementCta || !snapshot || !hasNoTrack) return null;
    const d = buildDebtBridgeShortfallDetails("no", {
      debtYesAtoms: BigInt(snapshot.debtYesAtoms),
      debtNoAtoms: BigInt(snapshot.debtNoAtoms),
      yesWalletAtoms: balances.yesRaw,
      noWalletAtoms: balances.noRaw,
    });
    const dec =
      d.debtToken === "yes" ? balances.yesDecimals : balances.noDecimals;
    return {
      ...d,
      shortfall: d.tokenShortfallOutcomeAtoms,
      minUsdcBaseUnits: d.minUsdcBaseUnits,
      minUsdcHuman: formatBaseUnitsToDecimalString(
        d.minUsdcBaseUnits,
        6,
        6,
      ),
      shortfallHuman: formatBaseUnitsToDecimalString(
        d.tokenShortfallOutcomeAtoms,
        dec,
        6,
      ),
      debtOwedHuman: formatBaseUnitsToDecimalString(
        d.debtTokenOwedAtoms,
        dec,
        6,
      ),
      walletDebtTokenHuman: formatBaseUnitsToDecimalString(
        d.debtTokenWalletAtoms,
        dec,
        6,
      ),
    };
  }, [
    useSettlementCta,
    snapshot,
    hasNoTrack,
    balances.yesRaw,
    balances.noRaw,
    balances.yesDecimals,
    balances.noDecimals,
  ]);

  useEffect(() => {
    if (!yesTrackBridge || yesTrackBridge.shortfall === 0n) {
      bridgeTouched.current.yes = false;
      setBridgeUsdcByDir((p) => ({ ...p, yes: "" }));
      return;
    }
    if (!bridgeTouched.current.yes) {
      setBridgeUsdcByDir((p) => ({ ...p, yes: yesTrackBridge.minUsdcHuman }));
    }
  }, [yesTrackBridge]);

  useEffect(() => {
    if (!noTrackBridge || noTrackBridge.shortfall === 0n) {
      bridgeTouched.current.no = false;
      setBridgeUsdcByDir((p) => ({ ...p, no: "" }));
      return;
    }
    if (!bridgeTouched.current.no) {
      setBridgeUsdcByDir((p) => ({ ...p, no: noTrackBridge.minUsdcHuman }));
    }
  }, [noTrackBridge]);

  useEffect(() => {
    if (!yesTrackBridge || yesTrackBridge.shortfall === 0n) return;
    console.info(
      BRIDGE_CALC_LOG,
      JSON.stringify({
        slug: market.id,
        track: "yes" as const,
        closeDirection: yesTrackBridge.closeDirection,
        debtToken: yesTrackBridge.debtToken,
        debtTokenOwedAtoms: yesTrackBridge.debtTokenOwedAtoms.toString(),
        debtTokenWalletAtoms: yesTrackBridge.debtTokenWalletAtoms.toString(),
        tokenShortfallOutcomeAtoms:
          yesTrackBridge.tokenShortfallOutcomeAtoms.toString(),
        ceilingDivisor: yesTrackBridge.ceilingDivisor.toString(),
        minUsdcBaseUnits: yesTrackBridge.minUsdcBaseUnits.toString(),
        minUsdcHuman: yesTrackBridge.minUsdcHuman,
        source: "client",
      }),
    );
  }, [yesTrackBridge, market.id]);

  useEffect(() => {
    if (!noTrackBridge || noTrackBridge.shortfall === 0n) return;
    console.info(
      BRIDGE_CALC_LOG,
      JSON.stringify({
        slug: market.id,
        track: "no" as const,
        closeDirection: noTrackBridge.closeDirection,
        debtToken: noTrackBridge.debtToken,
        debtTokenOwedAtoms: noTrackBridge.debtTokenOwedAtoms.toString(),
        debtTokenWalletAtoms: noTrackBridge.debtTokenWalletAtoms.toString(),
        tokenShortfallOutcomeAtoms:
          noTrackBridge.tokenShortfallOutcomeAtoms.toString(),
        ceilingDivisor: noTrackBridge.ceilingDivisor.toString(),
        minUsdcBaseUnits: noTrackBridge.minUsdcBaseUnits.toString(),
        minUsdcHuman: noTrackBridge.minUsdcHuman,
        source: "client",
      }),
    );
  }, [noTrackBridge, market.id]);

  const resolvedPayout = getResolvedBinaryDisplayPrices(market);
  const resolutionSettlement = useMemo(() => {
    if (!useSettlementCta || !snapshot) return null;
    return estimateAtResolutionPayoutMark({
      market,
      snapshot,
      yesDecimals: balances.yesDecimals,
      noDecimals: balances.noDecimals,
    });
  }, [
    market,
    snapshot,
    useSettlementCta,
    balances.yesDecimals,
    balances.noDecimals,
  ]);

  const [openedAtLeverageApprox, setOpenedAtLeverageApprox] = useState<number | null>(
    null,
  );
  useEffect(() => {
    setOpenedAtLeverageApprox(readLeverageTargetAtOpen(market.id));
  }, [
    market.id,
    snapshot?.collateralYesAtoms,
    snapshot?.collateralNoAtoms,
    snapshot?.debtYesAtoms,
    snapshot?.debtNoAtoms,
  ]);

  const positionMetrics = useMemo(() => {
    if (!snapshot || !hasActiveLendingPosition(snapshot)) return null;
    return computeOmnipairPositionMetricsUsd({
      market,
      collateralYesAtoms: BigInt(snapshot.collateralYesAtoms),
      collateralNoAtoms: BigInt(snapshot.collateralNoAtoms),
      debtYesAtoms: BigInt(snapshot.debtYesAtoms),
      debtNoAtoms: BigInt(snapshot.debtNoAtoms),
      yesDecimals: balances.yesDecimals,
      noDecimals: balances.noDecimals,
      healthFactorApprox: snapshot.healthFactorApprox,
      spot: {
        spotYesProbability: snapshot.spotYesProbability,
        spotNoProbability: snapshot.spotNoProbability,
      },
    });
  }, [
    balances.noDecimals,
    balances.yesDecimals,
    market,
    snapshot,
  ]);

  useEffect(() => {
    if (!positionMetrics || !snapshot || !pool?.yesMint || !pool?.noMint) return;
    const yd = balances.yesDecimals;
    const nd = balances.noDecimals;
    logPositionMetricsDev({
      ...positionMetrics,
      yesMint: pool.yesMint,
      noMint: pool.noMint,
      collateralYesHuman: Number(BigInt(snapshot.collateralYesAtoms)) / 10 ** yd,
      collateralNoHuman: Number(BigInt(snapshot.collateralNoAtoms)) / 10 ** nd,
      debtYesHuman: Number(BigInt(snapshot.debtYesAtoms)) / 10 ** yd,
      debtNoHuman: Number(BigInt(snapshot.debtNoAtoms)) / 10 ** nd,
    });
  }, [balances.noDecimals, balances.yesDecimals, pool?.noMint, pool?.yesMint, positionMetrics, snapshot]);

  const riskBadge = useMemo(
    () =>
      riskBadgeFromHealthFactor(
        snapshot?.healthFactorApprox ?? positionMetrics?.healthFactor,
      ),
    [positionMetrics?.healthFactor, snapshot?.healthFactorApprox],
  );
  void riskBadge;

  const runClose = useCallback(
    async (which: "yes" | "no") => {
      if (closeInFlightRef.current) {
        if (process.env.NODE_ENV === "development") {
          console.info(CLOSE_LOG, "ignored_concurrent_close");
        }
        return;
      }
      closeInFlightRef.current = true;
      setActionError(null);
      setLastCloseDetail(null);
      setLastSettledOnResolution(false);
      if (!connected || !publicKey || !signTransaction || !pairAddress || !yesMint || !noMint) {
        setActionError("Connect a wallet.");
        closeInFlightRef.current = false;
        return;
      }
      setBusy(true);
      try {
        if (process.env.NODE_ENV === "development") {
          console.info(CLOSE_LOG, "close_click", JSON.stringify({ which }));
        }
        const forSettlement = shouldUseLeverageSettlement(market, snapshot);
        let settlementEst: ReturnType<typeof estimateAtResolutionPayoutMark> | null =
          null;
        if (
          forSettlement &&
          snapshot &&
          snapshot.userPositionPda &&
          publicKey &&
          (market.resolution.resolvedOutcome === "yes" ||
            market.resolution.resolvedOutcome === "no")
        ) {
          settlementEst = estimateAtResolutionPayoutMark({
            market,
            snapshot,
            yesDecimals: balances.yesDecimals,
            noDecimals: balances.noDecimals,
          });
          logLeverageSettlementStart({
            slug: market.id,
            winningOutcome: market.resolution.resolvedOutcome,
            userPositionId: snapshot.userPositionPda,
            wallet: publicKey.toBase58(),
          });
        }
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

        if (process.env.NODE_ENV === "development") {
          console.info(
            CLOSE_LOG,
            "tx_built",
            JSON.stringify({ which, buildLog: built.log }),
          );
        }

        const walletBefore = await readWalletOutcomeSnapshot({
          connection,
          owner: publicKey,
          yesMint,
          noMint,
        });

        const { blockhash, lastValidBlockHeight } =
          await connection.getLatestBlockhash("confirmed");
        built.transaction.feePayer = publicKey;
        built.transaction.recentBlockhash = blockhash;

        if (process.env.NODE_ENV === "development") {
          console.info(CLOSE_LOG, "wallet_sign_start");
        }
        const signed = await signTransaction(built.transaction);
        if (process.env.NODE_ENV === "development") {
          console.info(CLOSE_LOG, "tx_signed");
        }

        const raw = signed.serialize();
        if (process.env.NODE_ENV === "development") {
          console.info(CLOSE_LOG, "tx_send", JSON.stringify({ bytes: raw.length }));
        }
        const sig = await connection.sendRawTransaction(raw, {
          skipPreflight: false,
          maxRetries: 0,
        });
        if (process.env.NODE_ENV === "development") {
          console.info(CLOSE_LOG, "tx_sent", JSON.stringify({ signature: sig }));
        }
        await connection.confirmTransaction(
          { signature: sig, blockhash, lastValidBlockHeight },
          "confirmed",
        );
        if (process.env.NODE_ENV === "development") {
          console.info(CLOSE_LOG, "tx_confirmed", JSON.stringify({ signature: sig }));
        }
        if (
          forSettlement &&
          settlementEst &&
          snapshot &&
          snapshot.userPositionPda &&
          publicKey &&
          (market.resolution.resolvedOutcome === "yes" ||
            market.resolution.resolvedOutcome === "no")
        ) {
          logLeverageSettlementResult({
            slug: market.id,
            winningOutcome: market.resolution.resolvedOutcome,
            userPositionId: snapshot.userPositionPda,
            wallet: publicKey.toBase58(),
            finalUserValue: settlementEst.equityUsd,
            debtNet: settlementEst.debtValueUsd,
            collateralNet: settlementEst.collateralValueUsd,
          });
          setLastSettledOnResolution(true);
        }

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
        if (process.env.NODE_ENV === "development") {
          console.info(
            CLOSE_LOG,
            "wallet_after_close",
            JSON.stringify({
              returnedYes: returnedYes.toString(),
              returnedNo: returnedNo.toString(),
              walletYesAfter: walletAfter.yesRaw.toString(),
              walletNoAfter: walletAfter.noRaw.toString(),
            }),
          );
        }

        onPositionTxSettled?.({ signature: sig });
      } catch (e: unknown) {
        const raw = e instanceof Error ? e.message : "Close failed";
        if (isDuplicateSolanaSubmitError(raw)) {
          setActionError(
            "This transaction may have already confirmed. Refreshing your balances and position…",
          );
          balances.refresh();
          onPositionTxSettled?.();
        } else {
          setActionError(raw);
        }
        if (process.env.NODE_ENV === "development") {
          console.warn(CLOSE_LOG, "error", JSON.stringify({ message: raw }));
        }
      } finally {
        closeInFlightRef.current = false;
        setBusy(false);
      }
    },
    [
      balances.refresh,
      connection,
      onPositionTxSettled,
      pairAddress,
      publicKey,
      signTransaction,
      connected,
      yesMint,
      noMint,
      market,
      snapshot,
      balances.yesDecimals,
      balances.noDecimals,
    ],
  );

  const runDebtBridge = useCallback(
    async (closeDirection: "yes" | "no") => {
      if (bridgeInFlightRef.current) {
        console.info(
          BRIDGE_TX_LOG,
          JSON.stringify({
            slug: market.id,
            closeDirection,
            action: "ignored_concurrent",
          }),
        );
        return;
      }
      if (!connected || !publicKey || !signTransaction) {
        setBridgeError("Connect a wallet.");
        return;
      }
      const usdc = (
        closeDirection === "yes" ? bridgeUsdcByDir.yes : bridgeUsdcByDir.no
      ).trim();
      const info = closeDirection === "yes" ? yesTrackBridge : noTrackBridge;
      if (!info || info.shortfall === 0n) return;
      bridgeInFlightRef.current = true;
      setBridgeError(null);
      setBridgeBusy(true);
      try {
        console.info(
          BRIDGE_TX_LOG,
          JSON.stringify({
            slug: market.id,
            closeDirection,
            action: "build_fetch_start",
            shortfallOutcomeAtoms: info.shortfall.toString(),
            usdcAmountHuman: usdc,
          }),
        );
        const r = await fetch("/api/market/mint-positions-debt-bridge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slug: market.id,
            userWallet: publicKey.toBase58(),
            closeDirection,
            usdcAmountHuman: usdc,
          }),
        });
        const j = (await r.json()) as { error?: string; transaction?: string };
        if (!r.ok) {
          throw new Error(
            j.error ?? "Could not build repay-bridge transaction",
          );
        }
        if (!j.transaction) {
          throw new Error("Missing transaction in response");
        }
        const tx = Transaction.from(Buffer.from(j.transaction, "base64"));
        const { blockhash, lastValidBlockHeight } =
          await connection.getLatestBlockhash("confirmed");
        tx.feePayer = publicKey;
        tx.recentBlockhash = blockhash;
        const signed = await signTransaction(tx);
        const raw = signed.serialize();
        console.info(
          BRIDGE_TX_LOG,
          JSON.stringify({
            slug: market.id,
            closeDirection,
            action: "send_raw_tx",
            serializedBytes: raw.length,
          }),
        );
        const sig = await connection.sendRawTransaction(raw, {
          skipPreflight: false,
          maxRetries: 0,
        });
        console.info(
          BRIDGE_TX_LOG,
          JSON.stringify({
            slug: market.id,
            closeDirection,
            action: "sent",
            signature: sig,
          }),
        );
        await connection.confirmTransaction(
          { signature: sig, blockhash, lastValidBlockHeight },
          "confirmed",
        );
        console.info(
          BRIDGE_TX_LOG,
          JSON.stringify({
            slug: market.id,
            closeDirection,
            action: "confirmed",
            signature: sig,
          }),
        );
        if (closeDirection === "yes") {
          bridgeTouched.current.yes = false;
        } else {
          bridgeTouched.current.no = false;
        }
        balances.refresh();
        onPositionTxSettled?.({ signature: sig });
        requestAnimationFrame(() => {
          if (hasYesTrack && hasNoTrack) {
            if (closeDirection === "yes") {
              settleYesBtnRef.current?.focus();
            } else {
              settleNoBtnRef.current?.focus();
            }
          } else {
            settleSingleBtnRef.current?.focus();
          }
        });
      } catch (e) {
        const m = e instanceof Error ? e.message : "Bridge mint failed";
        if (isDuplicateSolanaSubmitError(m)) {
          setBridgeError(
            "This transaction may have already confirmed. Refreshing your balances and position…",
          );
          if (closeDirection === "yes") {
            bridgeTouched.current.yes = false;
          } else {
            bridgeTouched.current.no = false;
          }
          balances.refresh();
          onPositionTxSettled?.();
          console.info(
            BRIDGE_TX_LOG,
            JSON.stringify({
              slug: market.id,
              closeDirection,
              action: "duplicate_or_already_processed",
              message: m,
            }),
          );
        } else {
          setBridgeError(m);
          console.warn(
            BRIDGE_TX_LOG,
            JSON.stringify({
              slug: market.id,
              closeDirection,
              action: "error",
              message: m,
            }),
          );
        }
      } finally {
        bridgeInFlightRef.current = false;
        setBridgeBusy(false);
      }
    },
    [
      connected,
      publicKey,
      signTransaction,
      connection,
      market.id,
      bridgeUsdcByDir,
      yesTrackBridge,
      noTrackBridge,
      balances,
      onPositionTxSettled,
      hasYesTrack,
      hasNoTrack,
    ],
  );

  const onClosePosition = useCallback(() => {
    if (hasYesTrack && !hasNoTrack) void runClose("yes");
    else if (hasNoTrack && !hasYesTrack) void runClose("no");
    else if (hasYesTrack && hasNoTrack) {
      setActionError("Close one side from the portfolio (both tracks active).");
    }
  }, [hasNoTrack, hasYesTrack, runClose]);

  const yesSettleBlockedByDebt =
    Boolean(
      useSettlementCta && yesTrackBridge && yesTrackBridge.shortfall > 0n,
    );
  const noSettleBlockedByDebt =
    Boolean(
      useSettlementCta && noTrackBridge && noTrackBridge.shortfall > 0n,
    );
  const singleSettleBlockedByDebt =
    hasYesTrack && !hasNoTrack
      ? yesSettleBlockedByDebt
      : hasNoTrack && !hasYesTrack
        ? noSettleBlockedByDebt
        : false;

  if (!pool?.poolId) return null;

  const positionActions =
    snapshot?.userPositionPda ? (
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
        {hasYesTrack && hasNoTrack ? (
          <>
            <button
              ref={settleYesBtnRef}
              type="button"
              disabled={
                busy || !connected || yesSettleBlockedByDebt
              }
              onClick={() => void runClose("yes")}
              title={
                yesSettleBlockedByDebt
                  ? "Mint YES+NO from USDC first to cover the NO debt, then settle."
                  : useSettlementCta
                    ? "Repay and unlock this leg at resolved prices."
                    : "Repay debt and unlock YES collateral into your wallet."
              }
              className={actionBtnClass}
            >
              {busy ? "…" : useSettlementCta ? "Settle YES" : "Close YES"}
            </button>
            <button
              ref={settleNoBtnRef}
              type="button"
              disabled={busy || !connected || noSettleBlockedByDebt}
              onClick={() => void runClose("no")}
              title={
                noSettleBlockedByDebt
                  ? "Mint YES+NO from USDC first to cover the YES debt, then settle."
                  : useSettlementCta
                    ? "Repay and unlock this leg at resolved prices."
                    : "Repay debt and unlock NO collateral into your wallet."
              }
              className={actionBtnClass}
            >
              {busy ? "…" : useSettlementCta ? "Settle NO" : "Close NO"}
            </button>
          </>
        ) : (
          <button
            ref={settleSingleBtnRef}
            type="button"
            disabled={
              busy || !connected || (!hasYesTrack && !hasNoTrack) || singleSettleBlockedByDebt
            }
            onClick={() => void onClosePosition()}
            title={
              singleSettleBlockedByDebt
                ? "Mint YES+NO from USDC to cover the debt gap, then settle."
                : useSettlementCta
                  ? "Settle at resolved prices. You receive outcome tokens, not USDC."
                  : "Repay debt and unlock collateral as outcome tokens."
            }
            className={actionBtnClass}
          >
            {busy ? "…" : useSettlementCta ? "Settle position" : "Close position"}
          </button>
        )}
        <button
          type="button"
          disabled
          title="Coming soon"
          className="rounded-md px-2 py-1 text-[10px] font-medium text-zinc-600"
        >
          Reduce
        </button>
        <a
          href={devnetAccountExplorerUrl(snapshot.userPositionPda)}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded p-1 text-white transition hover:bg-white/[0.06] hover:text-zinc-200"
          aria-label="View position account on explorer"
        >
          <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
        </a>
      </div>
    ) : null;

  return (
    <div className="text-[12px]">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-zinc-500">
          Your position
        </h3>
        {!connected || !publicKey || loading || error || !snapshot?.userPositionPda
          ? null
          : positionActions}
      </div>

      {!connected || !publicKey ? (
        <p className="mt-3 text-[11px] text-zinc-600">Connect a wallet to view.</p>
      ) : loading ? (
        <p className="mt-3 text-[11px] text-zinc-600">Loading…</p>
      ) : error ? (
        <p className="mt-3 text-[11px] text-amber-200/90">{error}</p>
      ) : snapshot?.userPositionPda ? (
        <>
          {useSettlementCta && resolvedPayout && resolutionSettlement ? (
            <div className="mt-3 space-y-2 rounded-md border border-emerald-500/25 bg-emerald-500/[0.05] p-2.5 text-[10px] text-zinc-200">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-emerald-400/90">
                Resolved
              </p>
              <p>
                <span className="text-zinc-500">Winner </span>
                <span className="font-semibold text-zinc-100">
                  {resolvedPayout.winningOutcome === "yes" ? "YES" : "NO"}
                </span>
              </p>
              <p className="text-zinc-400">
                Est. equity at resolution{" "}
                <span className="tabular-nums font-medium text-zinc-100">
                  {formatUsd(resolutionSettlement.equityUsd)}
                </span>
              </p>
              <p className="text-zinc-500">
                Collateral {formatUsd(resolutionSettlement.collateralValueUsd)} ·
                Debt {formatUsd(resolutionSettlement.debtValueUsd)}
              </p>
            </div>
          ) : null}
          {useSettlementCta &&
          snapshot &&
          hasActiveLendingPosition(snapshot) &&
          ((yesTrackBridge && yesTrackBridge.shortfall > 0n) ||
            (noTrackBridge && noTrackBridge.shortfall > 0n)) && (
            <div className="mt-3 space-y-3 rounded-md border border-amber-500/30 bg-amber-500/[0.06] p-2.5 text-[10px] text-zinc-200">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-amber-400/90">
                Top up to settle
              </p>
              <p className="leading-relaxed text-zinc-300">
                You need a bit more of the debt token in your wallet. Mint a
                paired YES+NO set from USDC, use the right leg to cover the gap,
                then settle. The USDC line is the minimum to mint that cover,
                not a separate debt to the pool.
              </p>
              <p className="text-zinc-400">
                This is the USDC to route through the mint so you can finish
                repayment.
              </p>
              {yesTrackBridge && yesTrackBridge.shortfall > 0n && hasYesTrack ? (
                <div className="space-y-1.5 rounded border border-white/[0.08] bg-black/20 p-2">
                  <p className="text-[9px] font-medium text-zinc-400">
                    Settle YES · repay{" "}
                    <span className="text-zinc-200">
                      {yesTrackBridge.debtToken === "yes" ? "YES" : "NO"}
                    </span>
                  </p>
                  <dl className="space-y-1 text-[9px] text-zinc-400">
                    <div className="flex justify-between gap-2">
                      <dt>Owed</dt>
                      <dd className="tabular-nums text-zinc-200">
                        {yesTrackBridge.debtOwedHuman}{" "}
                        {yesTrackBridge.debtToken === "yes" ? "YES" : "NO"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>In wallet</dt>
                      <dd className="tabular-nums text-zinc-200">
                        {yesTrackBridge.walletDebtTokenHuman}{" "}
                        {yesTrackBridge.debtToken === "yes" ? "YES" : "NO"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>Short</dt>
                      <dd className="tabular-nums text-zinc-200">
                        {yesTrackBridge.shortfallHuman}{" "}
                        {yesTrackBridge.debtToken === "yes" ? "YES" : "NO"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>Min USDC to mint</dt>
                      <dd className="tabular-nums text-amber-100/90">
                        {yesTrackBridge.minUsdcHuman} USDC
                      </dd>
                    </div>
                  </dl>
                  <div className="flex flex-col gap-1.5 sm:flex-row sm:items-end">
                    <label className="flex min-w-0 flex-1 flex-col gap-0.5 text-[9px] text-zinc-500">
                      <span>USDC {yesTrackBridge.minUsdcHuman} min</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={bridgeUsdcByDir.yes}
                        onChange={(e) => {
                          bridgeTouched.current.yes = true;
                          setBridgeUsdcByDir((p) => ({
                            ...p,
                            yes: e.target.value,
                          }));
                        }}
                        className="rounded border border-white/[0.1] bg-black/30 px-2 py-1 text-[10px] text-zinc-100"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={bridgeBusy || !connected}
                      onClick={() => void runDebtBridge("yes")}
                      className={cn(actionBtnClass, "whitespace-nowrap border-amber-500/30")}
                    >
                      {bridgeBusy ? "…" : "Mint from USDC for repay"}
                    </button>
                  </div>
                </div>
              ) : null}
              {noTrackBridge && noTrackBridge.shortfall > 0n && hasNoTrack ? (
                <div className="space-y-1.5 rounded border border-white/[0.08] bg-black/20 p-2">
                  <p className="text-[9px] font-medium text-zinc-400">
                    Settle NO · repay{" "}
                    <span className="text-zinc-200">
                      {noTrackBridge.debtToken === "yes" ? "YES" : "NO"}
                    </span>
                  </p>
                  <dl className="space-y-1 text-[9px] text-zinc-400">
                    <div className="flex justify-between gap-2">
                      <dt>Owed</dt>
                      <dd className="tabular-nums text-zinc-200">
                        {noTrackBridge.debtOwedHuman}{" "}
                        {noTrackBridge.debtToken === "yes" ? "YES" : "NO"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>In wallet</dt>
                      <dd className="tabular-nums text-zinc-200">
                        {noTrackBridge.walletDebtTokenHuman}{" "}
                        {noTrackBridge.debtToken === "yes" ? "YES" : "NO"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>Short</dt>
                      <dd className="tabular-nums text-zinc-200">
                        {noTrackBridge.shortfallHuman}{" "}
                        {noTrackBridge.debtToken === "yes" ? "YES" : "NO"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>Min USDC to mint</dt>
                      <dd className="tabular-nums text-amber-100/90">
                        {noTrackBridge.minUsdcHuman} USDC
                      </dd>
                    </div>
                  </dl>
                  <div className="flex flex-col gap-1.5 sm:flex-row sm:items-end">
                    <label className="flex min-w-0 flex-1 flex-col gap-0.5 text-[9px] text-zinc-500">
                      <span>USDC {noTrackBridge.minUsdcHuman} min</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={bridgeUsdcByDir.no}
                        onChange={(e) => {
                          bridgeTouched.current.no = true;
                          setBridgeUsdcByDir((p) => ({
                            ...p,
                            no: e.target.value,
                          }));
                        }}
                        className="rounded border border-white/[0.1] bg-black/30 px-2 py-1 text-[10px] text-zinc-100"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={bridgeBusy || !connected}
                      onClick={() => void runDebtBridge("no")}
                      className={cn(actionBtnClass, "whitespace-nowrap border-amber-500/30")}
                    >
                      {bridgeBusy ? "…" : "Mint from USDC for repay"}
                    </button>
                  </div>
                </div>
              ) : null}
              {bridgeError ? (
                <p className="text-[10px] text-amber-200/90">{bridgeError}</p>
              ) : null}
            </div>
          )}
          {hasActiveLendingPosition(snapshot) && positionMetrics ? (
            <div className="mt-3">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[10px] sm:grid-cols-3 md:grid-cols-4">
                <div>
                  <dt className="text-zinc-500">Current effective leverage</dt>
                  <dd className="mt-0.5 tabular-nums text-[13px] font-semibold text-zinc-100">
                    {formatLeverageMult(positionMetrics.currentEffectiveLeverage)}
                  </dd>
                </div>
                {openedAtLeverageApprox != null ? (
                  <div>
                    <dt
                      className="text-zinc-500"
                      title="Target multiple from the last successful open in this session (preview)."
                    >
                      Opened at ~
                    </dt>
                    <dd className="mt-0.5 tabular-nums text-[13px] font-semibold text-zinc-300">
                      {openedAtLeverageApprox.toFixed(2)}×
                    </dd>
                  </div>
                ) : null}
                <div>
                  <dt className="text-zinc-500">Directional exposure (USD)</dt>
                  <dd className="mt-0.5 tabular-nums text-[13px] font-semibold text-zinc-100">
                    {formatUsd(positionMetrics.directionalExposureUsd)}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Collateral value</dt>
                  <dd className="mt-0.5 tabular-nums text-[13px] font-semibold text-zinc-100">
                    {formatUsd(positionMetrics.collateralValueUsd)}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Debt value</dt>
                  <dd className="mt-0.5 tabular-nums text-[13px] font-semibold text-zinc-100">
                    {formatUsd(positionMetrics.debtValueUsd)}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Net equity</dt>
                  <dd className="mt-0.5 tabular-nums text-[13px] font-semibold text-zinc-100">
                    {formatUsd(positionMetrics.equityUsd)}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Health factor</dt>
                  <dd className="mt-0.5 tabular-nums text-[13px] font-semibold text-zinc-100">
                    {formatHealthMult(positionMetrics.healthFactor)}
                  </dd>
                </div>
                <div
                  title="Not modeled here; rely on health factor and protocol CFs."
                >
                  <dt
                    className="text-zinc-500"
                    title="Liquidation in implied-price space is not computed in-app."
                  >
                    Liquidation price
                  </dt>
                  <dd className="mt-0.5 tabular-nums text-[13px] font-semibold text-zinc-500">
                    —
                  </dd>
                </div>
              </dl>
            </div>
          ) : null}

          {hasActiveLendingPosition(snapshot) ? (
            <p className="mt-2 text-[10px] leading-snug text-zinc-600">
              {useSettlementCta ? (
                <>
                  <span className="text-zinc-500">Settle</span> repays and returns
                  YES/NO to your wallet at resolved prices, not USDC. Cash out
                  winners in the trade panel under{" "}
                  <span className="text-zinc-500">Redeem</span>.
                </>
              ) : (
                <>
                  <span className="text-zinc-500">Close</span> repays and returns
                  YES/NO to your wallet. Use{" "}
                  <span className="text-zinc-500">Sell</span> to swap toward USDC
                  if you want.
                </>
              )}
            </p>
          ) : null}

          <details className="group mt-3 open:pb-0">
            <summary className="cursor-pointer list-none text-[10px] font-medium text-zinc-500 marker:content-none [&::-webkit-details-marker]:hidden">
              <span className="underline decoration-zinc-600 underline-offset-2 group-open:text-zinc-400">
                Advanced: on-chain raw (atoms)
              </span>
            </summary>
            <dl className="mt-1.5 space-y-1 text-[10px] text-zinc-500">
              <div className="flex justify-between gap-2">
                <dt>Deposited YES</dt>
                <dd className="tabular-nums text-zinc-300">
                  {formatBaseUnitsToDecimalString(
                    BigInt(snapshot.collateralYesAtoms),
                    balances.yesDecimals,
                    4,
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Deposited NO</dt>
                <dd className="tabular-nums text-zinc-300">
                  {formatBaseUnitsToDecimalString(
                    BigInt(snapshot.collateralNoAtoms),
                    balances.noDecimals,
                    4,
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Debt YES</dt>
                <dd className="tabular-nums text-zinc-300">
                  {formatBaseUnitsToDecimalString(
                    BigInt(snapshot.debtYesAtoms),
                    balances.yesDecimals,
                    4,
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Debt NO</dt>
                <dd className="tabular-nums text-zinc-300">
                  {formatBaseUnitsToDecimalString(
                    BigInt(snapshot.debtNoAtoms),
                    balances.noDecimals,
                    4,
                  )}
                </dd>
              </div>
            </dl>
          </details>

          {actionError ? (
            <p className="mt-2 text-[10px] text-amber-200/90">{actionError}</p>
          ) : null}
          {lastCloseDetail ? (
            <div className="mt-2 space-y-1.5 rounded-md border border-white/[0.06] bg-white/[0.02] p-2 text-[10px] text-zinc-400">
              <p className="text-[9px] font-medium text-zinc-500">
                {lastSettledOnResolution ? "Position settled" : "Position closed"}
              </p>
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
                <TxExplorerLink
                  signature={lastCloseDetail.closeSig}
                  linkClassName="!text-white decoration-white/25 hover:!text-zinc-200 hover:decoration-white/40"
                />
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <p className="mt-3 text-[11px] text-zinc-600">No open position for this market.</p>
      )}
    </div>
  );
}

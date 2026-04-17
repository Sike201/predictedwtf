"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { ExternalLink } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

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
  buildCloseLeveragedNoPositionTransaction,
  buildCloseLeveragedYesPositionTransaction,
} from "@/lib/solana/omnipair-close-leverage";
import {
  formatBaseUnitsToDecimalString,
} from "@/lib/solana/wallet-token-balances";
import { devnetAccountExplorerUrl } from "@/lib/utils/solana-explorer";
import { cn } from "@/lib/utils/cn";

const SLIPPAGE_BPS = 150;

const actionBtnClass =
  "rounded-md border border-white/[0.12] px-2 py-1 text-[10px] font-medium text-zinc-200 transition hover:border-white/[0.2] hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-40";

type Props = {
  market: Market;
  snapshot: OmnipairUserPositionSnapshot | null;
  loading: boolean;
  error: string | null;
  onPositionTxSettled?: () => void;
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
  const [lastSig, setLastSig] = useState<string | null>(null);

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
      setActionError(null);
      setLastSig(null);
      if (!connected || !publicKey || !signTransaction || !pairAddress || !yesMint || !noMint) {
        setActionError("Connect a wallet.");
        return;
      }
      setBusy(true);
      try {
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

        const { blockhash, lastValidBlockHeight } =
          await connection.getLatestBlockhash("confirmed");
        built.transaction.feePayer = publicKey;
        built.transaction.recentBlockhash = blockhash;
        const signed = await signTransaction(built.transaction);
        const sig = await connection.sendRawTransaction(signed.serialize(), {
          skipPreflight: false,
          maxRetries: 0,
        });
        await connection.confirmTransaction(
          { signature: sig, blockhash, lastValidBlockHeight },
          "confirmed",
        );
        setLastSig(sig);
        onPositionTxSettled?.();
      } catch (e: unknown) {
        setActionError(e instanceof Error ? e.message : "Close failed");
      } finally {
        setBusy(false);
      }
    },
    [
      connection,
      onPositionTxSettled,
      pairAddress,
      publicKey,
      signTransaction,
      connected,
      yesMint,
      noMint,
    ],
  );

  const onClosePosition = useCallback(() => {
    if (hasYesTrack && !hasNoTrack) void runClose("yes");
    else if (hasNoTrack && !hasYesTrack) void runClose("no");
    else if (hasYesTrack && hasNoTrack) {
      setActionError("Close one side from the portfolio (both tracks active).");
    }
  }, [hasNoTrack, hasYesTrack, runClose]);

  if (!pool?.poolId) return null;

  const positionActions =
    snapshot?.userPositionPda ? (
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
        {hasYesTrack && hasNoTrack ? (
          <>
            <button
              type="button"
              disabled={busy || !connected}
              onClick={() => void runClose("yes")}
              className={actionBtnClass}
            >
              {busy ? "…" : "Close YES"}
            </button>
            <button
              type="button"
              disabled={busy || !connected}
              onClick={() => void runClose("no")}
              className={actionBtnClass}
            >
              {busy ? "…" : "Close NO"}
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={busy || !connected || (!hasYesTrack && !hasNoTrack)}
            onClick={() => void onClosePosition()}
            className={actionBtnClass}
          >
            {busy ? "…" : "Close position"}
          </button>
        )}
        <button
          type="button"
          disabled
          title="Reduce leverage — not available in-app yet."
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
          {lastSig ? (
            <div className="mt-2 text-[10px]">
              <TxExplorerLink
                signature={lastSig}
                linkClassName="!text-white decoration-white/25 hover:!text-zinc-200 hover:decoration-white/40"
              />
            </div>
          ) : null}
        </>
      ) : (
        <p className="mt-3 text-[11px] text-zinc-600">No open position for this market.</p>
      )}
    </div>
  );
}

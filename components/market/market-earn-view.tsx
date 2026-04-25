"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { MarketActionsCard } from "@/components/market/market-actions-card";
import { MarketDetailHeader } from "@/components/market/market-detail-header";
import { useLiveOmnipairPool } from "@/lib/hooks/use-live-omnipair-pool";
import { useDetailDerivedVolume } from "@/lib/hooks/use-detail-derived-volume";
import { useWallet } from "@/lib/hooks/use-wallet";
import {
  decodeFutarchySwapShareBps,
  decodeOmnipairPairAccount,
} from "@/lib/solana/decode-omnipair-accounts";
import { getGlobalFutarchyAuthorityPDA } from "@/lib/solana/omnipair-pda";
import { requireOmnipairProgramId } from "@/lib/solana/omnipair-program";
import {
  estimateFeeAprFromVolume,
  estimatePoolLiquidityUsdHint,
} from "@/lib/solana/omnipair-liquidity-math";
import { OUTCOME_MINT_DECIMALS } from "@/lib/solana/create-outcome-mints";
import type { Market } from "@/lib/types/market";
import { defiWellPanel } from "@/lib/ui/defi-well";
import { cn } from "@/lib/utils/cn";

type MarketEarnViewProps = {
  market: Market;
};

function fmtUsd(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: n >= 1 ? 2 : 4,
    }).format(n);
  } catch {
    return "—";
  }
}

function fmtPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(2)}%`;
}

const earnPanelClass = cn(defiWellPanel, "space-y-3 p-4 sm:p-5");

export function MarketEarnView({ market }: MarketEarnViewProps) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const livePool = useLiveOmnipairPool(market);
  const detailVol = useDetailDerivedVolume(market);

  const [vol24h, setVol24h] = useState<number | null>(null);
  const [vol24hLoading, setVol24hLoading] = useState(false);

  const [lpAtoms, setLpAtoms] = useState<bigint | null>(null);
  const [lpLoading, setLpLoading] = useState(false);
  const [totalLp, setTotalLp] = useState<bigint | null>(null);
  const [lpDecimals, setLpDecimals] = useState<number>(OUTCOME_MINT_DECIMALS);
  const [pairFee, setPairFee] = useState<{
    swapFeeBps: number;
    futarchyShareBps: number;
  } | null>(null);

  const hasPool = !!(
    market.pool?.poolId &&
    market.pool?.yesMint &&
    market.pool?.noMint
  );

  const pYes = livePool.yesProbability;
  const liquidityUsd = useMemo(() => {
    const snap = livePool.chainSnapshot;
    if (!snap || pYes == null) return 0;
    return estimatePoolLiquidityUsdHint({
      reserveYesAtoms: snap.reserveYes,
      reserveNoAtoms: snap.reserveNo,
      yesProbability: pYes,
    });
  }, [livePool.chainSnapshot, pYes]);

  const aprEstimate = useMemo(() => {
    if (
      vol24h == null ||
      vol24h <= 0 ||
      liquidityUsd <= 0 ||
      !pairFee
    ) {
      return null;
    }
    return estimateFeeAprFromVolume({
      volume24hUsd: vol24h,
      liquidityUsd,
      swapFeeBps: pairFee.swapFeeBps,
      futarchySwapShareBps: pairFee.futarchyShareBps,
    });
  }, [vol24h, liquidityUsd, pairFee]);

  const userShare = useMemo(() => {
    if (lpAtoms == null || totalLp == null || totalLp === 0n) return null;
    return Number(lpAtoms) / Number(totalLp);
  }, [lpAtoms, totalLp]);

  const currentValueUsd = useMemo(() => {
    if (userShare == null || !Number.isFinite(liquidityUsd) || liquidityUsd <= 0) {
      return null;
    }
    return userShare * liquidityUsd;
  }, [userShare, liquidityUsd]);

  const refreshVolumes = useCallback(async () => {
    if (!hasPool || !market.pool) return;
    setVol24hLoading(true);
    try {
      const qs = new URLSearchParams({
        poolId: market.pool.poolId,
        yesMint: market.pool.yesMint,
        noMint: market.pool.noMint,
        window: "24h",
      });
      const res = await fetch(`/api/market/swap-volume?${qs.toString()}`);
      const j = (await res.json().catch(() => ({}))) as { volumeUsd?: number };
      setVol24h(
        typeof j.volumeUsd === "number" && Number.isFinite(j.volumeUsd)
          ? Math.max(0, j.volumeUsd)
          : 0,
      );
    } catch {
      setVol24h(0);
    } finally {
      setVol24hLoading(false);
    }
  }, [hasPool, market.pool]);

  const refreshLpPosition = useCallback(async () => {
    if (!hasPool || !market.pool || !publicKey) {
      setLpAtoms(null);
      setTotalLp(null);
      return;
    }
    setLpLoading(true);
    try {
      const programId = requireOmnipairProgramId();
      const pair = new PublicKey(market.pool.poolId);
      const info = await connection.getAccountInfo(pair, "confirmed");
      if (!info?.data) {
        setLpAtoms(null);
        setTotalLp(null);
        return;
      }
      const dec = decodeOmnipairPairAccount(info.data);
      const [futarchyPk] = getGlobalFutarchyAuthorityPDA(programId);
      const fa = await connection.getAccountInfo(futarchyPk, "confirmed");
      if (fa?.data) {
        setPairFee({
          swapFeeBps: dec.swapFeeBps,
          futarchyShareBps: decodeFutarchySwapShareBps(fa.data),
        });
      } else {
        setPairFee({ swapFeeBps: dec.swapFeeBps, futarchyShareBps: 0 });
      }

      const m = await getMint(connection, dec.lpMint);
      setTotalLp(m.supply);
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
      setTotalLp(null);
    } finally {
      setLpLoading(false);
    }
  }, [hasPool, market.pool, publicKey, connection]);

  useEffect(() => {
    void refreshVolumes();
  }, [refreshVolumes]);

  useEffect(() => {
    void refreshLpPosition();
  }, [refreshLpPosition, livePool.refreshEpoch]);

  const onMarketActionsSettled = useCallback(() => {
    void livePool.refresh("earn_market_actions");
    void refreshLpPosition();
    void refreshVolumes();
  }, [livePool, refreshLpPosition, refreshVolumes]);

  const detailHeaderVol = {
    hasPool: detailVol.hasPool,
    loading: detailVol.loading,
    volumeUsd: detailVol.derived ? detailVol.derived.volumeUsd : null,
    swapsParsed: detailVol.derived?.swapsParsed ?? 0,
    signaturesScanned: 0,
    error: detailVol.error,
  };

  return (
    <div className="min-h-screen bg-[#070707] text-zinc-100">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <Link
            href={`/markets/${encodeURIComponent(market.id)}`}
            className="text-[12px] text-zinc-500 hover:text-zinc-300"
          >
            ← Back to market
          </Link>
        </div>

        {livePool.rpcDegradedMessage ? (
          <div
            className="mb-4 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-[13px] text-amber-100/95"
            role="status"
          >
            {livePool.rpcDegradedMessage}
          </div>
        ) : null}

        <MarketDetailHeader
          market={market}
          liveYesProbability={livePool.yesProbability}
          detailVolume={detailHeaderVol}
        />

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <div className={earnPanelClass}>
              <h2 className="text-[13px] font-semibold text-white">
                Pool stats
              </h2>
              <dl className="grid grid-cols-1 gap-2 text-[12px] sm:grid-cols-2">
                <div>
                  <dt className="text-zinc-500">Total liquidity (est.)</dt>
                  <dd className="font-medium">
                    {livePool.loading ? "…" : fmtUsd(liquidityUsd)}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">24h volume</dt>
                  <dd className="font-medium">
                    {vol24hLoading
                      ? "…"
                      : vol24h == null
                        ? "—"
                        : fmtUsd(vol24h)}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Cumulative volume</dt>
                  <dd className="font-medium">
                    {detailVol.loading
                      ? "…"
                      : detailVol.derived
                        ? fmtUsd(detailVol.derived.volumeUsd)
                        : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Swap fee (pair)</dt>
                  <dd className="font-medium">
                    {pairFee
                      ? `${(pairFee.swapFeeBps / 100).toFixed(2)}%`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Est. APR (from 24h vol)</dt>
                  <dd className="font-medium">
                    {aprEstimate == null ? "—" : fmtPct(aprEstimate)}
                    <span className="ml-1 text-zinc-500">(est.)</span>
                  </dd>
                </div>
              </dl>
            </div>

            <div className={earnPanelClass}>
              <h2 className="text-[13px] font-semibold text-white">
                Your LP position
              </h2>
              {!publicKey ? (
                <p className="text-[12px] text-zinc-500">Connect a wallet to view.</p>
              ) : lpLoading ? (
                <p className="text-[12px] text-zinc-500">Loading…</p>
              ) : (
                <dl className="grid grid-cols-1 gap-2 text-[12px] sm:grid-cols-2">
                  <div>
                    <dt className="text-zinc-500">Pool share</dt>
                    <dd className="font-medium">
                      {userShare == null ? "—" : fmtPct(userShare)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Current value (est.)</dt>
                    <dd className="font-medium">
                      {currentValueUsd == null ? "—" : fmtUsd(currentValueUsd)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Deposited value</dt>
                    <dd className="font-medium text-zinc-500">Not tracked on-chain</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Fees earned</dt>
                    <dd className="font-medium text-zinc-500">— (accrue to share value)</dd>
                  </div>
                </dl>
              )}
            </div>
          </div>

          <div className="space-y-4">
            {market.kind === "binary" &&
            market.pool &&
            (market.phase === "trading" ||
              market.phase === "resolving" ||
              market.phase === "resolved") ? (
              <MarketActionsCard
                market={market}
                wrapInDefiWell
                variant="earn"
                initialActionTab="deposit"
                poolPriceLoading={livePool.loading}
                liveYesProbability={livePool.yesProbability ?? undefined}
                liveNoProbability={livePool.noProbability ?? undefined}
                livePriceUnavailable={livePool.unavailable}
                oneSidedLiquidity={livePool.oneSidedLiquidity}
                onPoolTxSettled={onMarketActionsSettled}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

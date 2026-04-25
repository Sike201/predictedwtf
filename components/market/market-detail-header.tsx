"use client";

import Image from "next/image";
import { Bell, Share2 } from "lucide-react";
import { useEffect, useRef } from "react";
import {
  AnimatedVolume,
  fmtUsdCompactVol,
} from "@/components/markets/animated-volume";
import { usePendingVolumeDelta } from "@/lib/hooks/use-pending-volume-delta";
import type { Market } from "@/lib/types/market";
import { marketDisplayMeta } from "@/lib/data/market-presentation";
import { cn } from "@/lib/utils/cn";

export type MarketDetailVolumeSource = {
  hasPool: boolean;
  loading: boolean;
  /** null until first successful on-chain aggregate fetch */
  volumeUsd: number | null;
  swapsParsed: number;
  signaturesScanned: number;
  error: string | null;
};

type Props = {
  market: Market;
  /** Live pool YES probability when available; falls back to cached `market.yesProbability`. */
  liveYesProbability?: number | null;
  className?: string;
  /**
   * Detail page: total volume from `fetchPoolTotalSwapVolumeUsdWithStats` (swap-volume API),
   * not `markets.last_known_volume_usd`.
   */
  detailVolume: MarketDetailVolumeSource;
};

export function MarketDetailHeader({
  market,
  liveYesProbability,
  className,
  detailVolume,
}: Props) {
  const { creatorHandle } = marketDisplayMeta(market);

  const dbCachedVol =
    typeof market.snapshot?.volumeUsd === "number" &&
    Number.isFinite(market.snapshot.volumeUsd)
      ? Math.max(0, market.snapshot.volumeUsd)
      : 0;

  const usingDerivedVolume =
    detailVolume.hasPool &&
    typeof detailVolume.volumeUsd === "number" &&
    Number.isFinite(detailVolume.volumeUsd);

  /** Pending overlay syncs against the same basis shown (on-chain aggregate when available). */
  const basisForPendingSync = usingDerivedVolume
    ? Math.max(0, detailVolume.volumeUsd!)
    : dbCachedVol;

  const pendingVol = usePendingVolumeDelta(
    market.id,
    basisForPendingSync,
    market.lastStatsUpdatedAt,
  );

  let volNumForDisplay: number | null;
  if (!detailVolume.hasPool) {
    volNumForDisplay = Math.max(0, dbCachedVol + pendingVol);
  } else if (detailVolume.volumeUsd === null && detailVolume.loading) {
    volNumForDisplay = null;
  } else {
    const base =
      detailVolume.volumeUsd === null
        ? 0
        : Math.max(0, detailVolume.volumeUsd);
    volNumForDisplay = base + pendingVol;
  }

  const volumeUiPrev = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    console.info("[predicted][volume-ui-render]", {
      slug: market.id,
      volumeUsd: volNumForDisplay,
      dbCachedVolumeUsd: dbCachedVol,
      pendingVolumeUsd: pendingVol,
      usingDerivedVolume,
      detailVolumeUsd: detailVolume.volumeUsd,
      lastStatsUpdatedAt: market.lastStatsUpdatedAt ?? null,
      changedFromPrev:
        volumeUiPrev.current !== undefined &&
        volumeUiPrev.current !== volNumForDisplay,
    });
    volumeUiPrev.current = volNumForDisplay ?? undefined;
  }, [
    dbCachedVol,
    detailVolume.volumeUsd,
    market.id,
    market.lastStatsUpdatedAt,
    pendingVol,
    usingDerivedVolume,
    volNumForDisplay,
  ]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    console.info(
      "[predicted][ui-state-trace]",
      JSON.stringify({
        component: "MarketDetailHeader",
        slug: market.id,
        propName: "market",
        displayedPhase: market.phase,
        displayedResolutionStatus: market.resolution.status,
      }),
    );
  }, [market.id, market.phase, market.resolution.status]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const live = liveYesProbability;
    console.info("[predicted][volume-cache] detail_header_render", {
      component: "MarketDetailHeader",
      marketSlug: market.id,
      marketRowId: market.marketRowId ?? null,
      volumeDisplaySource: usingDerivedVolume
        ? "detail_onchain_swap_total"
        : "db_cached_last_known_volume_usd",
      volumeUsd: volNumForDisplay,
      dbCachedVolumeUsd: dbCachedVol,
      pendingVolumeUsd: pendingVol,
      formatted:
        volNumForDisplay != null ? fmtUsdCompactVol(volNumForDisplay) : "…",
      chanceSource:
        live != null && Number.isFinite(live) ? "live_pool" : "db_cached_yes",
    });
  }, [
    dbCachedVol,
    liveYesProbability,
    market.id,
    market.marketRowId,
    pendingVol,
    usingDerivedVolume,
    volNumForDisplay,
  ]);

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex min-w-0 gap-3 sm:gap-4">
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-[#1a1a1a] ring-1 ring-white/[0.06] sm:h-16 sm:w-16">
          <Image
            src={market.imageUrl}
            alt=""
            fill
            className="object-cover"
            sizes="64px"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h1 className="min-w-0 text-balance text-xl font-semibold leading-snug tracking-tight text-white sm:text-2xl">
              {market.question}
            </h1>
            <div className="flex shrink-0 gap-0.5">
              <button
                type="button"
                className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-300"
                aria-label="Notifications"
              >
                <Bell className="h-[17px] w-[17px]" strokeWidth={1.75} />
              </button>
              <button
                type="button"
                className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-300"
                aria-label="Share"
              >
                <Share2 className="h-[17px] w-[17px]" strokeWidth={1.75} />
              </button>
            </div>
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-zinc-500">
            {market.resolution.status === "resolved" && market.resolution.resolvedAt ? (
              <span className="text-zinc-500">
                {new Date(market.resolution.resolvedAt).toLocaleString()}
              </span>
            ) : null}
            {market.resolution.status === "resolved" && market.resolution.resolvedAt ? (
              <span className="text-zinc-700">·</span>
            ) : null}
            {market.engine === "PM_AMM" ? (
              <>
                <span className="rounded border border-violet-500/40 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-200">
                  pmAMM
                </span>
                <span className="text-zinc-700">·</span>
              </>
            ) : null}
            <span>
              By{" "}
              <span className="font-medium text-zinc-300">{creatorHandle}</span>
            </span>
            <span className="text-zinc-700">·</span>
            <span className="text-zinc-300">
              {volNumForDisplay == null ? (
                <span className="tabular-nums text-zinc-500">…</span>
              ) : (
                <AnimatedVolume
                  className="text-zinc-300"
                  value={volNumForDisplay}
                  suffix=" Vol."
                  suffixMuted={false}
                />
              )}
            </span>
            {market.resolution.status === "resolved" ? (
              <>
                <span className="text-zinc-700">·</span>
                <span className="text-[11px] text-zinc-500">Resolved</span>
              </>
            ) : null}
          </p>
        </div>
      </div>
    </div>
  );
}

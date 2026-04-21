"use client";

import Image from "next/image";
import { Bell, Share2 } from "lucide-react";
import { useEffect, useRef } from "react";
import {
  AnimatedVolume,
  fmtUsdCompactVol,
} from "@/components/markets/animated-volume";
import type { Market } from "@/lib/types/market";
import { marketDisplayMeta } from "@/lib/data/market-presentation";
import { cn } from "@/lib/utils/cn";

type Props = {
  market: Market;
  /** Live pool YES probability when available; falls back to cached `market.yesProbability`. */
  liveYesProbability?: number | null;
  className?: string;
};

export function MarketDetailHeader({
  market,
  liveYesProbability,
  className,
}: Props) {
  const { creatorHandle } = marketDisplayMeta(market);

  /** Volume shown directly from DB cached snapshot — no on-chain scan in the header render path. */
  const volNum =
    typeof market.snapshot?.volumeUsd === "number" &&
    Number.isFinite(market.snapshot.volumeUsd)
      ? Math.max(0, market.snapshot.volumeUsd)
      : 0;

  const volumeUiPrev = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    console.info("[predicted][volume-ui-render]", {
      slug: market.id,
      volumeUsd: volNum,
      lastStatsUpdatedAt: market.lastStatsUpdatedAt ?? null,
      changedFromPrev:
        volumeUiPrev.current !== undefined && volumeUiPrev.current !== volNum,
    });
    volumeUiPrev.current = volNum;
  }, [market.id, market.lastStatsUpdatedAt, volNum]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const live = liveYesProbability;
    console.info("[predicted][volume-cache] detail_header_render", {
      component: "MarketDetailHeader",
      marketSlug: market.id,
      marketRowId: market.marketRowId ?? null,
      source: "db_cached_last_known_volume_usd",
      volumeUsd: volNum,
      formatted: fmtUsdCompactVol(volNum),
      chanceSource:
        live != null && Number.isFinite(live) ? "live_pool" : "db_cached_yes",
    });
  }, [liveYesProbability, market.id, market.marketRowId, volNum]);

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
            <h1 className="text-balance text-xl font-semibold leading-snug tracking-tight text-white sm:text-2xl">
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
            <span>
              By{" "}
              <span className="font-medium text-zinc-300">{creatorHandle}</span>
            </span>
            <span className="text-zinc-700">·</span>
            <span className="text-zinc-300">
              <AnimatedVolume
                className="text-zinc-300"
                value={volNum}
                suffix=" Vol."
                suffixMuted={false}
              />
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}

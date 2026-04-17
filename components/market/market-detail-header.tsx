"use client";

import Image from "next/image";
import { Bell, Share2 } from "lucide-react";
import { AnimatedVolume } from "@/components/markets/animated-volume";
import type { Market } from "@/lib/types/market";
import { marketDisplayMeta } from "@/lib/data/market-presentation";
import { cn } from "@/lib/utils/cn";

type Props = {
  market: Market;
  className?: string;
};

function fmtUsdCompact(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function MarketDetailHeader({ market, className }: Props) {
  const { creatorHandle } = marketDisplayMeta(market);
  const vol = fmtUsdCompact(market.snapshot.volumeUsd);

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
            <AnimatedVolume
              value={market.snapshot.volumeUsd}
              suffix=" Vol."
              suffixMuted={false}
            />
          </p>
        </div>
      </div>
    </div>
  );
}

"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import type { Market } from "@/lib/types/market";
import { cn } from "@/lib/utils/cn";
import { fmtUsdCompactVol } from "@/components/markets/animated-volume";
import { FEED_TILE_CLASS } from "@/lib/constants/feed-layout";
import {
  eventPagePathForGroupKey,
  outcomeLabelFromMarket,
} from "@/lib/market/group-feed-markets";

const PREVIEW_ROWS = 4;

type GroupedEventCardProps = {
  groupKey: string;
  title: string;
  markets: Market[];
};

export function GroupedEventCard({
  groupKey,
  title,
  markets,
}: GroupedEventCardProps) {
  const router = useRouter();
  const warmedRef = useRef(false);

  const hero = markets[0]!;
  const href = eventPagePathForGroupKey(groupKey);

  const totalVol = markets.reduce((sum, m) => {
    const v = m.snapshot?.volumeUsd;
    const n =
      typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 0;
    return sum + n;
  }, 0);

  const lifecycleWorst = markets.some(
    (m) => m.resolution.status === "resolving",
  )
    ? "resolving"
    : markets.every((m) => m.resolution.status === "resolved")
      ? "resolved"
      : "active";

  const preview = markets.slice(0, PREVIEW_ROWS);
  const moreCount = Math.max(0, markets.length - PREVIEW_ROWS);

  function prefetchEvent() {
    router.prefetch(href);
    if (warmedRef.current) return;
    warmedRef.current = true;
  }

  return (
    <article className={cn("min-h-0", FEED_TILE_CLASS)}>
      <Link
        href={href}
        onMouseEnter={prefetchEvent}
        onFocus={prefetchEvent}
        className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl bg-[#111] ring-1 ring-white/[0.05] transition-colors duration-200 hover:bg-[#161616]"
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {lifecycleWorst === "resolving" ? (
            <div className="shrink-0 border-b border-amber-500/15 bg-amber-500/10 px-2.5 py-1.5 sm:px-3">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-100/95">
                Resolving
              </span>
            </div>
          ) : lifecycleWorst === "resolved" ? (
            <div className="shrink-0 border-b border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1.5 sm:px-3">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-100/95">
                Resolved
              </span>
            </div>
          ) : null}

          <div className="flex shrink-0 items-start gap-2 border-b border-white/[0.06] p-2.5 sm:gap-3 sm:p-3">
            <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-black/30 sm:h-11 sm:w-11">
              <Image
                src={hero.imageUrl}
                alt=""
                fill
                className="object-cover"
                sizes="44px"
              />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="line-clamp-2 text-left text-[13px] font-medium leading-snug text-white sm:text-[14px]">
                {title}
              </h2>
              <p className="mt-0.5 text-[10px] text-zinc-500 sm:text-[11px]">
                {markets.length} outcomes
              </p>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col px-2.5 pb-1 pt-2 sm:px-3 sm:pt-2.5">
            <p className="mb-1 text-[9px] font-medium uppercase tracking-[0.1em] text-zinc-500">
              Top outcomes
            </p>
            <ul className="min-h-0 flex-1 space-y-1">
              {preview.map((m) => {
                const label =
                  outcomeLabelFromMarket(m) ??
                  m.question.slice(0, 28).trim() +
                    (m.question.length > 28 ? "…" : "");
                const yes = Math.round(m.yesProbability * 100);
                return (
                  <li
                    key={m.id}
                    className="flex items-baseline justify-between gap-2 text-[12px] sm:text-[13px]"
                  >
                    <span className="min-w-0 truncate font-medium text-zinc-200">
                      {label}
                    </span>
                    <span className="shrink-0 tabular-nums font-semibold text-zinc-300">
                      {yes}%
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="flex shrink-0 flex-col border-t border-white/[0.04] px-2.5 py-2 text-[10px] text-zinc-400 sm:px-3 sm:text-[11px]">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate tabular-nums text-zinc-300">
                {fmtUsdCompactVol(totalVol)} vol
              </span>
              {moreCount > 0 ? (
                <span className="shrink-0 text-zinc-500">+{moreCount} more</span>
              ) : null}
            </div>
          </div>
        </div>
      </Link>
    </article>
  );
}

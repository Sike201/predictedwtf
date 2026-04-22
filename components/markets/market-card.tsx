"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import type { Market } from "@/lib/types/market";
import { fmtUsdCompactVol } from "@/components/markets/animated-volume";
import { usePendingVolumeDelta } from "@/lib/hooks/use-pending-volume-delta";
import { FEED_TILE_CLASS } from "@/lib/constants/feed-layout";
import { cn } from "@/lib/utils/cn";

function CardMeta({ market }: { market: Market }) {
  const incoming = market.snapshot?.volumeUsd;
  const serverVol =
    typeof incoming === "number" && Number.isFinite(incoming)
      ? Math.max(0, incoming)
      : 0;
  const pending = usePendingVolumeDelta(
    market.id,
    serverVol,
    market.lastStatsUpdatedAt,
  );
  const vol = serverVol + pending;
  const renderedText = `${fmtUsdCompactVol(vol)} vol`;

  const volumeUiPrev = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    console.info("[predicted][volume-ui-refresh]", {
      component: "MarketCard.CardMeta",
      marketSlug: market.id,
      volumeBefore: volumeUiPrev.current,
      volumeAfter: vol,
    });
    volumeUiPrev.current = vol;
  }, [market.id, pending, serverVol, vol]);

  return (
    <div className="flex shrink-0 items-center border-t border-white/[0.04] px-2.5 py-2 text-[10px] text-zinc-400 sm:px-3 sm:text-[11px]">
      <span className="min-w-0 truncate tabular-nums text-zinc-300">
        {renderedText}
      </span>
    </div>
  );
}

function YesNoLabels({ yes }: { yes: number }) {
  const no = 100 - yes;
  return (
    <div className="flex flex-shrink-0 flex-wrap items-baseline justify-end gap-2 sm:gap-3">
      <span className="text-[12px] font-semibold tabular-nums text-emerald-400 sm:text-[13px]">
        Yes {yes}%
      </span>
      <span className="text-[12px] font-semibold tabular-nums text-red-400/95 sm:text-[13px]">
        No {no}%
      </span>
    </div>
  );
}

function BinaryCardA({ market }: { market: Market }) {
  const yes = Math.round(market.yesProbability * 100);
  return (
    <>
      <div className="flex gap-2 p-2.5 sm:gap-3 sm:p-3">
        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-black/30 sm:h-11 sm:w-11">
          <Image
            src={market.imageUrl}
            alt=""
            fill
            className="object-cover"
            sizes="44px"
          />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="line-clamp-3 text-left text-[13px] font-medium leading-snug text-white sm:text-[14px]">
            {market.question}
          </h2>
        </div>
      </div>
      <div className="flex flex-col px-2.5 pt-0 sm:px-3">
        <div className="flex items-end justify-between gap-2">
          <div>
            <p className="text-[9px] font-medium uppercase tracking-[0.1em] text-zinc-500">
              Chance
            </p>
            <p className="text-2xl font-semibold tabular-nums tracking-tight text-white sm:text-3xl">
              {yes}
              <span className="text-lg font-semibold text-zinc-500 sm:text-xl">%</span>
            </p>
          </div>
          <YesNoLabels yes={yes} />
        </div>
      </div>
    </>
  );
}

function BinaryCardB({ market }: { market: Market }) {
  const yes = Math.round(market.yesProbability * 100);
  return (
    <>
      <div className="relative h-[68px] w-full shrink-0 overflow-hidden bg-black/40 sm:h-[72px]">
        <Image
          src={market.imageUrl}
          alt=""
          fill
          className="object-cover"
          sizes="(max-width: 768px) 100vw, 50vw"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#181a1f] via-transparent to-transparent" />
      </div>
      <div className="flex flex-col px-2.5 pt-2 sm:px-3 sm:pt-2.5">
        <h2 className="line-clamp-3 text-[13px] font-medium leading-snug text-white sm:text-[14px]">
          {market.question}
        </h2>
        <div className="mt-2 flex items-end justify-between gap-2">
          <div>
            <p className="text-[9px] font-medium uppercase tracking-[0.1em] text-zinc-500">
              Implied
            </p>
            <p className="text-2xl font-semibold tabular-nums text-white sm:text-3xl">
              {yes}
              <span className="text-lg text-zinc-500">%</span>
            </p>
          </div>
          <YesNoLabels yes={yes} />
        </div>
      </div>
    </>
  );
}

function DatesCardC({ market }: { market: Market }) {
  const rows = market.dateOutcomes ?? [];
  const top = rows[0];
  const topPct = top ? Math.round(top.probability * 100) : 0;
  return (
    <>
      <div className="flex gap-2 p-2.5 sm:gap-3 sm:p-3">
        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-black/30 sm:h-11 sm:w-11">
          <Image
            src={market.imageUrl}
            alt=""
            fill
            className="object-cover"
            sizes="44px"
          />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="line-clamp-3 text-[13px] font-medium leading-snug text-white sm:text-[14px]">
            {market.question}
          </h2>
          <p className="mt-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-zinc-500">
            Date outcomes
          </p>
        </div>
      </div>
      <div className="flex flex-col px-2.5 pt-0 sm:px-3">
        <div className="mb-2 flex items-end justify-between">
          <div>
            <p className="text-[9px] text-zinc-500">Leading</p>
            <p className="text-xl font-semibold tabular-nums text-white sm:text-2xl">
              {topPct}
              <span className="text-base text-zinc-500 sm:text-lg">%</span>
            </p>
          </div>
        </div>
        <ul className="space-y-1.5 pb-1">
          {rows.map((o) => {
            const p = Math.round(o.probability * 100);
            return (
              <li key={o.id}>
                <div className="mb-0.5 flex justify-between text-[11px] sm:text-[12px]">
                  <span className="truncate pr-2 text-zinc-300">{o.label}</span>
                  <span className="shrink-0 tabular-nums text-zinc-400">{p}%</span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="h-full rounded-full bg-zinc-400/80"
                    style={{ width: `${p}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}

function DatesCardD({ market }: { market: Market }) {
  const rows = market.dateOutcomes ?? [];
  return (
    <>
      <div className="relative h-12 w-full shrink-0 overflow-hidden bg-black/40 sm:h-14">
        <Image
          src={market.imageUrl}
          alt=""
          fill
          className="object-cover opacity-90"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#181a1f] via-[#181a1f]/70 to-transparent" />
      </div>
      <div className="flex flex-col px-2.5 pt-2 sm:px-3">
        <h2 className="line-clamp-2 text-[13px] font-medium leading-snug text-white sm:text-[14px]">
          {market.question}
        </h2>
        <ul className="mt-2 space-y-1.5 pb-1">
          {rows.map((o) => {
            const p = Math.round(o.probability * 100);
            return (
              <li
                key={o.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.03] px-2 py-1.5 sm:px-2.5"
              >
                <span className="truncate text-[12px] text-zinc-200">{o.label}</span>
                <span className="shrink-0 text-[12px] font-semibold tabular-nums text-white sm:text-[13px]">
                  {p}%
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}

function CardInner({ market }: { market: Market }) {
  if (market.kind === "dates") {
    return market.cardLayout === "d" ? (
      <DatesCardD market={market} />
    ) : (
      <DatesCardC market={market} />
    );
  }
  return market.cardLayout === "b" ? (
    <BinaryCardB market={market} />
  ) : (
    <BinaryCardA market={market} />
  );
}

/** Date-style cards can overflow; binary YES/NO fits without inner scroll. */
function CardContentArea({ market }: { market: Market }) {
  if (market.kind === "dates") {
    return (
      <div
        className={cn(
          "scrollbar-thin min-h-0 flex-1 overflow-y-auto overscroll-y-contain",
          "touch-pan-y",
        )}
      >
        <CardInner market={market} />
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <CardInner market={market} />
    </div>
  );
}

type MarketCardProps = {
  market: Market;
};

export function MarketCard({ market }: MarketCardProps) {
  const router = useRouter();
  const href = `/markets/${encodeURIComponent(market.id)}`;
  const warmOnce = useRef(false);

  const prefetchAndWarm = () => {
    router.prefetch(href);
    if (warmOnce.current) return;
    warmOnce.current = true;
    if (process.env.NODE_ENV === "development") {
      console.info("[predicted][cache-warm] reconcile_intent", {
        warmSource: "hover",
        slug: market.id,
        ts: Date.now(),
      });
    }
    void fetch("/api/market/volume-reconcile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: market.id, warmSource: "hover" }),
    }).catch(() => {});
  };

  const lifecycle = market.resolution.status;

  return (
    <article className={cn("min-h-0", FEED_TILE_CLASS)}>
      <Link
        href={href}
        onMouseEnter={prefetchAndWarm}
        onFocus={prefetchAndWarm}
        className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl bg-[#111] ring-1 ring-white/[0.05] transition-colors duration-200 hover:bg-[#161616]"
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {lifecycle === "resolving" ? (
            <div className="shrink-0 border-b border-amber-500/15 bg-amber-500/10 px-2.5 py-1.5 sm:px-3">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-100/95">
                Resolving
              </span>
            </div>
          ) : lifecycle === "resolved" ? (
            <div className="shrink-0 border-b border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1.5 sm:px-3">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-100/95">
                Resolved
              </span>
            </div>
          ) : null}
          <CardContentArea market={market} />
          <CardMeta market={market} />
        </div>
      </Link>
    </article>
  );
}

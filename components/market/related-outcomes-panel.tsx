"use client";

import Link from "next/link";
import type { Market } from "@/lib/types/market";
import { cn } from "@/lib/utils/cn";
import {
  eventPagePathForGroupKey,
  outcomeLabelFromMarket,
} from "@/lib/market/group-feed-markets";

export type RelatedEventGroup = {
  title: string;
  groupKey: string;
  markets: Market[];
};

export function RelatedOutcomesPanel({
  currentSlug,
  group,
}: {
  currentSlug: string;
  group: RelatedEventGroup;
}) {
  if (group.markets.length < 2) return null;

  return (
    <div className="rounded-xl bg-[#111] p-4 ring-1 ring-white/[0.06]">
      <h2 className="text-[13px] font-semibold text-white">
        Other outcomes in this event
      </h2>
      <p className="mt-0.5 text-[11px] text-zinc-500">{group.title}</p>
      <ul className="mt-3 space-y-0.5">
        {group.markets.map((m) => {
          const label =
            outcomeLabelFromMarket(m) ??
            m.question.slice(0, 36).trim() +
              (m.question.length > 36 ? "…" : "");
          const active = m.id === currentSlug;
          return (
            <li key={m.id}>
              <Link
                href={`/markets/${encodeURIComponent(m.id)}`}
                className={cn(
                  "block rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition",
                  active
                    ? "bg-white/[0.08] text-white ring-1 ring-emerald-500/25"
                    : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200",
                )}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
      <Link
        href={eventPagePathForGroupKey(group.groupKey)}
        className="mt-3 inline-flex text-[11px] font-medium text-emerald-400/90 hover:text-emerald-300"
      >
        View event hub →
      </Link>
    </div>
  );
}

"use client";

import { useMemo } from "react";
import { Timer } from "lucide-react";
import type { Market } from "@/lib/types/market";

type RaisingPanelProps = {
  market: Market;
};

function fmtUsd(n: number) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function RaisingPanel({ market }: RaisingPanelProps) {
  const raise = market.raise;
  const pct = raise
    ? Math.min(100, (raise.raisedUsd / raise.targetUsd) * 100)
    : 0;

  const ends = useMemo(
    () => (raise ? new Date(raise.endsAt) : null),
    [raise],
  );

  if (!raise) return null;

  return (
    <div className="rounded-xl bg-[#111] p-4 ring-1 ring-white/[0.06]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">
            Seed liquidity
          </h3>
          <p className="mt-1 text-[12px] leading-relaxed text-zinc-400">
            Depositors seed the Omnipair pool. When the target is met, YES/NO
            mints unlock and trading begins.
          </p>
        </div>
        {ends && (
          <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-[11px] text-zinc-300">
            <Timer className="h-3.5 w-3.5 text-amber-200/90" />
            Ends {ends.toLocaleString()}
          </div>
        )}
      </div>
      <div className="mt-5">
        <div className="mb-2 flex justify-between text-[12px] text-zinc-400">
          <span>Progress</span>
          <span className="font-mono text-zinc-200">
            {fmtUsd(raise.raisedUsd)} / {fmtUsd(raise.targetUsd)}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-black/40">
          <div
            className="h-full rounded-full bg-zinc-300 transition-[width] duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-stroke-subtle pt-4 text-[12px]">
        <div>
          <dt className="text-zinc-500">Raise target</dt>
          <dd className="font-mono text-zinc-100">{fmtUsd(raise.targetUsd)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Initial liquidity</dt>
          <dd className="font-mono text-zinc-100">
            {fmtUsd(raise.initialLiquidityUsd)}
          </dd>
        </div>
      </dl>
      <div className="mt-5 rounded-xl bg-[#0f1114] p-4 ring-1 ring-white/[0.06]">
        <label className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          Deposit (USDC)
        </label>
        <div className="mt-2 flex gap-2">
          <input
            defaultValue="50"
            className="w-full rounded-lg bg-[#0f1114] px-3 py-2 text-sm text-white ring-1 ring-white/[0.06] focus:outline-none focus:ring-white/15"
          />
          <button
            type="button"
            className="shrink-0 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#0a0a0c] transition active:scale-[0.98]"
          >
            Deposit
          </button>
        </div>
        <p className="mt-2 text-[11px] text-zinc-500">
          Receive proportional YES/NO seed tokens. On raise completion, create
          Omnipair GAMM pool.
        </p>
      </div>
    </div>
  );
}

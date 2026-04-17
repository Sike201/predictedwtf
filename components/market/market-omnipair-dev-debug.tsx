"use client";

import type { DerivedMarketProbability } from "@/lib/market/derive-market-probability";
import { verifyFiftyFiftyWhenEqualRawReserves } from "@/lib/market/derive-market-probability";
import type { OmnipairPoolChainState } from "@/lib/solana/read-omnipair-pool-state";

type Props = {
  chainSnapshot: OmnipairPoolChainState | null;
  derived: DerivedMarketProbability | null;
  oneSidedLiquidity: boolean;
  loading: boolean;
};

function showDevDebug(): boolean {
  return process.env.NODE_ENV === "development";
}

export function MarketOmnipairDevDebug({
  chainSnapshot,
  derived,
  oneSidedLiquidity,
  loading,
}: Props) {
  if (!showDevDebug()) return null;

  const formulaOk = verifyFiftyFiftyWhenEqualRawReserves();

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-950/25 p-3 font-mono text-[10px] leading-relaxed text-amber-100/90 ring-1 ring-amber-500/15">
      <p className="mb-2 font-sans text-[11px] font-semibold text-amber-200/95">
        Dev · Omnipair pool debug
      </p>
      <p className="text-zinc-500">
        formula 50/50 check (equal raw reserves):{" "}
        <span className={formulaOk ? "text-emerald-400" : "text-red-400"}>
          {formulaOk ? "pass" : "fail"}
        </span>
      </p>
      <p className="mt-1 text-zinc-500">
        loading: {loading ? "yes" : "no"} · one-sided flag:{" "}
        {oneSidedLiquidity ? "yes" : "no"}
      </p>
      <dl className="mt-2 space-y-1 border-t border-white/[0.08] pt-2 text-zinc-400">
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-zinc-600">token0</dt>
          <dd className="break-all">
            {chainSnapshot?.token0Mint ?? "—"}
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-zinc-600">token1</dt>
          <dd className="break-all">
            {chainSnapshot?.token1Mint ?? "—"}
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-zinc-600">reserveYes</dt>
          <dd>{chainSnapshot?.reserveYes?.toString() ?? "—"}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-zinc-600">reserveNo</dt>
          <dd>{chainSnapshot?.reserveNo?.toString() ?? "—"}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-zinc-600">yes price</dt>
          <dd>
            {derived != null ? derived.yesProbability.toFixed(6) : "—"}
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-zinc-600">no price</dt>
          <dd>
            {derived != null ? derived.noProbability.toFixed(6) : "—"}
          </dd>
        </div>
      </dl>
    </div>
  );
}

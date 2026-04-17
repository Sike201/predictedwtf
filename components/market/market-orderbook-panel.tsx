"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  POOL_ACTIVITY_REFRESH_EVENT,
} from "@/lib/market/recent-market-transactions";
import { devnetTxExplorerUrl, shortenTransactionSignature } from "@/lib/utils/solana-explorer";
import { cn } from "@/lib/utils/cn";

type PoolActivityEntry = {
  signature: string;
  blockTimeMs: number;
  label: string;
  summary: string;
};

type MarketOrderbookPanelProps = {
  marketSlug: string;
  yesMidCents: number;
  noMidCents: number;
  /** When RPC pool read failed but market has a pool address. */
  midPriceUnavailable?: boolean;
  /** One reserve vault empty — do not show misleading mids. */
  oneSidedLiquidity?: boolean;
  className?: string;
};

/** Number of recent on-chain rows to fetch and display (newest first). */
const ORDERBOOK_ROWS_SHOWN = 15;

function formatTimeCell(at: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(at));
  } catch {
    return "—";
  }
}

export function MarketOrderbookPanel({
  marketSlug,
  yesMidCents,
  noMidCents,
  midPriceUnavailable = false,
  oneSidedLiquidity = false,
  className,
}: MarketOrderbookPanelProps) {
  const hideMids = midPriceUnavailable || oneSidedLiquidity;
  const spread = hideMids
    ? 0
    : Math.abs(yesMidCents - (100 - yesMidCents));

  const [entries, setEntries] = useState<PoolActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        slug: marketSlug,
        limit: String(ORDERBOOK_ROWS_SHOWN),
      });
      const res = await fetch(`/api/market/pool-activity?${qs.toString()}`, {
        credentials: "same-origin",
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        entries?: PoolActivityEntry[];
      };
      if (!res.ok) {
        setError(data.error ?? "Could not load pool activity");
        setEntries([]);
        return;
      }
      setEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch {
      setError("Network error loading pool activity");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [marketSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const handler = (ev: Event) => {
      const ce = ev as CustomEvent<{ slug?: string }>;
      if (ce.detail?.slug === marketSlug) {
        void load();
      }
    };
    window.addEventListener(POOL_ACTIVITY_REFRESH_EVENT, handler);
    return () => window.removeEventListener(POOL_ACTIVITY_REFRESH_EVENT, handler);
  }, [marketSlug, load]);

  /** API returns at most ORDERBOOK_ROWS_SHOWN entries, newest first. */
  const shown = entries;
  const stats = useMemo(() => {
    const swaps = entries.filter((e) =>
      /^(BUY|SELL) (YES|NO)$/.test(e.label),
    ).length;
    return { swaps, total: entries.length };
  }, [entries]);

  return (
    <div className={cn(className)}>
      {oneSidedLiquidity ? (
        <p className="border-b border-amber-500/20 px-0 py-2 text-[11px] text-amber-200/95">
          One-sided liquidity detected — mids hidden.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 border-b border-white/[0.06] px-0 py-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-emerald-400/90">
            YES
          </p>
          <p
            className="mt-0.5 text-lg font-semibold tabular-nums text-emerald-400"
            title={
              oneSidedLiquidity
                ? "One-sided liquidity detected"
                : midPriceUnavailable
                  ? "Price unavailable"
                  : undefined
            }
          >
            {hideMids ? "—" : `${yesMidCents}¢`}
          </p>
        </div>
        <div className="border-l border-white/[0.06] pl-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-red-400/90">
            NO
          </p>
          <p
            className="mt-0.5 text-lg font-semibold tabular-nums text-red-400"
            title={
              oneSidedLiquidity
                ? "One-sided liquidity detected"
                : midPriceUnavailable
                  ? "Price unavailable"
                  : undefined
            }
          >
            {hideMids ? "—" : `${noMidCents}¢`}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-0 py-2.5">
        <span className="rounded-full border border-white/[0.08] px-2.5 py-0.5 text-[10px] font-medium text-zinc-300">
          Txs: {loading ? "…" : stats.total}
        </span>
        <span className="text-[10px] text-zinc-600">·</span>
        <span className="text-[10px] text-zinc-500">
          Swap txs (in view): {loading ? "…" : stats.swaps}
        </span>
      </div>

      <div className="border-b border-white/[0.06]">
        <div className="grid grid-cols-[minmax(0,0.85fr)_minmax(0,0.75fr)_64px] gap-1 border-b border-white/[0.05] px-0 py-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
          <span>Trade</span>
          <span>Size</span>
          <span className="text-right">Tx</span>
        </div>
        {loading ? (
          <div className="px-0 py-8 text-center text-[12px] text-zinc-600">
            Loading on-chain pool activity…
          </div>
        ) : error ? (
          <div className="px-0 py-8 text-center text-[12px] text-amber-200/90">
            {error}
          </div>
        ) : shown.length === 0 ? (
          <div className="px-0 py-8 text-center text-[12px] text-zinc-600">
            No recent transactions returned for this pair. If the pool is new
            or quiet, activity may be empty.
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.04]">
            {shown.map((row) => (
              <li
                key={row.signature}
                className="grid grid-cols-[minmax(0,0.85fr)_minmax(0,0.75fr)_64px] gap-1 px-0 py-2 text-[11px] leading-snug text-white"
              >
                <div className="min-w-0 font-medium">{row.label}</div>
                <div className="min-w-0 truncate tabular-nums text-white/90" title={row.summary}>
                  {row.summary}
                </div>
                <div className="text-right">
                  <a
                    href={devnetTxExplorerUrl(row.signature)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[10px] text-white underline-offset-2 hover:underline"
                    title={row.signature}
                  >
                    {shortenTransactionSignature(row.signature, 3, 3)}
                  </a>
                  <div className="text-[9px] tabular-nums text-white/50">
                    {formatTimeCell(row.blockTimeMs)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {!loading && shown.length > 0 ? (
          <p className="border-t border-white/[0.04] px-0 py-2 text-center text-[10px] text-zinc-600">
            Latest {ORDERBOOK_ROWS_SHOWN} on-chain transactions (refreshes after your trades
            and on load).
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-4 px-0 py-2.5 text-[12px]">
        <span className="text-zinc-500">
          Mark:{" "}
          <span className="font-semibold tabular-nums text-emerald-400">
            {hideMids ? "—" : `${yesMidCents}¢`}
          </span>
        </span>
        <span className="text-zinc-600">|</span>
        <span className="text-zinc-500">
          Spread:{" "}
          <span className="font-semibold tabular-nums text-zinc-300">
            {spread}¢
          </span>
        </span>
      </div>
    </div>
  );
}

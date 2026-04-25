"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  AccountLayout,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, BarChart3 } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useWallet } from "@/lib/hooks/use-wallet";
import { deriveMarketProbabilityFromPoolState } from "@/lib/market/derive-market-probability";
import { withResolvedBinaryDisplay } from "@/lib/market/resolved-binary-prices";
import { decodeFutarchySwapShareBps } from "@/lib/solana/decode-omnipair-accounts";
import {
  estimateFeeAprFromVolume,
  estimatePoolLiquidityUsdHint,
} from "@/lib/solana/omnipair-liquidity-math";
import { getGlobalFutarchyAuthorityPDA } from "@/lib/solana/omnipair-pda";
import { requireOmnipairProgramId } from "@/lib/solana/omnipair-program";
import { readOmnipairPoolState } from "@/lib/solana/read-omnipair-pool-state";
import type { Market } from "@/lib/types/market";
import { cn } from "@/lib/utils/cn";
import { useMarketNavSearch } from "@/components/providers/market-nav-search-provider";

type EarnViewProps = {
  initialMarkets: Market[];
};

type RowMetric = {
  liquidityUsd: number;
  swapFeeBps: number;
  lpMint: string;
  totalLp: bigint;
  vol24hUsd: number | null;
  apr: number | null;
};

type EarnListSortKey = "liquidity" | "volume" | "apy" | "position";

const LIQUIDITY_ROW_CACHE_TTL_MS = 8_000;
const liquidityRowCache = new Map<
  string,
  { at: number; row: RowMetric }
>();

function getCachedLiquidityRow(slug: string): RowMetric | null {
  const e = liquidityRowCache.get(slug);
  if (!e) return null;
  if (Date.now() - e.at > LIQUIDITY_ROW_CACHE_TTL_MS) {
    liquidityRowCache.delete(slug);
    return null;
  }
  return e.row;
}

function setCachedLiquidityRow(slug: string, row: RowMetric): void {
  liquidityRowCache.set(slug, { at: Date.now(), row });
}

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

function fmtVol(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  return fmtUsd(n);
}

function mergeFeedEnrichOddsOnly(base: Market[], enriched: Market[]): Market[] {
  const map = new Map(enriched.map((m) => [m.id, m]));
  return base.map((row) => {
    const e = map.get(row.id);
    if (!e) return row;
    const volumeUsd =
      typeof row.snapshot?.volumeUsd === "number" &&
      Number.isFinite(row.snapshot.volumeUsd)
        ? Math.max(0, row.snapshot.volumeUsd)
        : 0;
    return withResolvedBinaryDisplay({
      ...e,
      snapshot: {
        liquidityUsd:
          e.snapshot?.liquidityUsd ?? row.snapshot?.liquidityUsd ?? 0,
        volumeUsd,
      },
    });
  });
}

/** Match `MarketFeed` shell */
const feedShell =
  "min-h-full bg-black px-3 pb-24 pt-4 sm:px-4 lg:px-6";
const feedMax = "mx-auto max-w-[1920px]";

/** Recessed well — same system as trading panel `.trade-field` (see `trade-field-well` in globals.css) */
const amountWell = "trade-field-well";

const btnPrimary =
  "inline-flex h-7 shrink-0 items-center justify-center rounded-full bg-zinc-100 px-2.5 text-[11px] font-semibold tracking-tight text-neutral-950 transition-colors hover:bg-white";

const btnWithdraw =
  "inline-flex h-7 shrink-0 items-center justify-center rounded-full bg-white/[0.06] px-2.5 text-[11px] font-medium tracking-tight text-zinc-200 ring-1 ring-inset ring-white/[0.08] transition-colors hover:bg-white/[0.1] hover:ring-white/[0.12]";

const btnGhost =
  "inline-flex h-7 shrink-0 items-center justify-center rounded-full bg-transparent px-2 text-[11px] font-medium tracking-tight text-zinc-400 ring-1 ring-inset ring-white/[0.08] transition-colors hover:bg-white/[0.05] hover:text-zinc-200";

/** Sortable table header — arrow left of label, DeFi table pattern */
function EarnSortTh(props: {
  label: string;
  columnKey: EarnListSortKey;
  sort: { key: EarnListSortKey; dir: "asc" | "desc" };
  onSort: (k: EarnListSortKey) => void;
}) {
  const { label, columnKey, sort, onSort } = props;
  const active = sort.key === columnKey;
  return (
    <button
      type="button"
      onClick={() => onSort(columnKey)}
      className={cn(
        "inline-flex w-full items-center justify-end gap-1 text-[10px] font-medium transition-colors sm:text-[11px]",
        active ? "text-zinc-200" : "text-zinc-500 hover:text-zinc-400",
      )}
    >
      {active ? (
        sort.dir === "asc" ? (
          <ArrowUp className="h-3 w-3 shrink-0 opacity-90" strokeWidth={2} aria-hidden />
        ) : (
          <ArrowDown className="h-3 w-3 shrink-0 opacity-90" strokeWidth={2} aria-hidden />
        )
      ) : (
        <ArrowUpDown className="h-3 w-3 shrink-0 opacity-35" strokeWidth={2} aria-hidden />
      )}
      <span>{label}</span>
    </button>
  );
}

const earnApyPill =
  "inline-flex items-center justify-end gap-1.5 rounded-full border border-white/[0.1] bg-black/40 px-2.5 py-1 tabular-nums";

/** Align header row with desktop pool rows */
const earnPoolGridStyle: CSSProperties = {
  gridTemplateColumns:
    "minmax(200px, 1.55fr) minmax(92px, 0.75fr) minmax(96px, 0.8fr) minmax(88px, 0.7fr) minmax(108px, 0.85fr) minmax(240px, 1.1fr)",
};

export function EarnView({ initialMarkets }: EarnViewProps) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [markets, setMarkets] = useState(initialMarkets);
  const [metricsBySlug, setMetricsBySlug] = useState<
    Record<string, RowMetric | undefined>
  >({});
  /** Swap-volume / APR fetches; liquidity rows are independent. */
  const [swapVolumeLoading, setSwapVolumeLoading] = useState(true);
  /** Markets with failed pool/liquidity resolution (skipped in aggregation). */
  const [failedPoolSlugs, setFailedPoolSlugs] = useState<Set<string>>(
    () => new Set(),
  );
  /** `done` increases as each market finishes pool+mint fetch (incl. cache). */
  const [liquidityLoadState, setLiquidityLoadState] = useState<{
    done: number;
    total: number;
  }>({ done: 0, total: 0 });
  const [userLpBySlug, setUserLpBySlug] = useState<
    Record<string, { atoms: bigint } | undefined>
  >({});
  const [lpLoading, setLpLoading] = useState(false);
  const { query: navSearchQuery } = useMarketNavSearch();
  const [listSort, setListSort] = useState<{
    key: EarnListSortKey;
    dir: "asc" | "desc";
  }>({ key: "liquidity", dir: "desc" });

  const feedKey = useMemo(
    () => initialMarkets.map((m) => m.id).join("\0"),
    [initialMarkets],
  );

  const poolMarkets = useMemo(
    () => markets.filter((m) => m.pool?.poolId && m.pool.yesMint && m.pool.noMint),
    [markets],
  );

  useEffect(() => {
    setMarkets(initialMarkets);
  }, [initialMarkets, feedKey]);

  useEffect(() => {
    let cancelled = false;
    const slugs = feedKey.split("\0").filter((s) => s.length > 0);
    if (slugs.length === 0) return;

    void fetch("/api/markets/feed-enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slugs }),
    })
      .then((r) => r.json())
      .then((j: { markets?: Market[] }) => {
        if (cancelled) return;
        const next = j.markets;
        if (!Array.isArray(next)) return;
        setMarkets((prev) => mergeFeedEnrichOddsOnly(prev, next));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [feedKey]);

  useEffect(() => {
    let cancelled = false;
    if (poolMarkets.length === 0) {
      setMetricsBySlug({});
      setSwapVolumeLoading(false);
      setFailedPoolSlugs(new Set());
      setLiquidityLoadState({ done: 0, total: 0 });
      return;
    }

    setFailedPoolSlugs(new Set());
    setSwapVolumeLoading(true);

    const partial: Record<string, RowMetric> = {};
    const fromCache: Record<string, RowMetric> = {};
    for (const m of poolMarkets) {
      const c = getCachedLiquidityRow(m.id);
      if (c) {
        fromCache[m.id] = c;
        partial[m.id] = c;
      }
    }
    const doneFromCache = Object.keys(fromCache).length;
    if (doneFromCache > 0) {
      setMetricsBySlug((prev) => ({ ...prev, ...fromCache }));
    } else {
      setMetricsBySlug((prev) => {
        const next = { ...prev };
        for (const m of poolMarkets) {
          delete next[m.id];
        }
        return next;
      });
    }
    setLiquidityLoadState({ done: doneFromCache, total: poolMarkets.length });

    const needPoolFetch = poolMarkets.filter((m) => !fromCache[m.id]);

    void (async () => {
      let futarchyShareBps = 0;
      try {
        const programId = requireOmnipairProgramId();
        const [futarchyPk] = getGlobalFutarchyAuthorityPDA(programId);
        const fa = await connection.getAccountInfo(futarchyPk, "confirmed");
        if (fa?.data) {
          futarchyShareBps = decodeFutarchySwapShareBps(fa.data);
        }
      } catch {
        futarchyShareBps = 0;
      }

      await Promise.all(
        needPoolFetch.map(async (m) => {
          if (!m.pool) return;
          try {
            if (cancelled) return;
            const pair = new PublicKey(m.pool.poolId);
            const yes = new PublicKey(m.pool.yesMint);
            const no = new PublicKey(m.pool.noMint);
            const state = await readOmnipairPoolState(connection, {
              pairAddress: pair,
              yesMint: yes,
              noMint: no,
            });
            const derived = deriveMarketProbabilityFromPoolState(state);
            const pYes =
              derived?.yesProbability ??
              (Number.isFinite(m.yesProbability) ? m.yesProbability : 0.5);
            const liquidityUsd = estimatePoolLiquidityUsdHint({
              reserveYesAtoms: state.reserveYes,
              reserveNoAtoms: state.reserveNo,
              yesProbability: pYes,
            });

            const lpPk = new PublicKey(state.lpMint);
            const mint = await getMint(connection, lpPk, "confirmed");
            const totalLp = mint.supply;

            if (cancelled) return;
            const row: RowMetric = {
              liquidityUsd,
              swapFeeBps: state.swapFeeBps,
              lpMint: state.lpMint,
              totalLp,
              vol24hUsd: null,
              apr: null,
            };
            partial[m.id] = row;
            setCachedLiquidityRow(m.id, row);
            setMetricsBySlug((prev) => ({ ...prev, [m.id]: row }));
          } catch {
            if (cancelled) return;
            setFailedPoolSlugs((s) => new Set(s).add(m.id));
          } finally {
            if (cancelled) return;
            setLiquidityLoadState((ls) => ({
              ...ls,
              done: Math.min(ls.total, ls.done + 1),
            }));
          }
        }),
      );

      if (cancelled) return;

      await Promise.all(
        poolMarkets.map(async (m) => {
          if (cancelled || !m.pool) return;
          const base = partial[m.id];
          if (!base) return;
          try {
            const qs = new URLSearchParams({
              poolId: m.pool.poolId,
              yesMint: m.pool.yesMint,
              noMint: m.pool.noMint,
              window: "24h",
            });
            const res = await fetch(`/api/market/swap-volume?${qs.toString()}`);
            const j = (await res.json().catch(() => ({}))) as {
              volumeUsd?: number;
            };
            const vol24hUsd =
              typeof j.volumeUsd === "number" && Number.isFinite(j.volumeUsd)
                ? Math.max(0, j.volumeUsd)
                : 0;

            const apr = estimateFeeAprFromVolume({
              volume24hUsd: vol24hUsd,
              liquidityUsd: base.liquidityUsd,
              swapFeeBps: base.swapFeeBps,
              futarchySwapShareBps: futarchyShareBps,
            });

            if (cancelled) return;
            const next: RowMetric = { ...base, vol24hUsd, apr };
            partial[m.id] = next;
            setCachedLiquidityRow(m.id, next);
            setMetricsBySlug((prev) => ({ ...prev, [m.id]: next }));
          } catch {
            if (cancelled) return;
            const next: RowMetric = { ...base, vol24hUsd: 0, apr: null };
            partial[m.id] = next;
            setMetricsBySlug((prev) => ({ ...prev, [m.id]: next }));
          }
        }),
      );

      if (cancelled) return;
      setSwapVolumeLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [connection, poolMarkets]);

  const refreshUserLp = useCallback(async () => {
    if (!publicKey || poolMarkets.length === 0) {
      setUserLpBySlug({});
      return;
    }

    const withMint = poolMarkets
      .map((m) => {
        const met = metricsBySlug[m.id];
        if (!met?.lpMint) return null;
        return { slug: m.id, lpMint: new PublicKey(met.lpMint) };
      })
      .filter(Boolean) as { slug: string; lpMint: PublicKey }[];

    if (withMint.length === 0) {
      setUserLpBySlug({});
      return;
    }

    setLpLoading(true);
    try {
      const atas = withMint.map(({ slug, lpMint }) => ({
        slug,
        ata: getAssociatedTokenAddressSync(
          lpMint,
          publicKey,
          false,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
      }));

      const out: Record<string, { atoms: bigint } | undefined> = {};
      const chunkSize = 90;
      for (let i = 0; i < atas.length; i += chunkSize) {
        const part = atas.slice(i, i + chunkSize);
        const infos = await connection.getMultipleAccountsInfo(
          part.map((p) => p.ata),
          "confirmed",
        );
        for (let j = 0; j < part.length; j++) {
          const info = infos[j];
          let atoms = 0n;
          if (info?.data && info.data.length >= AccountLayout.span) {
            atoms = AccountLayout.decode(info.data).amount;
          }
          out[part[j]!.slug] = { atoms };
        }
      }
      setUserLpBySlug(out);
    } catch {
      setUserLpBySlug({});
    } finally {
      setLpLoading(false);
    }
  }, [connection, metricsBySlug, poolMarkets, publicKey]);

  useEffect(() => {
    void refreshUserLp();
  }, [refreshUserLp]);

  const filteredPoolMarkets = useMemo(() => {
    const q = navSearchQuery.trim().toLowerCase();
    if (!q) return poolMarkets;
    return poolMarkets.filter((m) => m.question.toLowerCase().includes(q));
  }, [poolMarkets, navSearchQuery]);

  const positionValueUsd = useCallback(
    (m: Market): number | null => {
      const met = metricsBySlug[m.id];
      const u = userLpBySlug[m.id]?.atoms;
      if (
        !met ||
        u == null ||
        u <= 0n ||
        met.totalLp <= 0n ||
        !Number.isFinite(met.liquidityUsd)
      ) {
        return null;
      }
      const share = Number(u) / Number(met.totalLp);
      if (!Number.isFinite(share)) return null;
      const v = share * met.liquidityUsd;
      return Number.isFinite(v) ? v : null;
    },
    [metricsBySlug, userLpBySlug],
  );

  const displayPoolMarkets = useMemo(() => {
    const { key, dir } = listSort;
    const mult = dir === "asc" ? 1 : -1;

    const liquidityVal = (m: Market) => metricsBySlug[m.id]?.liquidityUsd ?? 0;

    const volumeVal = (m: Market) => {
      const v = m.snapshot?.volumeUsd;
      return typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 0;
    };

    const apyVal = (m: Market) => {
      const a = metricsBySlug[m.id]?.apr;
      return a != null && Number.isFinite(a) ? a : null;
    };

    const sortable = (a: number | null, b: number | null): number => {
      const aMissing = a == null || !Number.isFinite(a);
      const bMissing = b == null || !Number.isFinite(b);
      if (aMissing && bMissing) return 0;
      if (aMissing) return 1;
      if (bMissing) return -1;
      return mult * (a - b);
    };

    return [...filteredPoolMarkets].sort((ma, mb) => {
      switch (key) {
        case "liquidity":
          return sortable(liquidityVal(ma), liquidityVal(mb));
        case "volume":
          return sortable(volumeVal(ma), volumeVal(mb));
        case "apy":
          return sortable(apyVal(ma), apyVal(mb));
        case "position":
          return sortable(positionValueUsd(ma), positionValueUsd(mb));
        default:
          return 0;
      }
    });
  }, [
    filteredPoolMarkets,
    listSort,
    metricsBySlug,
    positionValueUsd,
  ]);

  const toggleListSort = useCallback((key: EarnListSortKey) => {
    setListSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "desc" },
    );
  }, []);

  const totalLiquidityUsd = useMemo(() => {
    let s = 0;
    for (const m of poolMarkets) {
      const v = metricsBySlug[m.id]?.liquidityUsd;
      if (typeof v === "number" && Number.isFinite(v)) s += v;
    }
    return s;
  }, [poolMarkets, metricsBySlug]);

  const totalLiquidityLoadPending = useMemo(
    () =>
      poolMarkets.length > 0 &&
      liquidityLoadState.done < liquidityLoadState.total,
    [poolMarkets.length, liquidityLoadState.done, liquidityLoadState.total],
  );

  const totalHasNoProgressYet = useMemo(
    () => poolMarkets.length > 0 && liquidityLoadState.done === 0,
    [poolMarkets.length, liquidityLoadState.done],
  );

  const totalLiquidityStatNode: ReactNode = useMemo(() => {
    if (poolMarkets.length === 0) {
      return "—";
    }
    return (
      <span className="inline-flex max-w-full flex-col items-end gap-0.5 sm:items-end">
        <span
          className={cn(
            "inline-block",
            totalLiquidityLoadPending && "animate-pulse",
          )}
        >
          {totalHasNoProgressYet
            ? fmtUsd(0)
            : fmtUsd(totalLiquidityUsd)}
        </span>
        {totalLiquidityLoadPending ? (
          <span className="text-[10px] font-medium leading-tight text-zinc-500">
            Updating…
          </span>
        ) : null}
      </span>
    );
  }, [
    poolMarkets.length,
    totalHasNoProgressYet,
    totalLiquidityLoadPending,
    totalLiquidityUsd,
  ]);

  const yourPositionCount = useMemo(() => {
    let n = 0;
    for (const m of poolMarkets) {
      const u = userLpBySlug[m.id]?.atoms;
      if (u != null && u > 0n) n += 1;
    }
    return n;
  }, [poolMarkets, userLpBySlug]);

  const statItems: {
    label: string;
    value: ReactNode;
  }[] = [
    {
      label: "Total Liquidity Provided",
      value: totalLiquidityStatNode,
    },
    {
      label: "Total Fees Earned",
      value: "—",
    },
    {
      label: "Active Markets",
      value: String(poolMarkets.length),
    },
    {
      label: "Your Positions",
      value: !publicKey ? "—" : lpLoading ? "…" : String(yourPositionCount),
    },
  ];

  return (
    <div className={feedShell}>
      <div className={feedMax}>
        <header className="mb-4">
          <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
            Earn
          </h1>
        </header>

        <section
          className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4"
          aria-label="Earn overview"
        >
          {statItems.map((s) => (
            <div
              key={s.label}
              className={cn(amountWell, "flex flex-col px-4 py-3.5 sm:px-5 sm:py-4")}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 max-w-[58%] text-left text-[11px] font-medium leading-snug text-zinc-500">
                  {s.label}
                </span>
                <span className="shrink-0 text-right text-xl font-semibold tabular-nums tracking-tight text-white sm:text-2xl">
                  {s.value}
                </span>
              </div>
            </div>
          ))}
        </section>

        <section className="mb-4">
          <div className="flex flex-col gap-2">
            {poolMarkets.length === 0 ? (
              <div
                className={cn(
                  amountWell,
                  "px-4 py-8 text-center text-[13px] text-zinc-500",
                )}
              >
                No live pools yet. Markets with seeded Omnipair liquidity will
                appear here.
              </div>
            ) : filteredPoolMarkets.length === 0 ? (
              <div
                className={cn(
                  amountWell,
                  "px-4 py-8 text-center text-[13px] text-zinc-500",
                )}
              >
                No markets match your search.
              </div>
            ) : (
              <>
                <div className={cn(amountWell, "p-0")}>
                  <div className="overflow-x-auto">
                    <div
                      className="grid min-w-[820px] items-center gap-x-3 px-3 py-2 sm:gap-x-4 sm:px-4"
                      style={earnPoolGridStyle}
                    >
                      <div className="text-left text-[10px] font-medium text-zinc-500 sm:text-[11px]">
                        Market
                      </div>
                      <div className="min-w-0">
                        <EarnSortTh
                          label="APY"
                          columnKey="apy"
                          sort={listSort}
                          onSort={toggleListSort}
                        />
                      </div>
                      <div className="min-w-0">
                        <EarnSortTh
                          label="Liquidity"
                          columnKey="liquidity"
                          sort={listSort}
                          onSort={toggleListSort}
                        />
                      </div>
                      <div className="min-w-0">
                        <EarnSortTh
                          label="Volume"
                          columnKey="volume"
                          sort={listSort}
                          onSort={toggleListSort}
                        />
                      </div>
                      <div className="min-w-0">
                        <EarnSortTh
                          label="Your position"
                          columnKey="position"
                          sort={listSort}
                          onSort={toggleListSort}
                        />
                      </div>
                      <div className="sr-only">Actions</div>
                    </div>
                  </div>
                </div>

                {displayPoolMarkets.map((m) => {
                  const met = metricsBySlug[m.id];
                  const poolRowFailed = failedPoolSlugs.has(m.id);
                  const vol =
                    typeof m.snapshot?.volumeUsd === "number" &&
                    Number.isFinite(m.snapshot.volumeUsd)
                      ? m.snapshot.volumeUsd
                      : 0;
                  const u = userLpBySlug[m.id]?.atoms;
                  const sharePct =
                    u != null &&
                    met &&
                    met.totalLp > 0n &&
                    u > 0n &&
                    Number.isFinite(Number(u) / Number(met.totalLp))
                      ? (Number(u) / Number(met.totalLp)) * 100
                      : null;
                  const posUsd = positionValueUsd(m);

                  const apyCell =
                    met != null && met.apr != null && Number.isFinite(met.apr) ? (
                      <span
                        className={cn(
                          earnApyPill,
                          "py-0.5 text-[12px] font-semibold text-white",
                        )}
                      >
                        <span>{fmtPct(met.apr)}</span>
                        <BarChart3
                          className="h-3 w-3 shrink-0 text-emerald-400/90"
                          aria-hidden
                        />
                      </span>
                    ) : !met && !poolRowFailed ? (
                      <span className="text-zinc-500">…</span>
                    ) : !met && poolRowFailed ? (
                      <span className="text-zinc-600">—</span>
                    ) : swapVolumeLoading ? (
                      <span className="text-zinc-500">…</span>
                    ) : (
                      <span className="text-zinc-600">—</span>
                    );

                  const liquidityCell = (
                    <span className="inline-flex items-center justify-end gap-1 text-[12px] font-semibold tabular-nums text-white">
                      {met == null && !poolRowFailed ? (
                        <span className="text-zinc-500">…</span>
                      ) : met == null && poolRowFailed ? (
                        <span className="font-medium text-zinc-600">—</span>
                      ) : met != null ? (
                        <>
                          {fmtUsd(met.liquidityUsd)}
                          <BarChart3
                            className="h-3 w-3 shrink-0 text-emerald-400/90"
                            aria-hidden
                          />
                        </>
                      ) : (
                        <span className="text-zinc-500">…</span>
                      )}
                    </span>
                  );

                  const positionCell = !publicKey ? (
                    <span className="text-[12px] font-medium text-zinc-600">
                      —
                    </span>
                  ) : lpLoading ? (
                    <span className="text-[12px] text-zinc-500">…</span>
                  ) : posUsd != null && posUsd > 0 ? (
                    <span className="inline-flex items-center justify-end gap-1 text-[12px] font-semibold tabular-nums text-white">
                      {fmtUsd(posUsd)}
                      <BarChart3
                        className="h-3 w-3 shrink-0 text-emerald-400/90"
                        aria-hidden
                      />
                    </span>
                  ) : sharePct != null ? (
                    <span className="text-[12px] font-semibold tabular-nums text-white">
                      {sharePct.toFixed(2)}%
                    </span>
                  ) : (
                    <span className="text-[12px] font-medium text-zinc-600">
                      —
                    </span>
                  );

                  const metricLbl =
                    "text-[9px] font-medium uppercase tracking-[0.1em] text-zinc-500";

                  return (
                    <article
                      key={m.id}
                      className={cn(amountWell, "px-3 py-2.5 sm:px-4 sm:py-3")}
                    >
                      <div className="flex flex-col gap-2 lg:hidden">
                        <div className="flex items-center gap-2 sm:gap-2.5">
                          <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-md bg-black/30">
                            <Image
                              src={m.imageUrl}
                              alt=""
                              fill
                              className="object-cover"
                              sizes="32px"
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <Link
                              href={`/markets/${encodeURIComponent(m.id)}/earn`}
                              className="line-clamp-2 text-left text-[12px] font-medium leading-snug text-white sm:text-[13px]"
                            >
                              {m.question}
                            </Link>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1">
                              {met ? (
                                <span className="rounded bg-white/[0.07] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-zinc-400">
                                  {(met.swapFeeBps / 100).toFixed(2)}% fee
                                </span>
                              ) : !poolRowFailed ? (
                                <span className="text-[10px] text-zinc-600">
                                  …
                                </span>
                              ) : null}
                              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400/95">
                                Active
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-x-2 gap-y-2">
                          <div className="min-w-0 text-right">
                            <p className={metricLbl}>APY</p>
                            <div className="mt-1 flex justify-end">{apyCell}</div>
                          </div>
                          <div className="min-w-0 text-right">
                            <p className={metricLbl}>Liquidity</p>
                            <div className="mt-1 flex justify-end">
                              {liquidityCell}
                            </div>
                          </div>
                          <div className="min-w-0 text-right">
                            <p className={metricLbl}>Volume</p>
                            <div className="mt-1 text-[12px] font-semibold tabular-nums text-white">
                              {fmtVol(vol)}
                            </div>
                          </div>
                          <div className="min-w-0 text-right">
                            <p className={metricLbl}>Your position</p>
                            <div className="mt-1 flex justify-end">
                              {positionCell}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1">
                          <Link
                            href={`/markets/${encodeURIComponent(m.id)}/earn`}
                            className={btnPrimary}
                            aria-label="Add liquidity"
                          >
                            Add
                          </Link>
                          <Link
                            href={`/markets/${encodeURIComponent(m.id)}/earn`}
                            className={btnWithdraw}
                          >
                            Withdraw
                          </Link>
                          <button
                            type="button"
                            title="Fees stay in the pool and increase LP value. Withdraw to realize."
                            className={btnGhost}
                          >
                            Claim
                          </button>
                        </div>
                      </div>

                      <div className="hidden overflow-x-auto lg:block">
                        <div
                          className="grid min-w-[820px] items-center gap-x-3 sm:gap-x-4"
                          style={earnPoolGridStyle}
                        >
                          <div className="max-w-[min(420px,36vw)] min-w-0">
                            <div className="flex items-center gap-2 sm:gap-2.5">
                              <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-md bg-black/30">
                                <Image
                                  src={m.imageUrl}
                                  alt=""
                                  fill
                                  className="object-cover"
                                  sizes="32px"
                                />
                              </div>
                              <div className="min-w-0 flex-1">
                                <Link
                                  href={`/markets/${encodeURIComponent(m.id)}/earn`}
                                  className="line-clamp-2 text-left text-[12px] font-medium leading-snug text-white sm:text-[13px]"
                                >
                                  {m.question}
                                </Link>
                                <div className="mt-0.5 flex flex-wrap items-center gap-1">
                                  {met ? (
                                    <span className="rounded bg-white/[0.07] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-zinc-400">
                                      {(met.swapFeeBps / 100).toFixed(2)}% fee
                                    </span>
                                  ) : !poolRowFailed ? (
                                    <span className="text-[10px] text-zinc-600">
                                      …
                                    </span>
                                  ) : null}
                                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400/95">
                                    Active
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className="text-right tabular-nums">{apyCell}</div>
                          <div className="text-right">{liquidityCell}</div>
                          <div className="text-right text-[12px] font-semibold tabular-nums text-white">
                            {fmtVol(vol)}
                          </div>
                          <div className="text-right">{positionCell}</div>
                          <div className="flex flex-wrap items-center justify-end gap-1">
                            <Link
                              href={`/markets/${encodeURIComponent(m.id)}/earn`}
                              className={btnPrimary}
                              aria-label="Add liquidity"
                            >
                              Add
                            </Link>
                            <Link
                              href={`/markets/${encodeURIComponent(m.id)}/earn`}
                              className={btnWithdraw}
                            >
                              Withdraw
                            </Link>
                            <button
                              type="button"
                              title="Fees stay in the pool and increase LP value. Withdraw to realize."
                              className={btnGhost}
                            >
                              Claim
                            </button>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

"use client";

import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { lazy, Suspense, useEffect, useRef } from "react";
import type { Market } from "@/lib/types/market";
import { useLiveOmnipairPool } from "@/lib/hooks/use-live-omnipair-pool";
import { useMarketPriceHistory } from "@/lib/hooks/use-market-price-history";
import { useOmnipairUserPosition } from "@/lib/hooks/use-omnipair-user-position";
import { useWallet } from "@/lib/hooks/use-wallet";
import { MarketDetailHeader } from "@/components/market/market-detail-header";
import { TradingPanel } from "@/components/market/trading-panel";
import { DateTradingPanel } from "@/components/market/date-trading-panel";
import { RaisingPanel } from "@/components/market/raising-panel";
import { YourPositionPanel } from "@/components/market/your-position-panel";

const MarketChartBlock = lazy(() =>
  import("@/components/market/market-chart-block").then((m) => ({
    default: m.MarketChartBlock,
  })),
);

const MarketDetailTabs = lazy(() =>
  import("@/components/market/market-detail-tabs").then((m) => ({
    default: m.MarketDetailTabs,
  })),
);

const aboutPanel = "rounded-xl bg-[#111] p-4 ring-1 ring-white/[0.06]";

function ChartBlockSkeleton() {
  return (
    <div className="min-h-[300px] animate-pulse rounded-xl bg-white/[0.04] ring-1 ring-white/[0.06]" />
  );
}

function TabsSkeleton() {
  return (
    <div className="min-h-[220px] animate-pulse rounded-xl bg-white/[0.04] ring-1 ring-white/[0.06]" />
  );
}

type MarketDetailViewProps = {
  market: Market;
  /** RSC-fetched chart points — instant first paint without client history fetch. */
  initialChartHistory?: { t: number; p: number }[];
  /** `Date.now()` when `initialChartHistory` was read on the server. */
  chartHistoryServerFetchedAtMs?: number;
};

export function MarketDetailView({
  market,
  initialChartHistory,
  chartHistoryServerFetchedAtMs,
}: MarketDetailViewProps) {
  const router = useRouter();
  const isBinary = market.kind === "binary";
  const livePool = useLiveOmnipairPool(market);
  /** `market.id` is `markets.slug` — must match GET/POST `/api/market/price-history?slug=` / body.slug. */
  const priceHistory = useMarketPriceHistory({
    slug: market.id,
    initialSeries: initialChartHistory,
    chartHistoryServerFetchedAtMs,
  });
  const mountT = useRef(0);
  const poolReadyLogged = useRef(false);

  const { publicKey, connected } = useWallet();
  const omnipairHook = useOmnipairUserPosition(market, publicKey, connected);
  const tradingBinary = market.phase === "trading" && isBinary;

  useEffect(() => {
    mountT.current = performance.now();
    poolReadyLogged.current = false;
  }, [market.id]);

  /** Background volume reconcile — fire-and-forget after first render.
   *  Does NOT block visible volume (header reads DB cache instantly).
   *  TTL on server skips if already reconciled recently. */
  useEffect(() => {
    if (!market.pool?.poolId) return;
    const slug = market.id;
    if (process.env.NODE_ENV === "development") {
      console.info("[predicted][cache-warm] reconcile_intent", {
        warmSource: "detail",
        slug,
        ts: Date.now(),
      });
    }
    void fetch("/api/market/volume-reconcile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, warmSource: "detail" }),
    })
      .then((r) => r.json())
      .then((j: unknown) => {
        if (process.env.NODE_ENV === "development") {
          console.info("[predicted][cache-warm] detail_reconcile_response", {
            slug,
            ts: Date.now(),
            result: j,
          });
        }
      })
      .catch((e: unknown) => {
        if (process.env.NODE_ENV === "development") {
          console.warn("[predicted][volume-cache] detail_bg_reconcile_error", {
            slug,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      });
  }, [market.id, market.pool?.poolId]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    if (poolReadyLogged.current) return;
    if (
      !livePool.loading &&
      (livePool.unavailable || livePool.yesProbability != null)
    ) {
      poolReadyLogged.current = true;
      console.info("[predicted][market-detail-pool-ready]", {
        marketId: market.id,
        msSinceMount: Math.round(performance.now() - mountT.current),
      });
    }
  }, [
    livePool.loading,
    livePool.unavailable,
    livePool.yesProbability,
    market.id,
  ]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const snap = livePool.chainSnapshot;
    const staticYes = market.pool?.yesPrice ?? market.yesProbability;
    console.info(
      "[predicted][market-detail-pool]",
      JSON.stringify({
        marketId: market.id,
        poolAddress: market.pool?.poolId ?? null,
        phase: market.phase,
        tradingBinary,
        reserveYes: snap?.reserveYes?.toString() ?? null,
        reserveNo: snap?.reserveNo?.toString() ?? null,
        computedYesPrice: livePool.derivedSnapshot?.yesProbability ?? null,
        computedNoPrice: livePool.derivedSnapshot?.noProbability ?? null,
        displayedLiveYes: livePool.yesProbability,
        unavailable: livePool.unavailable,
        oneSidedLiquidity: livePool.oneSidedLiquidity,
        refreshEpoch: livePool.refreshEpoch,
        staticYesFromMarketRecord: staticYes,
        usingApproxFiftyFiftyStatic:
          !tradingBinary || livePool.unavailable || livePool.yesProbability == null
            ? Math.abs(staticYes - 0.5) < 1e-6
            : false,
      }),
    );
  }, [
    livePool.chainSnapshot,
    livePool.derivedSnapshot?.noProbability,
    livePool.derivedSnapshot?.yesProbability,
    livePool.loading,
    livePool.noProbability,
    livePool.oneSidedLiquidity,
    livePool.refreshEpoch,
    livePool.unavailable,
    livePool.yesProbability,
    market.id,
    market.phase,
    market.pool?.poolId,
    market.pool?.yesPrice,
    market.yesProbability,
    tradingBinary,
  ]);

  return (
    <div className="min-h-screen bg-black pb-24 pt-4 text-zinc-100 sm:pt-5">
      <div className="mx-auto max-w-[1600px] px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.48, ease: [0.16, 1, 0.3, 1] }}
        >
          <MarketDetailHeader
            market={market}
            liveYesProbability={
              tradingBinary ? livePool.yesProbability : undefined
            }
          />
        </motion.div>

        <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)] lg:items-start lg:gap-6">
          <motion.div
            className="space-y-5"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.58, ease: [0.16, 1, 0.3, 1] }}
          >
            <Suspense fallback={<ChartBlockSkeleton />}>
              <MarketChartBlock
                market={market}
                tradingBinary={tradingBinary}
                livePool={livePool}
                priceHistory={priceHistory}
              />
            </Suspense>

            {tradingBinary ? (
              <YourPositionPanel
                market={market}
                snapshot={omnipairHook.snapshot}
                loading={omnipairHook.loading}
                error={omnipairHook.error}
                onPositionTxSettled={(d) => {
                  void omnipairHook.refresh();
                  void livePool.refresh("after_position_tx");
                  if (d?.signature) {
                    if (process.env.NODE_ENV === "development") {
                      console.info(
                        "[predicted][volume-verify] recordAfterTrade_path",
                        {
                          path: "close_position",
                          slug: market.id,
                          signature: d.signature,
                        },
                      );
                    }
                    void priceHistory
                      .recordAfterTrade(d.signature)
                      .finally(() => {
                        router.refresh();
                      });
                  } else {
                    if (process.env.NODE_ENV === "development") {
                      console.warn(
                        "[predicted][volume-verify] recordAfterTrade_skipped_no_signature",
                        { path: "close_position", slug: market.id },
                      );
                    }
                    void Promise.resolve(priceHistory.refetch()).finally(() =>
                      router.refresh(),
                    );
                  }
                }}
              />
            ) : null}

            <div className={aboutPanel}>
              <h2 className="text-[13px] font-semibold text-white">About</h2>
              <p className="mt-1.5 text-[12px] leading-relaxed text-zinc-400">
                {market.description}
              </p>
            </div>

            <Suspense fallback={<TabsSkeleton />}>
              <MarketDetailTabs market={market} />
            </Suspense>
          </motion.div>

          <motion.aside
            className="relative z-10 space-y-4 lg:sticky lg:top-20"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.58,
              delay: 0.06,
              ease: [0.16, 1, 0.3, 1],
            }}
          >
            {market.phase === "raising" && <RaisingPanel market={market} />}
            {market.phase === "trading" &&
              (isBinary ? (
                <>
                  <TradingPanel
                    market={market}
                    {...(tradingBinary
                      ? {
                          liveYesProbability: livePool.yesProbability,
                          liveNoProbability: livePool.noProbability,
                          livePriceUnavailable: livePool.unavailable,
                          oneSidedLiquidity: livePool.oneSidedLiquidity,
                          onPoolTxSettled: () =>
                            void livePool.refresh("after_trade"),
                          onOmnipairRefresh: omnipairHook.refresh,
                          onTradePriceSnapshot: (sig) =>
                            priceHistory.recordAfterTrade(sig),
                          omnipairSnapshot: omnipairHook.snapshot,
                          onLeverageAfterTx: async (detail) => {
                            await omnipairHook.refreshAsync();
                            void livePool.refresh("after_trade");
                            const sig = detail?.signature;
                            if (sig) {
                              if (process.env.NODE_ENV === "development") {
                                console.info(
                                  "[predicted][volume-verify] recordAfterTrade_path",
                                  {
                                    path: "leverage",
                                    slug: market.id,
                                    signature: sig,
                                  },
                                );
                              }
                              await priceHistory.recordAfterTrade(sig);
                            } else {
                              if (process.env.NODE_ENV === "development") {
                                console.warn(
                                  "[predicted][volume-verify] recordAfterTrade_skipped_no_signature",
                                  { path: "leverage", slug: market.id },
                                );
                              }
                              await priceHistory.refetch();
                            }
                            router.refresh();
                          },
                        }
                      : {})}
                  />
                </>
              ) : (
                <DateTradingPanel market={market} />
              ))}
            {market.phase === "resolved" && (
              <div className={aboutPanel}>
                <h3 className="text-sm font-semibold text-white">Settled</h3>
                <p className="mt-2 text-[13px] text-zinc-400">
                  Winning side:{" "}
                  <span className="font-medium text-zinc-100">
                    {market.resolution.resolvedOutcome ?? "—"}
                  </span>
                </p>
              </div>
            )}
          </motion.aside>
        </div>
      </div>
    </div>
  );
}

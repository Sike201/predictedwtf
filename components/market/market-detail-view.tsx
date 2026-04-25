"use client";

import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getEffectiveDetailTrading,
  logMarketTraceClient,
  logUiStateTraceClient,
} from "@/lib/market/detail-trading-surface";
import { runPostTradeRefreshSequence } from "@/lib/market/post-trade-router-refresh";
import type { Market } from "@/lib/types/market";
import {
  DETAIL_DERIVED_VOLUME_SOURCE,
  logDetailDerivedVolume,
  useDetailDerivedVolume,
} from "@/lib/hooks/use-detail-derived-volume";
import { useLiveOmnipairPool } from "@/lib/hooks/use-live-omnipair-pool";
import { useMarketPriceHistory } from "@/lib/hooks/use-market-price-history";
import { useOmnipairUserPosition } from "@/lib/hooks/use-omnipair-user-position";
import { useWallet } from "@/lib/hooks/use-wallet";
import { OUTCOME_MINT_DECIMALS } from "@/lib/solana/create-outcome-mints";
import { MarketDetailHeader } from "@/components/market/market-detail-header";
import { MarketActionsCard } from "@/components/market/market-actions-card";
import { DateTradingPanel } from "@/components/market/date-trading-panel";
import { RaisingPanel } from "@/components/market/raising-panel";
import { MarketResolverPanel } from "@/components/market/market-resolver-panel";
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

/** Outcome (YES/NO) human units: hide position UI when all legs are sub-dust. */
const POSITION_DUST_HUMAN = 0.001;
const POSITION_DUST_LOG = "[predicted][position-dust-hide]";

function outcomeAtomsToHuman(atoms: string): number {
  return Number(BigInt(atoms || "0")) / 10 ** OUTCOME_MINT_DECIMALS;
}

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
  const [timeTick, setTimeTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      setTimeTick((n) => n + 1);
    }, 25_000);
    return () => window.clearInterval(id);
  }, []);
  const tr = useMemo(
    () => getEffectiveDetailTrading(market, Date.now()),
    [market, timeTick],
  );
  /** Avoid new object identity on every time tick when phase/resolution are unchanged (stabilizes pool + leverage children). */
  const displayMarket: Market = useMemo(
    () => ({
      ...market,
      phase: tr.effectivePhase,
      resolution: {
        ...market.resolution,
        status: tr.effectiveResolutionStatus,
      },
    }),
    [market, tr.effectivePhase, tr.effectiveResolutionStatus],
  );
  const livePool = useLiveOmnipairPool(displayMarket);
  const detailDerivedVol = useDetailDerivedVolume(displayMarket);
  const dbCachedVolumeForDerivedLog = useMemo(() => {
    const v = displayMarket.snapshot?.volumeUsd;
    return typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 0;
  }, [displayMarket.snapshot?.volumeUsd]);

  useEffect(() => {
    const slug = displayMarket.id;
    if (!detailDerivedVol.hasPool) {
      logDetailDerivedVolume({
        slug,
        source: DETAIL_DERIVED_VOLUME_SOURCE,
        tradeRowCount: 0,
        derivedVolumeUsd: 0,
        dbCachedVolumeUsd: dbCachedVolumeForDerivedLog,
        usingDerivedVolume: false,
      });
      return;
    }
    if (detailDerivedVol.derived) {
      logDetailDerivedVolume({
        slug,
        source: DETAIL_DERIVED_VOLUME_SOURCE,
        tradeRowCount: detailDerivedVol.derived.swapsParsed,
        derivedVolumeUsd: detailDerivedVol.derived.volumeUsd,
        dbCachedVolumeUsd: dbCachedVolumeForDerivedLog,
        usingDerivedVolume: true,
      });
      return;
    }
    if (!detailDerivedVol.loading && detailDerivedVol.error) {
      logDetailDerivedVolume({
        slug,
        source: DETAIL_DERIVED_VOLUME_SOURCE,
        tradeRowCount: 0,
        derivedVolumeUsd: 0,
        dbCachedVolumeUsd: dbCachedVolumeForDerivedLog,
        usingDerivedVolume: false,
      });
    }
  }, [
    dbCachedVolumeForDerivedLog,
    detailDerivedVol.derived,
    detailDerivedVol.error,
    detailDerivedVol.hasPool,
    detailDerivedVol.loading,
    displayMarket.id,
  ]);

  /** `market.id` is `markets.slug` — must match GET/POST `/api/market/price-history?slug=` / body.slug. */
  const priceHistory = useMarketPriceHistory({
    slug: market.id,
    initialSeries: initialChartHistory,
    chartHistoryServerFetchedAtMs,
  });
  const mountT = useRef(0);
  const poolReadyLogged = useRef(false);

  const { publicKey, connected } = useWallet();
  const omnipairHook = useOmnipairUserPosition(displayMarket, publicKey, connected);
  const isResolved = tr.effectiveResolutionStatus === "resolved";
  const isResolving = tr.effectiveIsResolving;
  const tradingOpen = tr.effectiveTradingOpen;
  const chartOmnipairEnabled =
    isBinary &&
    (displayMarket.phase === "trading" ||
      displayMarket.phase === "resolving" ||
      displayMarket.phase === "resolved");
  const showPositionPanel =
    isBinary &&
    (displayMarket.phase === "trading" ||
      displayMarket.phase === "resolving" ||
      displayMarket.phase === "resolved");

  const positionDustHide = useMemo(() => {
    if (!isBinary) {
      return {
        hiddenBecauseDust: false,
        debtYesHuman: 0,
        debtNoHuman: 0,
      };
    }
    const s = omnipairHook.snapshot;
    if (!s?.userPositionPda) {
      return { hiddenBecauseDust: false, debtYesHuman: 0, debtNoHuman: 0 };
    }
    const debtYesHuman = outcomeAtomsToHuman(s.debtYesAtoms);
    const debtNoHuman = outcomeAtomsToHuman(s.debtNoAtoms);
    const maxDebt = Math.max(debtYesHuman, debtNoHuman);
    const maxColl = Math.max(
      outcomeAtomsToHuman(s.collateralYesAtoms),
      outcomeAtomsToHuman(s.collateralNoAtoms),
    );
    const hiddenBecauseDust =
      maxDebt < POSITION_DUST_HUMAN && maxColl < POSITION_DUST_HUMAN;
    return { hiddenBecauseDust, debtYesHuman, debtNoHuman };
  }, [isBinary, omnipairHook.snapshot]);

  const lastPositionDustKey = useRef<string | null>(null);
  useEffect(() => {
    if (!isBinary) {
      lastPositionDustKey.current = null;
      return;
    }
    const key = [
      market.id,
      positionDustHide.debtYesHuman,
      positionDustHide.debtNoHuman,
      String(positionDustHide.hiddenBecauseDust),
    ].join("\0");
    if (lastPositionDustKey.current === key) return;
    lastPositionDustKey.current = key;
    console.info(
      POSITION_DUST_LOG,
      JSON.stringify({
        slug: market.id,
        debtYesHuman: positionDustHide.debtYesHuman,
        debtNoHuman: positionDustHide.debtNoHuman,
        hiddenBecauseDust: positionDustHide.hiddenBecauseDust,
      }),
    );
  }, [isBinary, market.id, positionDustHide]);

  const showYourPositionBlock =
    showPositionPanel && !positionDustHide.hiddenBecauseDust;

  useEffect(() => {
    mountT.current = performance.now();
    poolReadyLogged.current = false;
  }, [market.id]);

  useEffect(() => {
    logMarketTraceClient({ where: "components/market/market-detail-view.tsx", market });
  }, [market]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    logUiStateTraceClient({
      rawMarket: market,
      displayMarket,
      tr,
      nowMs: Date.now(),
    });
  }, [market, displayMarket, tr, timeTick]);

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
    const staticYes = displayMarket.pool?.yesPrice ?? displayMarket.yesProbability;
    console.info(
      "[predicted][market-detail-pool]",
      JSON.stringify({
        marketId: market.id,
        poolAddress: displayMarket.pool?.poolId ?? null,
        phase: displayMarket.phase,
        tradingOpen,
        futureEndOverride: tr.futureEndOverride,
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
          !tradingOpen || livePool.unavailable || livePool.yesProbability == null
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
    displayMarket.phase,
    displayMarket.pool?.poolId,
    displayMarket.pool?.yesPrice,
    displayMarket.yesProbability,
    tradingOpen,
    tr.futureEndOverride,
  ]);

  const onPoolTxSettled = useCallback(() => {
    void livePool.refresh("after_trade");
  }, [livePool.refresh]);

  const onLeverageAfterTx = useCallback(
    async (detail?: { signature?: string }) => {
      await omnipairHook.refreshAsync();
      void livePool.refresh("after_trade");
      const sig = detail?.signature ?? "";
      await runPostTradeRefreshSequence(router, {
        slug: market.id,
        txSignature: sig || "(no_signature)",
        runVolumeUpdate: async () => {
          if (detail?.signature) {
            if (process.env.NODE_ENV === "development") {
              console.info(
                "[predicted][volume-verify] recordAfterTrade_path",
                {
                  path: "leverage",
                  slug: market.id,
                  signature: detail.signature,
                },
              );
            }
            await priceHistory.recordAfterTrade(detail.signature);
          } else {
            if (process.env.NODE_ENV === "development") {
              console.warn(
                "[predicted][volume-verify] recordAfterTrade_skipped_no_signature",
                { path: "leverage", slug: market.id },
              );
            }
            await priceHistory.refetch();
          }
        },
      });
    },
    [
      livePool.refresh,
      market.id,
      omnipairHook.refreshAsync,
      priceHistory,
      router,
    ],
  );

  const onTradePriceSnapshot = useCallback(
    (sig: string) => priceHistory.recordAfterTrade(sig),
    [priceHistory],
  );

  return (
    <div className="min-h-screen bg-black pb-24 pt-4 text-zinc-100 sm:pt-5">
      <div className="mx-auto max-w-[1600px] px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.48, ease: [0.16, 1, 0.3, 1] }}
        >
          {livePool.rpcDegradedMessage ? (
            <div
              className="mb-3 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-[13px] text-amber-100/95"
              role="status"
            >
              {livePool.rpcDegradedMessage}
            </div>
          ) : null}
          <MarketDetailHeader
            market={displayMarket}
            liveYesProbability={
              tradingOpen || (isBinary && isResolved)
                ? livePool.yesProbability
                : undefined
            }
            detailVolume={{
              hasPool: detailDerivedVol.hasPool,
              loading: detailDerivedVol.loading,
              volumeUsd:
                detailDerivedVol.derived !== null
                  ? detailDerivedVol.derived.volumeUsd
                  : null,
              swapsParsed: detailDerivedVol.derived?.swapsParsed ?? 0,
              signaturesScanned:
                detailDerivedVol.derived?.signaturesScanned ?? 0,
              error: detailDerivedVol.error,
            }}
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
                market={displayMarket}
                tradingBinary={chartOmnipairEnabled}
                livePool={livePool}
                priceHistory={priceHistory}
              />
            </Suspense>

            {showYourPositionBlock ? (
              <YourPositionPanel
                market={displayMarket}
                snapshot={omnipairHook.snapshot}
                loading={omnipairHook.loading}
                error={omnipairHook.error}
                onPositionTxSettled={(d) => {
                  void omnipairHook.refresh();
                  void livePool.refresh("after_position_tx");
                  const sig = d?.signature ?? "";
                  void runPostTradeRefreshSequence(router, {
                    slug: market.id,
                    txSignature: sig || "(no_signature)",
                    runVolumeUpdate: async () => {
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
                        await priceHistory.recordAfterTrade(d.signature);
                      } else {
                        if (process.env.NODE_ENV === "development") {
                          console.warn(
                            "[predicted][volume-verify] recordAfterTrade_skipped_no_signature",
                            { path: "close_position", slug: market.id },
                          );
                        }
                        await priceHistory.refetch();
                      }
                    },
                  });
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
              <MarketDetailTabs market={displayMarket} />
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
            {displayMarket.phase === "raising" && <RaisingPanel market={displayMarket} />}
            {displayMarket.phase === "trading" && !isBinary && (
              <DateTradingPanel market={displayMarket} />
            )}
            {isBinary &&
              (displayMarket.phase === "trading" ||
                displayMarket.phase === "resolving" ||
                displayMarket.phase === "resolved") && (
              <>
                {isBinary &&
                !isResolved &&
                (displayMarket.phase === "trading" || displayMarket.phase === "resolving") ? (
                  <MarketResolverPanel market={displayMarket} />
                ) : null}
                <MarketActionsCard
                  market={displayMarket}
                  variant="market"
                  initialActionTab="buy"
                  poolPriceLoading={livePool.loading}
                  {...(showPositionPanel && displayMarket.pool
                    ? {
                        liveYesProbability: livePool.yesProbability ?? undefined,
                        liveNoProbability: livePool.noProbability ?? undefined,
                        livePriceUnavailable: livePool.unavailable,
                        oneSidedLiquidity: livePool.oneSidedLiquidity,
                        onPoolTxSettled,
                        onOmnipairRefresh: omnipairHook.refresh,
                        onTradePriceSnapshot,
                        onLeverageAfterTx: isResolved
                          ? undefined
                          : onLeverageAfterTx,
                        omnipairSnapshot: omnipairHook.snapshot,
                      }
                    : {})}
                />
              </>
            )}
          </motion.aside>
        </div>
      </div>
    </div>
  );
}

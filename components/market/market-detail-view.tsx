"use client";

import { motion } from "framer-motion";
import type { Market } from "@/lib/types/market";
import { useLiveOmnipairPool } from "@/lib/hooks/use-live-omnipair-pool";
import { useMarketPriceHistory } from "@/lib/hooks/use-market-price-history";
import { useOmnipairUserPosition } from "@/lib/hooks/use-omnipair-user-position";
import { useWallet } from "@/lib/hooks/use-wallet";
import { MarketDetailHeader } from "@/components/market/market-detail-header";
import { MarketChartOrderbookSection } from "@/components/market/market-chart-orderbook-section";
import { MarketDetailTabs } from "@/components/market/market-detail-tabs";
import { TradingPanel } from "@/components/market/trading-panel";
import { DateTradingPanel } from "@/components/market/date-trading-panel";
import { RaisingPanel } from "@/components/market/raising-panel";
import { YourPositionPanel } from "@/components/market/your-position-panel";

const aboutPanel = "rounded-xl bg-[#111] p-4 ring-1 ring-white/[0.06]";

type MarketDetailViewProps = {
  market: Market;
};

export function MarketDetailView({ market }: MarketDetailViewProps) {
  const isBinary = market.kind === "binary";
  const livePool = useLiveOmnipairPool(market);
  const priceHistory = useMarketPriceHistory({ slug: market.id });
  const { publicKey, connected } = useWallet();
  const omnipairHook = useOmnipairUserPosition(market, publicKey, connected);
  const tradingBinary = market.phase === "trading" && isBinary;

  return (
    <div className="min-h-screen bg-black pb-24 pt-4 text-zinc-100 sm:pt-5">
      <div className="mx-auto max-w-[1600px] px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.48, ease: [0.16, 1, 0.3, 1] }}
        >
          <MarketDetailHeader market={market} />
        </motion.div>

        <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)] lg:items-start lg:gap-6">
          <motion.div
            className="space-y-5"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.58, ease: [0.16, 1, 0.3, 1] }}
          >
            <MarketChartOrderbookSection
              market={market}
              series={priceHistory.series}
              sparseHistory={priceHistory.sparseHistory}
              historyLoading={priceHistory.loading}
              {...(tradingBinary
                ? {
                    liveYesProbability: livePool.yesProbability,
                    liveNoProbability: livePool.noProbability,
                    livePriceUnavailable: livePool.unavailable,
                    oneSidedLiquidity: livePool.oneSidedLiquidity,
                    liveRefreshEpoch: livePool.refreshEpoch,
                  }
                : {})}
            />

            {tradingBinary ? (
              <YourPositionPanel
                market={market}
                snapshot={omnipairHook.snapshot}
                loading={omnipairHook.loading}
                error={omnipairHook.error}
                onPositionTxSettled={() => {
                  void omnipairHook.refresh();
                  void livePool.refresh("after_position_tx");
                }}
              />
            ) : null}

            <div className={aboutPanel}>
              <h2 className="text-[13px] font-semibold text-white">About</h2>
              <p className="mt-1.5 text-[12px] leading-relaxed text-zinc-400">
                {market.description}
              </p>
            </div>

            <MarketDetailTabs market={market} />
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
                          onTradePriceSnapshot: priceHistory.recordAfterTrade,
                          omnipairSnapshot: omnipairHook.snapshot,
                          onLeverageAfterTx: async () => {
                            await omnipairHook.refreshAsync();
                            void livePool.refresh("after_trade");
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

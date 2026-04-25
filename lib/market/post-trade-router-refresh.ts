"use client";

import { clearSolanaRpcReadCache } from "@/lib/solana/connection-resilient";

const POST_TRADE_SAFETY_REFRESH_MS = 1500;

export type PostTradeRouter = {
  refresh: () => void | Promise<void>;
};

/**
 * Awaits the volume / price-history update, then refreshes the RSC tree once,
 * then schedules a single delayed refresh for late DB commits.
 */
export async function runPostTradeRefreshSequence(
  router: PostTradeRouter,
  meta: {
    slug: string;
    txSignature: string;
    runVolumeUpdate: () => Promise<unknown>;
  },
): Promise<void> {
  let afterAwaitedVolumeUpdate = false;
  try {
    await meta.runVolumeUpdate();
    afterAwaitedVolumeUpdate = true;
  } catch {
    afterAwaitedVolumeUpdate = false;
  }

  console.info("[predicted][post-trade-refresh]", {
    slug: meta.slug,
    txSignature: meta.txSignature,
    event: "immediate_refresh",
    delayMs: 0,
    afterAwaitedVolumeUpdate,
  });
  clearSolanaRpcReadCache();
  await Promise.resolve(router.refresh());

  setTimeout(() => {
    console.info("[predicted][post-trade-refresh]", {
      slug: meta.slug,
      txSignature: meta.txSignature,
      event: "delayed_refresh",
      delayMs: POST_TRADE_SAFETY_REFRESH_MS,
      afterAwaitedVolumeUpdate,
    });
    clearSolanaRpcReadCache();
    void router.refresh();
  }, POST_TRADE_SAFETY_REFRESH_MS);
}

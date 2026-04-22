import { PublicKey } from "@solana/web3.js";

import { deriveMarketProbabilityFromPoolState } from "@/lib/market/derive-market-probability";
import {
  getResolvedBinaryDisplayPrices,
  withResolvedBinaryDisplay,
} from "@/lib/market/resolved-binary-prices";
import type { Market } from "@/lib/types/market";
import { getConnection } from "@/lib/solana/connection";
import {
  fetchPoolTotalSwapVolumeUsdWithStats,
} from "@/lib/solana/fetch-pool-onchain-activity";
import { readOmnipairPoolState } from "@/lib/solana/read-omnipair-pool-state";

const LOG = "[predicted][enrich-market-chain]";

/** Parallel pool reads for feed refresh (no signature scan — avoids 10–30s stalls). */
const SPOT_ENRICH_CONCURRENCY = 12;

async function enrichOneMarketPoolSpotOnly(market: Market): Promise<Market> {
  if (!market.pool?.poolId || !market.pool.yesMint || !market.pool.noMint) {
    return market;
  }

  const connection = getConnection();
  try {
    const pair = new PublicKey(market.pool.poolId);
    const yes = new PublicKey(market.pool.yesMint);
    const no = new PublicKey(market.pool.noMint);

    const poolState = await readOmnipairPoolState(connection, {
      pairAddress: pair,
      yesMint: yes,
      noMint: no,
    });

    const derived = deriveMarketProbabilityFromPoolState(poolState);

    return {
      ...market,
      yesProbability: derived?.yesProbability ?? market.yesProbability,
      snapshot: {
        ...market.snapshot,
      },
      pool: {
        ...market.pool,
        yesPrice: derived?.yesProbability ?? market.pool.yesPrice,
        noPrice: derived?.noProbability ?? market.pool.noPrice,
      },
    };
  } catch (e) {
    console.warn(LOG, "spot-only failed", market.id, e);
    return withResolvedBinaryDisplay(market);
  }
}

/**
 * Live YES/NO spot from vaults only. Preserves `snapshot.volumeUsd` from input.
 */
export async function enrichMarketsPoolSpotOnly(
  markets: Market[],
  options?: { perMarketMs?: number[] },
): Promise<Market[]> {
  const out: Market[] = new Array(markets.length);
  let cursor = 0;
  const timings = options?.perMarketMs;

  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor++;
      if (i >= markets.length) return;
      const t0 = Date.now();
      out[i] = await enrichOneMarketPoolSpotOnly(markets[i]!);
      timings?.push(Date.now() - t0);
    }
  }

  const workers = Math.min(
    SPOT_ENRICH_CONCURRENCY,
    Math.max(1, markets.length),
  );
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}

async function enrichOneMarketOnChainSwapVolume(market: Market): Promise<Market> {
  if (!market.pool?.poolId || !market.pool.yesMint || !market.pool.noMint) {
    return market;
  }

  const connection = getConnection();
  try {
    const pair = new PublicKey(market.pool.poolId);
    const yes = new PublicKey(market.pool.yesMint);
    const no = new PublicKey(market.pool.noMint);

    const stats = await fetchPoolTotalSwapVolumeUsdWithStats(connection, {
      pairAddress: pair,
      yesMint: yes,
      noMint: no,
    });
    const volumeUsd = Number.isFinite(stats.volumeUsd)
      ? Math.max(0, stats.volumeUsd)
      : 0;

    if (process.env.NODE_ENV === "development") {
      console.info("[predicted][onchain-volume-direct]", {
        component: "enrich_markets_feed_server",
        marketId: market.id,
        poolAddress: market.pool.poolId,
        signaturesScanned: stats.signaturesScanned,
        swapsParsed: stats.swapsParsed,
        volumeUsd,
      });
    }

    return withResolvedBinaryDisplay({
      ...market,
      snapshot: {
        ...market.snapshot,
        volumeUsd,
      },
    });
  } catch (e) {
    console.warn(LOG, "on-chain swap volume failed", market.id, e);
    return withResolvedBinaryDisplay(market);
  }
}

/**
 * Swap-only USD volume from paginated pair history (same as `/api/market/swap-volume`).
 */
export async function enrichMarketsOnChainSwapVolume(
  markets: Market[],
  options?: { perMarketMs?: number[] },
): Promise<Market[]> {
  const out: Market[] = new Array(markets.length);
  let cursor = 0;
  const timings = options?.perMarketMs;

  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor++;
      if (i >= markets.length) return;
      const t0 = Date.now();
      out[i] = await enrichOneMarketOnChainSwapVolume(markets[i]!);
      timings?.push(Date.now() - t0);
    }
  }

  const workers = Math.min(
    SPOT_ENRICH_CONCURRENCY,
    Math.max(1, markets.length),
  );
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}

async function enrichOneMarketFull(market: Market): Promise<Market> {
  if (!market.pool?.poolId || !market.pool.yesMint || !market.pool.noMint) {
    return withResolvedBinaryDisplay(market);
  }

  const connection = getConnection();
  try {
    const pair = new PublicKey(market.pool.poolId);
    const yes = new PublicKey(market.pool.yesMint);
    const no = new PublicKey(market.pool.noMint);

    if (getResolvedBinaryDisplayPrices(market)) {
      const stats = await fetchPoolTotalSwapVolumeUsdWithStats(connection, {
        pairAddress: pair,
        yesMint: yes,
        noMint: no,
      });
      const volumeUsd = Number.isFinite(stats.volumeUsd)
        ? Math.max(0, stats.volumeUsd)
        : 0;
      return withResolvedBinaryDisplay({
        ...market,
        snapshot: {
          ...market.snapshot,
          volumeUsd,
        },
      });
    }

    const [stats, poolState] = await Promise.all([
      fetchPoolTotalSwapVolumeUsdWithStats(connection, {
        pairAddress: pair,
        yesMint: yes,
        noMint: no,
      }),
      readOmnipairPoolState(connection, {
        pairAddress: pair,
        yesMint: yes,
        noMint: no,
      }),
    ]);

    const derived = deriveMarketProbabilityFromPoolState(poolState);
    const volumeUsd = Number.isFinite(stats.volumeUsd)
      ? Math.max(0, stats.volumeUsd)
      : 0;

    return {
      ...market,
      yesProbability: derived?.yesProbability ?? market.yesProbability,
      snapshot: {
        ...market.snapshot,
        volumeUsd,
      },
      pool: {
        ...market.pool,
        yesPrice: derived?.yesProbability ?? market.pool.yesPrice,
        noPrice: derived?.noProbability ?? market.pool.noPrice,
      },
    };
  } catch (e) {
    console.warn(LOG, market.id, e);
    return withResolvedBinaryDisplay(market);
  }
}

/** Full enrich including swap-volume scan — expensive; prefer spot-only for feeds. */
export async function enrichMarketsWithOnChainStats(
  markets: Market[],
): Promise<Market[]> {
  const out: Market[] = new Array(markets.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor++;
      if (i >= markets.length) return;
      out[i] = await enrichOneMarketFull(markets[i]!);
    }
  }
  await Promise.all([worker(), worker()]);
  return out;
}

export async function enrichMarketWithOnChainStats(market: Market): Promise<Market> {
  return enrichOneMarketFull(market);
}

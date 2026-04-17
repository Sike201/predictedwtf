import { PublicKey } from "@solana/web3.js";

import { deriveMarketProbabilityFromPoolState } from "@/lib/market/derive-market-probability";
import type { Market } from "@/lib/types/market";
import { getConnection } from "@/lib/solana/connection";
import { fetchPoolTotalSwapVolumeUsd } from "@/lib/solana/fetch-pool-onchain-activity";
import { readOmnipairPoolState } from "@/lib/solana/read-omnipair-pool-state";

const LOG = "[predicted][enrich-market-chain]";

async function enrichOneMarket(market: Market): Promise<Market> {
  if (!market.pool?.poolId || !market.pool.yesMint || !market.pool.noMint) {
    return market;
  }

  const connection = getConnection();
  try {
    const pair = new PublicKey(market.pool.poolId);
    const yes = new PublicKey(market.pool.yesMint);
    const no = new PublicKey(market.pool.noMint);

    const [volumeUsd, poolState] = await Promise.all([
      fetchPoolTotalSwapVolumeUsd(connection, {
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
    return market;
  }
}

/** Parallel enrichment for feed (volume + spot from vault reserves). */
export async function enrichMarketsWithOnChainStats(
  markets: Market[],
): Promise<Market[]> {
  const out: Market[] = new Array(markets.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor++;
      if (i >= markets.length) return;
      out[i] = await enrichOneMarket(markets[i]!);
    }
  }
  await Promise.all([worker(), worker()]);
  return out;
}

export async function enrichMarketWithOnChainStats(market: Market): Promise<Market> {
  return enrichOneMarket(market);
}

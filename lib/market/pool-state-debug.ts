import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";

import {
  deriveMarketProbabilityFromPoolState,
  type DerivedMarketProbability,
} from "@/lib/market/derive-market-probability";
import type { Market } from "@/lib/types/market";
import type { OmnipairPoolChainState } from "@/lib/solana/read-omnipair-pool-state";
import { readOmnipairPoolState } from "@/lib/solana/read-omnipair-pool-state";

/**
 * Debug logging for Omnipair pool reads (before/after trades, polling).
 * Prefix: `[predicted][pool-live]`
 */
export function logOmnipairPoolSnapshot(
  phase: string,
  poolAddress: string,
  state: OmnipairPoolChainState,
  derived: DerivedMarketProbability | null,
  extra?: Record<string, unknown>,
): void {
  const payload = {
    phase,
    poolAddress,
    reserveYes: state.reserveYes.toString(),
    reserveNo: state.reserveNo.toString(),
    vault0: state.vault0Amount.toString(),
    vault1: state.vault1Amount.toString(),
    pairReserve0: state.pairReserve0.toString(),
    pairReserve1: state.pairReserve1.toString(),
    yesProbability: derived?.yesProbability ?? null,
    noProbability: derived?.noProbability ?? null,
    yesProbabilityBps: derived?.yesProbabilityBps ?? null,
    noProbabilityBps: derived?.noProbabilityBps ?? null,
    ...extra,
  };
  console.info(`[predicted][pool-live] ${phase}`, JSON.stringify(payload));
}

/** Snapshot pool state immediately before submitting a trade tx (debug). */
export async function logOmnipairPoolBeforeTrade(
  connection: Connection,
  market: Pick<Market, "pool" | "kind">,
): Promise<void> {
  const pool = market.pool;
  if (market.kind !== "binary" || !pool?.poolId || !pool.yesMint || !pool.noMint) {
    return;
  }
  try {
    const state = await readOmnipairPoolState(connection, {
      pairAddress: new PublicKey(pool.poolId),
      yesMint: new PublicKey(pool.yesMint),
      noMint: new PublicKey(pool.noMint),
    });
    const d = deriveMarketProbabilityFromPoolState(state);
    logOmnipairPoolSnapshot("before_trade", state.pairAddress, state, d);
  } catch (e) {
    console.warn("[predicted][pool-live] before_trade read failed", e);
  }
}

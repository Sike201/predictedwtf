"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useRef, useState } from "react";

import type { DerivedMarketProbability } from "@/lib/market/derive-market-probability";
import {
  deriveMarketProbabilityFromPoolState,
  isOneSidedLiquidity,
} from "@/lib/market/derive-market-probability";
import { logOmnipairPoolSnapshot } from "@/lib/market/pool-state-debug";
import {
  getResolvedBinaryDisplayPrices,
  logResolvedPricingOverride,
} from "@/lib/market/resolved-binary-prices";
import type { Market } from "@/lib/types/market";
import type { OmnipairPoolChainState } from "@/lib/solana/read-omnipair-pool-state";
import { readOmnipairPoolState } from "@/lib/solana/read-omnipair-pool-state";

export type LiveOmnipairPoolState = {
  yesProbability: number | null;
  noProbability: number | null;
  /** True when there is no pool metadata or RPC read failed. */
  unavailable: boolean;
  /** Exactly one reserve vault is zero; do not show 0%/100% as meaningful mid. */
  oneSidedLiquidity: boolean;
  loading: boolean;
  chainSnapshot: OmnipairPoolChainState | null;
  derivedSnapshot: DerivedMarketProbability | null;
  /** Re-fetch reserves + probability (e.g. after a confirmed trade). Pass reason for logs. */
  refresh: (reason?: string) => Promise<void>;
  /**
   * Increments after each successful pool read so chart UI can append a fresh
   * render-only “now” tail without stale memoization.
   */
  refreshEpoch: number;
};

export function useLiveOmnipairPool(market: Market): LiveOmnipairPoolState {
  const { connection } = useConnection();
  const poolId = market.pool?.poolId ?? null;
  const yesMintId = market.pool?.yesMint ?? null;
  const noMintId = market.pool?.noMint ?? null;
  const marketId = market.id;

  const [yesProbability, setYes] = useState<number | null>(null);
  const [noProbability, setNo] = useState<number | null>(null);
  const [unavailable, setUnavailable] = useState(true);
  const [oneSidedLiquidity, setOneSidedLiquidity] = useState(false);
  const [loading, setLoading] = useState(false);
  const [chainSnapshot, setChainSnapshot] = useState<OmnipairPoolChainState | null>(
    null,
  );
  const [derivedSnapshot, setDerivedSnapshot] =
    useState<DerivedMarketProbability | null>(null);
  const [refreshEpoch, setRefreshEpoch] = useState(0);
  const mounted = useRef(true);
  const resolvedLogKeyRef = useRef<string | null>(null);
  /** Stabilize `refresh` identity — parent `market` can get a new object reference on a timer without any logical change, which was re-firing the initial effect and re-fetching the pool repeatedly. */
  const marketRef = useRef(market);
  marketRef.current = market;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(
    async (reason = "refresh") => {
      const m = marketRef.current;
      const resolvedPx = getResolvedBinaryDisplayPrices(m);
      if (resolvedPx) {
        const logKey = `${marketId}:${resolvedPx.winningOutcome}`;
        if (resolvedLogKeyRef.current !== logKey) {
          resolvedLogKeyRef.current = logKey;
          logResolvedPricingOverride({
            slug: m.id,
            winningOutcome: resolvedPx.winningOutcome,
            finalYesPrice: resolvedPx.yes,
            finalNoPrice: resolvedPx.no,
          });
        }
        if (mounted.current) {
          setUnavailable(false);
          setOneSidedLiquidity(false);
          setYes(resolvedPx.yes);
          setNo(resolvedPx.no);
          setChainSnapshot(null);
          setDerivedSnapshot(null);
          setLoading(false);
          setRefreshEpoch((n) => n + 1);
        }
        if (process.env.NODE_ENV === "development") {
          console.info(
            "[predicted][pool-prices-render]",
            JSON.stringify({
              phase: reason,
              reserveYes: null,
              reserveNo: null,
              computedYesPrice: resolvedPx.yes,
              computedNoPrice: resolvedPx.no,
              finalDisplayedYesPrice: resolvedPx.yes,
              finalDisplayedNoPrice: resolvedPx.no,
              note: "resolved_binary_override",
            }),
          );
        }
        return;
      }
      resolvedLogKeyRef.current = null;

      if (!poolId || !yesMintId || !noMintId) {
        if (process.env.NODE_ENV === "development") {
          console.info(
            "[predicted][pool-live][skip_no_pool]",
            JSON.stringify({ reason, marketId, poolId, yesMintId, noMintId }),
          );
        }
        if (mounted.current) {
          setUnavailable(true);
          setOneSidedLiquidity(false);
          setYes(null);
          setNo(null);
          setChainSnapshot(null);
          setDerivedSnapshot(null);
        }
        return;
      }

      setLoading(true);
      try {
        const state = await readOmnipairPoolState(connection, {
          pairAddress: new PublicKey(poolId),
          yesMint: new PublicKey(yesMintId),
          noMint: new PublicKey(noMintId),
        });
        const oneSide = isOneSidedLiquidity(state);
        const derived = deriveMarketProbabilityFromPoolState(state);
        logOmnipairPoolSnapshot(
          reason,
          state.pairAddress,
          state,
          derived,
          { oneSidedLiquidity: oneSide },
        );

        if (!mounted.current) return;

        setChainSnapshot(state);
        setDerivedSnapshot(derived);

        if (oneSide) {
          setOneSidedLiquidity(true);
          setUnavailable(false);
          setYes(null);
          setNo(null);
          setRefreshEpoch((n) => n + 1);
          console.info(
            "[predicted][pool-prices-render]",
            JSON.stringify({
              phase: reason,
              reserveYes: state.reserveYes.toString(),
              reserveNo: state.reserveNo.toString(),
              computedYesPrice: derived?.yesProbability ?? null,
              computedNoPrice: derived?.noProbability ?? null,
              finalDisplayedYesPrice: null,
              finalDisplayedNoPrice: null,
              note: "one_sided",
            }),
          );
          return;
        }

        setOneSidedLiquidity(false);

        if (!derived) {
          setUnavailable(true);
          setYes(null);
          setNo(null);
          setRefreshEpoch((n) => n + 1);
          console.info(
            "[predicted][pool-prices-render]",
            JSON.stringify({
              phase: reason,
              reserveYes: state.reserveYes.toString(),
              reserveNo: state.reserveNo.toString(),
              computedYesPrice: null,
              computedNoPrice: null,
              finalDisplayedYesPrice: null,
              finalDisplayedNoPrice: null,
              note: "no_derived",
            }),
          );
          return;
        }

        const finalYes = derived.yesProbability;
        const finalNo = derived.noProbability;
        console.info(
          "[predicted][pool-prices-render]",
          JSON.stringify({
            phase: reason,
            reserveYes: state.reserveYes.toString(),
            reserveNo: state.reserveNo.toString(),
            computedYesPrice: derived.yesProbability,
            computedNoPrice: derived.noProbability,
            finalDisplayedYesPrice: finalYes,
            finalDisplayedNoPrice: finalNo,
          }),
        );

        setUnavailable(false);
        setYes(finalYes);
        setNo(finalNo);
        setRefreshEpoch((n) => n + 1);
      } catch (e) {
        console.warn(`[predicted][pool-live] ${reason} failed`, e);
        if (process.env.NODE_ENV === "development") {
          console.info(
            "[predicted][pool-live][error_fallback]",
            JSON.stringify({
              reason,
              marketId,
              poolId,
              message: e instanceof Error ? e.message : String(e),
            }),
          );
        }
        if (mounted.current) {
          setUnavailable(true);
          setOneSidedLiquidity(false);
          setYes(null);
          setNo(null);
          setChainSnapshot(null);
          setDerivedSnapshot(null);
        }
      } finally {
        if (mounted.current) setLoading(false);
      }
    },
    [connection, marketId, poolId, yesMintId, noMintId],
  );

  useEffect(() => {
    void refresh("initial");
  }, [refresh]);

  return {
    yesProbability,
    noProbability,
    unavailable,
    oneSidedLiquidity,
    loading,
    chainSnapshot,
    derivedSnapshot,
    refresh,
    refreshEpoch,
  };
}

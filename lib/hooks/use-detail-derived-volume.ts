"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { POOL_ACTIVITY_REFRESH_EVENT } from "@/lib/market/recent-market-transactions";
import type { Market } from "@/lib/types/market";

const SOURCE = "fetchPoolTotalSwapVolumeUsdWithStats_via_swap_volume_api";

type DerivedState = {
  volumeUsd: number;
  signaturesScanned: number;
  swapsParsed: number;
};

/**
 * On-chain swap total for the market pool — same aggregation as incremental volume
 * (GAMM: `parseSwapUsdMicrosFromTx`; PM_AMM: USDC in/out over market PDA history),
 * not the capped pool-activity table rows.
 */
export function useDetailDerivedVolume(market: Market): {
  hasPool: boolean;
  loading: boolean;
  error: string | null;
  derived: DerivedState | null;
  refetch: () => void;
} {
  const poolId = market.pool?.poolId;
  const yesMint = market.pool?.yesMint;
  const noMint = market.pool?.noMint;
  const hasPool = !!poolId && !!yesMint && !!noMint;
  const slug = market.id;

  const [derived, setDerived] = useState<DerivedState | null>(null);
  const [loading, setLoading] = useState(hasPool);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  const load = useCallback(async () => {
    if (!hasPool || !poolId || !yesMint || !noMint) {
      setDerived(null);
      setLoading(false);
      setError(null);
      return;
    }
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        poolId,
        yesMint,
        noMint,
      });
      if (market.engine === "PM_AMM" && market.collateralMint) {
        qs.set("engine", "PM_AMM");
        qs.set("collateralMint", market.collateralMint);
      }
      const res = await fetch(`/api/market/swap-volume?${qs.toString()}`, {
        credentials: "same-origin",
      });
      const data = (await res.json().catch(() => ({}))) as {
        volumeUsd?: number;
        signaturesScanned?: number;
        swapsParsed?: number;
      };
      if (id !== reqId.current) return;
      if (!res.ok) {
        setError("Could not load on-chain volume");
        setDerived(null);
        return;
      }
      const volumeUsd =
        typeof data.volumeUsd === "number" && Number.isFinite(data.volumeUsd)
          ? Math.max(0, data.volumeUsd)
          : 0;
      const signaturesScanned =
        typeof data.signaturesScanned === "number" &&
        Number.isFinite(data.signaturesScanned)
          ? Math.max(0, data.signaturesScanned)
          : 0;
      const swapsParsed =
        typeof data.swapsParsed === "number" && Number.isFinite(data.swapsParsed)
          ? Math.max(0, data.swapsParsed)
          : 0;
      setDerived({ volumeUsd, signaturesScanned, swapsParsed });
    } catch (e) {
      if (id !== reqId.current) return;
      setError(e instanceof Error ? e.message : "Failed to load volume");
      setDerived(null);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [hasPool, poolId, yesMint, noMint, market.engine, market.collateralMint]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!hasPool) return;
    const handler = (ev: Event) => {
      const ce = ev as CustomEvent<{ slug?: string }>;
      if (ce.detail?.slug === slug) void load();
    };
    window.addEventListener(POOL_ACTIVITY_REFRESH_EVENT, handler);
    return () => window.removeEventListener(POOL_ACTIVITY_REFRESH_EVENT, handler);
  }, [hasPool, slug, load]);

  return { hasPool, loading, error, derived, refetch: load };
}

export function logDetailDerivedVolume(payload: {
  slug: string;
  source: string;
  tradeRowCount: number;
  derivedVolumeUsd: number;
  dbCachedVolumeUsd: number;
  usingDerivedVolume: boolean;
}) {
  console.info("[predicted][detail-derived-volume]", payload);
}

export { SOURCE as DETAIL_DERIVED_VOLUME_SOURCE };

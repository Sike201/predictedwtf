"use client";

import { useEffect, useState } from "react";

type Params = {
  poolId: string | null | undefined;
  yesMint: string | null | undefined;
  noMint: string | null | undefined;
  marketId: string;
  /** Dev log label, e.g. `MarketDetailHeader`. */
  component: string;
  /** DB snapshot shown immediately; replaced by on-chain when fetch succeeds. */
  baselineUsd?: number;
};

function clampVol(n: unknown): number {
  if (typeof n === "number" && Number.isFinite(n)) return Math.max(0, n);
  return 0;
}

/**
 * On-chain swap total from `/api/market/swap-volume`. Uses `baselineUsd` until the request finishes
 * (or on failure) so the header never flashes to $0 while RPC scans.
 */
export function usePoolSwapVolumeUsd({
  poolId,
  yesMint,
  noMint,
  marketId,
  component,
  baselineUsd = 0,
}: Params) {
  const baseline = clampVol(baselineUsd);
  const [volumeUsd, setVolumeUsd] = useState(baseline);
  const [signaturesScanned, setSignaturesScanned] = useState(0);
  const [swapsParsed, setSwapsParsed] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setVolumeUsd(baseline);
  }, [baseline, marketId]);

  useEffect(() => {
    if (!poolId || !yesMint || !noMint) {
      setVolumeUsd(baseline);
      setSignaturesScanned(0);
      setSwapsParsed(0);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    const qs = new URLSearchParams({ poolId, yesMint, noMint });
    void fetch(`/api/market/swap-volume?${qs}`)
      .then((r) => r.json())
      .then(
        (j: {
          volumeUsd?: unknown;
          signaturesScanned?: unknown;
          swapsParsed?: unknown;
        }) => {
          if (cancelled) return;
          const v =
            typeof j.volumeUsd === "number" && Number.isFinite(j.volumeUsd)
              ? Math.max(0, j.volumeUsd)
              : 0;
          const sc =
            typeof j.signaturesScanned === "number" &&
            Number.isFinite(j.signaturesScanned)
              ? j.signaturesScanned
              : 0;
          const sp =
            typeof j.swapsParsed === "number" && Number.isFinite(j.swapsParsed)
              ? j.swapsParsed
              : 0;
          setVolumeUsd(v);
          setSignaturesScanned(sc);
          setSwapsParsed(sp);
          if (process.env.NODE_ENV === "development") {
            console.info("[predicted][onchain-volume-direct]", {
              component,
              marketId,
              poolAddress: poolId,
              signaturesScanned: sc,
              swapsParsed: sp,
              volumeUsd: v,
              baselineUsd: baseline,
            });
          }
        },
      )
      .catch(() => {
        if (cancelled) return;
        setVolumeUsd(baseline);
        setSignaturesScanned(0);
        setSwapsParsed(0);
        if (process.env.NODE_ENV === "development") {
          console.warn("[predicted][volume-display-path]", {
            component,
            marketId,
            source: "fallback_baseline_after_fetch_error",
            baselineUsd: baseline,
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [poolId, yesMint, noMint, marketId, component, baseline]);

  return { volumeUsd, signaturesScanned, swapsParsed, loading };
}

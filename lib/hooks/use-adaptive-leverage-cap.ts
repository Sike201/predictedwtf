"use client";

import { useEffect, useState } from "react";
import {
  computeAdaptiveLeverageMaxTier,
  type LeverageUiTier,
} from "@/lib/market/adaptive-leverage-cap";

type State = {
  status: "idle" | "loading" | "ready" | "error";
  maxTier: LeverageUiTier;
  refMaxMultiple: number | null;
  error: string | null;
};

const initial: State = {
  status: "loading",
  maxTier: 1,
  refMaxMultiple: null,
  error: null,
};

/**
 * Probes /api/market/preview-leverage-usdc with a fixed reference USDC amount to cap discrete 1×–3× tiers.
 */
export function useAdaptiveLeverageCap(opts: {
  slug: string;
  side: "yes" | "no";
  userWallet: string | null | undefined;
  /** When false, skips network work (keeps last ready state unless wallet clears). */
  enabled: boolean;
}): State {
  const [state, setState] = useState<State>(initial);

  useEffect(() => {
    const wallet = opts.userWallet;
    if (!opts.enabled || !wallet) {
      setState({
        status: "idle",
        maxTier: 1,
        refMaxMultiple: null,
        error: null,
      });
      return;
    }

    const ac = new AbortController();
    setState({
      status: "loading",
      maxTier: 1,
      refMaxMultiple: null,
      error: null,
    });

    const t = window.setTimeout(() => {
      void computeAdaptiveLeverageMaxTier({
        slug: opts.slug,
        userWallet: wallet,
        side: opts.side,
        signal: ac.signal,
      })
        .then(({ maxTier, refMaxMultiple, probeError }) => {
          if (ac.signal.aborted) return;
          if (probeError) {
            setState({
              status: "error",
              maxTier: 1,
              refMaxMultiple: null,
              error: probeError,
            });
            return;
          }
          setState({
            status: "ready",
            maxTier,
            refMaxMultiple,
            error: null,
          });
        })
        .catch((e: unknown) => {
          if (ac.signal.aborted) return;
          setState({
            status: "error",
            maxTier: 1,
            refMaxMultiple: null,
            error: e instanceof Error ? e.message : "Could not estimate leverage cap",
          });
        });
    }, 320);

    return () => {
      ac.abort();
      window.clearTimeout(t);
    };
  }, [opts.enabled, opts.slug, opts.side, opts.userWallet]);

  return state;
}

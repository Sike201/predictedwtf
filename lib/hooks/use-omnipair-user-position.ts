"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicKey } from "@solana/web3.js";

import type { Market } from "@/lib/types/market";

const OMNIPAIR_POS_LOG = "[predicted][omnipair-position][fetch]";

export type OmnipairUserPositionSnapshot = {
  userPositionPda: string | null;
  collateralYesAtoms: string;
  collateralNoAtoms: string;
  debtYesAtoms: string;
  debtNoAtoms: string;
  liquidationCfYesBps?: number;
  liquidationCfNoBps?: number;
  healthFactorApprox?: number | null;
  liquidationRiskLabel?: string;
  protocolNote?: string;
  /** Pool reserve–implied P(YES) / P(NO); preferred for position USD marks. */
  spotYesProbability?: number | null;
  spotNoProbability?: number | null;
};

export function useOmnipairUserPosition(
  market: Market,
  publicKey: PublicKey | null,
  connected: boolean,
) {
  const [nonce, setNonce] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<OmnipairUserPositionSnapshot | null>(
    null,
  );

  const refreshCompletionRef = useRef<{
    nonce: number;
    resolve: () => void;
  } | null>(null);

  const refresh = useCallback(() => {
    setNonce((n) => n + 1);
  }, []);

  const refreshAsync = useCallback((): Promise<void> => {
    return new Promise<void>((resolve) => {
      setNonce((n) => {
        const next = n + 1;
        refreshCompletionRef.current = { nonce: next, resolve };
        return next;
      });
    });
  }, []);

  useEffect(() => {
    if (market.engine === "PM_AMM") {
      setSnapshot(null);
      setError(null);
      setLoading(false);
      const waitRefresh = refreshCompletionRef.current;
      if (waitRefresh?.nonce === nonce) {
        waitRefresh.resolve();
        refreshCompletionRef.current = null;
      }
      return;
    }

    if (!connected || !publicKey || !market.pool?.poolId) {
      setSnapshot(null);
      setError(null);
      setLoading(false);
      const waitRefresh = refreshCompletionRef.current;
      if (waitRefresh?.nonce === nonce) {
        waitRefresh.resolve();
        refreshCompletionRef.current = null;
      }
      return;
    }

    const ac = new AbortController();
    const effectNonce = nonce;
    setLoading(true);
    setError(null);

    console.info(
      OMNIPAIR_POS_LOG,
      "started",
      JSON.stringify({
        slug: market.id,
        wallet: publicKey.toBase58(),
        nonce: effectNonce,
      }),
    );

    const qs = new URLSearchParams({
      slug: market.id,
      wallet: publicKey.toBase58(),
    });

    const walletForRequest = publicKey.toBase58();

    fetch(`/api/market/omnipair-position?${qs.toString()}`, {
      signal: ac.signal,
      credentials: "same-origin",
    })
      .then(async (res) => {
        const data = (await res.json()) as {
          error?: string;
          snapshot?: {
            userPositionPda: string;
            collateralYesAtoms: string;
            collateralNoAtoms: string;
            debtYesAtoms: string;
            debtNoAtoms: string;
            liquidationCfYesBps?: number;
            liquidationCfNoBps?: number;
            healthFactorApprox?: number | null;
            liquidationRiskLabel?: string;
            spotYesProbability?: number | null;
            spotNoProbability?: number | null;
          } | null;
          protocolNote?: string;
        };
        if (!res.ok || data.error) {
          throw new Error(data.error ?? "Could not load lending position");
        }
        if (publicKey?.toBase58() !== walletForRequest) {
          return;
        }
        if (!data.snapshot) {
          setSnapshot(null);
          console.info(
            OMNIPAIR_POS_LOG,
            "completed",
            JSON.stringify({
              slug: market.id,
              wallet: walletForRequest,
              nonce: effectNonce,
              hasSnapshot: false,
              userPositionPda: null,
            }),
          );
          return;
        }
        setSnapshot({
          userPositionPda: data.snapshot.userPositionPda,
          collateralYesAtoms: data.snapshot.collateralYesAtoms,
          collateralNoAtoms: data.snapshot.collateralNoAtoms,
          debtYesAtoms: data.snapshot.debtYesAtoms,
          debtNoAtoms: data.snapshot.debtNoAtoms,
          liquidationCfYesBps: data.snapshot.liquidationCfYesBps,
          liquidationCfNoBps: data.snapshot.liquidationCfNoBps,
          healthFactorApprox: data.snapshot.healthFactorApprox,
          liquidationRiskLabel: data.snapshot.liquidationRiskLabel,
          spotYesProbability: data.snapshot.spotYesProbability,
          spotNoProbability: data.snapshot.spotNoProbability,
          protocolNote: data.protocolNote,
        });
        console.info(
          OMNIPAIR_POS_LOG,
          "completed",
          JSON.stringify({
            slug: market.id,
            wallet: walletForRequest,
            nonce: effectNonce,
            hasSnapshot: true,
            userPositionPda: data.snapshot.userPositionPda,
          }),
        );
      })
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
        if (publicKey?.toBase58() !== walletForRequest) return;
        setSnapshot(null);
        setError(
          e instanceof Error ? e.message : "Could not load lending position",
        );
        console.warn(
          OMNIPAIR_POS_LOG,
          "error",
          JSON.stringify({
            slug: market.id,
            wallet: walletForRequest,
            nonce: effectNonce,
            message: e instanceof Error ? e.message : String(e),
          }),
        );
      })
      .finally(() => {
        setLoading(false);
        const pending = refreshCompletionRef.current;
        if (
          pending &&
          pending.nonce === effectNonce &&
          !ac.signal.aborted
        ) {
          pending.resolve();
          refreshCompletionRef.current = null;
        }
      });

    return () => {
      ac.abort();
    };
  }, [
    connected,
    publicKey,
    market.id,
    market.engine,
    market.pool?.poolId,
    nonce,
  ]);

  return { snapshot, loading, error, refresh, refreshAsync };
}

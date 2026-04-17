"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useState } from "react";
import type { Market } from "@/lib/types/market";
import {
  readOutcomeBalances,
  readUsdcBalance,
} from "@/lib/solana/wallet-token-balances";

export type MarketTradingBalances = {
  loading: boolean;
  yesRaw: bigint;
  noRaw: bigint;
  usdcRaw: bigint;
  yesDecimals: number;
  noDecimals: number;
  usdcDecimals: number;
  refresh: () => void;
};

export function useMarketTradingBalances(
  market: Market,
  publicKey: PublicKey | null,
): MarketTradingBalances {
  const { connection } = useConnection();
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const [yesRaw, setYesRaw] = useState(0n);
  const [noRaw, setNoRaw] = useState(0n);
  const [usdcRaw, setUsdcRaw] = useState(0n);
  const [yesDecimals, setYesDecimals] = useState(9);
  const [noDecimals, setNoDecimals] = useState(9);
  const [usdcDecimals, setUsdcDecimals] = useState(6);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!publicKey || market.kind !== "binary") {
      setYesRaw(0n);
      setNoRaw(0n);
      setUsdcRaw(0n);
      setLoading(false);
      return;
    }
    const pool = market.pool;
    if (!pool?.yesMint || !pool?.noMint) {
      setYesRaw(0n);
      setNoRaw(0n);
      setUsdcRaw(0n);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const yesMint = new PublicKey(pool.yesMint);
        const noMint = new PublicKey(pool.noMint);
        const [outcomes, usdc] = await Promise.all([
          readOutcomeBalances(connection, publicKey, yesMint, noMint),
          readUsdcBalance(connection, publicKey),
        ]);
        if (cancelled) return;
        setYesRaw(outcomes.yes.raw);
        setNoRaw(outcomes.no.raw);
        setYesDecimals(outcomes.yes.decimals);
        setNoDecimals(outcomes.no.decimals);
        setUsdcRaw(usdc.raw);
        setUsdcDecimals(usdc.decimals);
      } catch {
        if (!cancelled) {
          setYesRaw(0n);
          setNoRaw(0n);
          setUsdcRaw(0n);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connection, market, publicKey, tick]);

  return {
    loading,
    yesRaw,
    noRaw,
    usdcRaw,
    yesDecimals,
    noDecimals,
    usdcDecimals,
    refresh,
  };
}

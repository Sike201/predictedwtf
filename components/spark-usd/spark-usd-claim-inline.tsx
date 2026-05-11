"use client";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { useConnection } from "@solana/wallet-adapter-react";
import { useCallback, useEffect, useState } from "react";

import { useWallet } from "@/lib/hooks/use-wallet";
import {
  COLLATERAL_DISPLAY_LABEL,
  SPARK_USD_DECIMALS,
  SPARK_USD_SYMBOL,
  tryGetSparkUsdMint,
} from "@/lib/config/spark-usd";
import { resolveMintTokenProgram } from "@/lib/solana/mint-token-program";

type SparkUsdClaimInlineProps = {
  /** Embed in modal: drop top margin so spacing is controlled by parent. */
  bare?: boolean;
};

export function SparkUsdClaimInline({ bare = false }: SparkUsdClaimInlineProps = {}) {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  const mint = tryGetSparkUsdMint();
  const [balanceHuman, setBalanceHuman] = useState<string | null>(null);
  const [claimedToday, setClaimedToday] = useState(false);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshBalance = useCallback(async () => {
    if (!mint || !publicKey || !connection) {
      setBalanceHuman(null);
      return;
    }
    try {
      const { tokenProgramId } = await resolveMintTokenProgram(
        connection,
        mint,
        "confirmed",
      );
      const ata = getAssociatedTokenAddressSync(
        mint,
        publicKey,
        false,
        tokenProgramId,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );
      const acc = await getAccount(
        connection,
        ata,
        "confirmed",
        tokenProgramId,
      );
      const n = Number(acc.amount) / 10 ** SPARK_USD_DECIMALS;
      setBalanceHuman(
        n.toLocaleString(undefined, { maximumFractionDigits: 2 }),
      );
    } catch {
      setBalanceHuman("0");
    }
  }, [connection, mint, publicKey]);

  const refreshStatus = useCallback(async () => {
    if (!publicKey) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/spark-usd/claim?wallet=${encodeURIComponent(publicKey.toBase58())}`,
      );
      const j = (await r.json()) as {
        error?: string;
        claimedToday?: boolean;
        pending?: boolean;
      };
      if (!r.ok) throw new Error(j.error || "Could not load claim status");
      setClaimedToday(j.claimedToday === true);
      setPending(j.pending === true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load claim status");
    } finally {
      setLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    void refreshBalance();
  }, [refreshBalance]);

  useEffect(() => {
    if (connected && publicKey) void refreshStatus();
  }, [connected, publicKey, refreshStatus]);

  if (!mint) return null;
  if (!connected || !publicKey) return null;

  async function onClaim() {
    setClaiming(true);
    setError(null);
    try {
      const r = await fetch("/api/spark-usd/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: publicKey!.toBase58() }),
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(j.error || "Claim failed");
      await refreshBalance();
      await refreshStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Claim failed");
    } finally {
      setClaiming(false);
    }
  }

  return (
    <div
      className={
        bare
          ? "rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2.5"
          : "mt-3 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2.5"
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-medium text-zinc-300">
            Available: {balanceHuman ?? "—"} {COLLATERAL_DISPLAY_LABEL}
          </p>
          <p className="text-[10px] text-zinc-500">
            {SPARK_USD_SYMBOL} · dev faucet
          </p>
        </div>
        {claimedToday ? (
          <span className="text-[11px] text-zinc-400">
            Claim available tomorrow (UTC)
          </span>
        ) : (
          <button
            type="button"
            disabled={claiming || pending || loading}
            onClick={() => void onClaim()}
            className="rounded-lg bg-emerald-600/90 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {claiming
              ? "Claiming…"
              : `Claim 1000 ${COLLATERAL_DISPLAY_LABEL}`}
          </button>
        )}
      </div>
      {error ? (
        <p className="mt-1 text-[11px] text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

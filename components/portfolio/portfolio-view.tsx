"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/lib/hooks/use-wallet";
import { formatBaseUnitsToDecimalString } from "@/lib/solana/wallet-token-balances";
import type { WalletPortfolioPosition } from "@/lib/market/load-wallet-portfolio";
import { cn } from "@/lib/utils/cn";

function fmtAtoms(raw: string, decimals: number, maxFrac = 6): string {
  try {
    return formatBaseUnitsToDecimalString(BigInt(raw), decimals, maxFrac);
  } catch {
    return raw;
  }
}

export function PortfolioView() {
  const { publicKey, connected } = useWallet();
  const [positions, setPositions] = useState<WalletPortfolioPosition[] | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const walletStr = publicKey?.toBase58() ?? null;

  const refresh = useCallback(async () => {
    if (!walletStr) {
      setPositions(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/portfolio/positions?wallet=${encodeURIComponent(walletStr)}`,
        { credentials: "same-origin" },
      );
      const data = (await res.json()) as {
        error?: string;
        positions?: WalletPortfolioPosition[];
      };
      if (!res.ok) {
        throw new Error(data.error ?? "Could not load positions");
      }
      setPositions(data.positions ?? []);
    } catch (e) {
      setPositions(null);
      setError(e instanceof Error ? e.message : "Could not load positions");
    } finally {
      setLoading(false);
    }
  }, [walletStr]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!connected || !publicKey) {
    return (
      <div className="mt-10 rounded-2xl border border-white/[0.08] bg-[#111] p-10 text-center ring-1 ring-white/[0.04]">
        <p className="text-sm text-zinc-400">
          Connect your wallet to see outcome shares, liquidity, and leverage
          across markets.
        </p>
      </div>
    );
  }

  if (loading && positions === null) {
    return (
      <div className="mt-10 rounded-2xl border border-white/[0.08] bg-[#111] p-10 text-center ring-1 ring-white/[0.04]">
        <p className="text-sm text-zinc-500">Loading on-chain positions…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-10 space-y-4">
        <div
          className="rounded-2xl border border-amber-500/25 bg-amber-950/20 px-4 py-3 text-sm text-amber-100/90 ring-1 ring-amber-500/15"
          role="alert"
        >
          {error}
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="text-sm font-medium text-zinc-300 underline decoration-zinc-600 underline-offset-2 hover:text-white"
        >
          Retry
        </button>
      </div>
    );
  }

  const list = positions ?? [];

  if (list.length === 0) {
    return (
      <div className="mt-10 rounded-2xl border border-white/[0.08] bg-[#111] p-10 text-center ring-1 ring-white/[0.04]">
        <p className="text-sm text-zinc-500">
          No open positions found for this wallet on tracked markets (outcome
          tokens, LP, or Omnipair leverage).
        </p>
        <Link
          href="/"
          className="mt-4 inline-block text-sm font-medium text-zinc-300 underline decoration-zinc-600 underline-offset-2 hover:text-white"
        >
          Browse markets
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-8 space-y-3">
      <div className="flex items-center justify-end gap-3">
        {loading ? (
          <span className="text-[11px] text-zinc-600">Refreshing…</span>
        ) : null}
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 py-1.5 text-[12px] font-medium text-zinc-300 transition hover:border-white/[0.14] hover:bg-white/[0.07] hover:text-white"
        >
          Refresh
        </button>
      </div>
      <ul className="space-y-2">
        {list.map((p) => (
          <li
            key={p.slug}
            className="rounded-xl border border-white/[0.08] bg-[#111] p-4 ring-1 ring-white/[0.04]"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <Link
                  href={`/markets/${encodeURIComponent(p.slug)}`}
                  className="text-[15px] font-semibold text-white hover:underline"
                >
                  {p.title}
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-500">
                  <span className="font-mono text-zinc-600">{p.slug}</span>
                  <span className="text-zinc-600">·</span>
                  <span>{p.marketEngine}</span>
                  {p.resolutionStatus === "resolved" ? (
                    <>
                      <span className="text-zinc-600">·</span>
                      <span className="text-emerald-400/90">Resolved</span>
                    </>
                  ) : null}
                </div>
              </div>
              <Link
                href={`/markets/${encodeURIComponent(p.slug)}`}
                className="shrink-0 rounded-lg border border-white/[0.1] px-3 py-1.5 text-[12px] font-medium text-zinc-200 transition hover:border-white/[0.16] hover:bg-white/[0.06]"
              >
                Open
              </Link>
            </div>
            <dl className="mt-4 grid grid-cols-1 gap-2 text-[12px] sm:grid-cols-2">
              <div className="flex justify-between gap-3 rounded-lg bg-black/40 px-3 py-2 ring-1 ring-white/[0.05]">
                <dt className="text-zinc-500">YES</dt>
                <dd className="font-mono tabular-nums text-zinc-200">
                  {fmtAtoms(p.yesAtoms, p.outcomeDecimals)}
                </dd>
              </div>
              <div className="flex justify-between gap-3 rounded-lg bg-black/40 px-3 py-2 ring-1 ring-white/[0.05]">
                <dt className="text-zinc-500">NO</dt>
                <dd className="font-mono tabular-nums text-zinc-200">
                  {fmtAtoms(p.noAtoms, p.outcomeDecimals)}
                </dd>
              </div>
              <div
                className={cn(
                  "flex justify-between gap-3 rounded-lg px-3 py-2 ring-1 ring-white/[0.05] sm:col-span-2",
                  BigInt(p.lpAtoms) > 0n
                    ? "bg-emerald-950/20 ring-emerald-500/15"
                    : "bg-black/40",
                )}
              >
                <dt className="text-zinc-500">Liquidity (LP)</dt>
                <dd className="font-mono tabular-nums text-zinc-200">
                  {fmtAtoms(p.lpAtoms, p.lpDecimals)}{" "}
                  <span className="font-sans text-zinc-600">
                    {p.marketEngine === "PM_AMM" ? "shares" : "omLP"}
                  </span>
                </dd>
              </div>
              {p.leverage ? (
                <div className="sm:col-span-2">
                  <div className="rounded-lg bg-violet-950/25 px-3 py-2 ring-1 ring-violet-500/20">
                    <p className="text-[11px] font-medium text-violet-200/90">
                      Omnipair leverage
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
                      <div>
                        <span className="text-zinc-500">Col. YES</span>
                        <p className="font-mono text-zinc-200">
                          {fmtAtoms(
                            p.leverage.collateralYesAtoms,
                            p.outcomeDecimals,
                          )}
                        </p>
                      </div>
                      <div>
                        <span className="text-zinc-500">Col. NO</span>
                        <p className="font-mono text-zinc-200">
                          {fmtAtoms(
                            p.leverage.collateralNoAtoms,
                            p.outcomeDecimals,
                          )}
                        </p>
                      </div>
                      <div>
                        <span className="text-zinc-500">Debt YES</span>
                        <p className="font-mono text-zinc-200">
                          {fmtAtoms(
                            p.leverage.debtYesAtoms,
                            p.outcomeDecimals,
                          )}
                        </p>
                      </div>
                      <div>
                        <span className="text-zinc-500">Debt NO</span>
                        <p className="font-mono text-zinc-200">
                          {fmtAtoms(
                            p.leverage.debtNoAtoms,
                            p.outcomeDecimals,
                          )}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

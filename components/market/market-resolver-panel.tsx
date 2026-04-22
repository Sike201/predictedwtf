"use client";

import type { PublicKey } from "@solana/web3.js";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/lib/hooks/use-wallet";
import { buildMarketResolveMessageV1 } from "@/lib/market/resolve-message";
import { TRUSTED_RESOLVER_ADDRESS } from "@/lib/market/trusted-resolver";
import type { Market, OutcomeSide } from "@/lib/types/market";
import { cn } from "@/lib/utils/cn";

type Props = {
  market: Market;
};

function isTrustedResolverConnected(
  connected: boolean,
  publicKey: PublicKey | null,
): boolean {
  return (
    connected && publicKey?.toBase58() === TRUSTED_RESOLVER_ADDRESS
  );
}

export function MarketResolverPanel({ market }: Props) {
  const router = useRouter();
  const { publicKey, connected, signMessage } = useWallet();
  const [outcome, setOutcome] = useState<OutcomeSide>("yes");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    console.info(
      "[predicted][ui-state-trace]",
      JSON.stringify({
        component: "MarketResolverPanel",
        slug: market.id,
        propName: "market",
        displayedPhase: market.phase,
        displayedResolutionStatus: market.resolution.status,
      }),
    );
  }, [market.id, market.phase, market.resolution.status]);

  const onResolve = useCallback(async () => {
    setError(null);
    if (market.resolution.status === "resolved") {
      setError("Already resolved.");
      return;
    }
    if (!isTrustedResolverConnected(connected, publicKey)) {
      return;
    }
    if (!signMessage) {
      setError("This wallet cannot sign messages.");
      return;
    }

    setBusy(true);
    const message = buildMarketResolveMessageV1(market.id, outcome);
    const enc = new TextEncoder();
    let signatureB64: string;
    try {
      const sig = await signMessage(enc.encode(message));
      signatureB64 = Buffer.from(sig).toString("base64");
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : "Sign failed");
      return;
    }

    try {
      const res = await fetch("/api/market/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: market.id,
          winningOutcome: outcome,
          message,
          signature: signatureB64,
        }),
      });
      const data = (await res.json()) as { error?: string; ok?: boolean };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Resolve failed");
        return;
      }
      setDone(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }, [
    connected,
    publicKey,
    market.id,
    market.resolution.status,
    outcome,
    router,
    signMessage,
  ]);

  if (
    market.resolution.status === "resolved" ||
    market.phase === "raising" ||
    (market.phase !== "trading" && market.phase !== "resolving")
  ) {
    return null;
  }

  if (!isTrustedResolverConnected(connected, publicKey)) {
    return null;
  }

  if (done) {
    return (
      <div className="rounded-xl bg-[#111] p-4 ring-1 ring-emerald-500/20">
        <p className="text-[13px] font-medium text-emerald-200/95">
          Resolution recorded. Refreshing…
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-[#111] p-4 ring-1 ring-amber-500/15">
      <h3 className="text-[12px] font-semibold text-amber-100/90">
        Set outcome
      </h3>
      <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
        You may post the final result for this market. Sign the resolution
        message with the configured resolver key.
      </p>
      {Number.isFinite(Date.parse(market.resolution.resolveAfter)) ? (
        <p className="mt-1.5 text-[10px] text-zinc-600">
          Scheduled market end (informational):{" "}
          {new Date(market.resolution.resolveAfter).toLocaleString()}
        </p>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setOutcome("yes")}
          className={cn(
            "rounded-lg py-2.5 text-[12px] font-semibold",
            outcome === "yes"
              ? "bg-emerald-500 text-black"
              : "bg-white/[0.05] text-zinc-500",
          )}
        >
          Yes wins
        </button>
        <button
          type="button"
          onClick={() => setOutcome("no")}
          className={cn(
            "rounded-lg py-2.5 text-[12px] font-semibold",
            outcome === "no"
              ? "bg-red-600 text-white"
              : "bg-white/[0.05] text-zinc-500",
          )}
        >
          No wins
        </button>
      </div>

      {error && (
        <p className="mt-2 text-[11px] text-red-300/90">{error}</p>
      )}

      <button
        type="button"
        disabled={
          busy ||
          market.resolution.resolverWallet !== TRUSTED_RESOLVER_ADDRESS
        }
        onClick={() => {
          void onResolve();
        }}
        className="mt-3 w-full min-h-[44px] rounded-xl border border-white/10 bg-amber-500/90 py-2.5 text-[13px] font-semibold text-black transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? "Signing…" : "Sign & resolve"}
      </button>
    </div>
  );
}

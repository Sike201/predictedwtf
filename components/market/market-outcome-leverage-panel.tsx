"use client";

import { memo, useCallback, useRef, useState } from "react";

import { MarketLeverageSection } from "@/components/market/market-leverage-section";
import { useWallet } from "@/lib/hooks/use-wallet";
import { useMarketTradingBalances } from "@/lib/hooks/use-market-trading-balances";
import type { OmnipairUserPositionSnapshot } from "@/lib/hooks/use-omnipair-user-position";
import type { Market } from "@/lib/types/market";

type Props = {
  market: Market;
  snapshot: OmnipairUserPositionSnapshot | null;
  onAfterTx: (detail?: { signature?: string }) => void | Promise<void>;
};

function snapshotKey(snapshot: OmnipairUserPositionSnapshot | null): string {
  if (snapshot == null) return "null";
  return [
    snapshot.userPositionPda ?? "",
    snapshot.collateralYesAtoms,
    snapshot.collateralNoAtoms,
    snapshot.debtYesAtoms,
    snapshot.debtNoAtoms,
  ].join("|");
}

function marketOutcomeLeveragePropsEqual(prev: Props, next: Props): boolean {
  if (prev.onAfterTx !== next.onAfterTx) return false;
  if (prev.market.id !== next.market.id) return false;
  if (prev.market.pool?.poolId !== next.market.pool?.poolId) return false;
  if (snapshotKey(prev.snapshot) !== snapshotKey(next.snapshot)) return false;
  return true;
}

/**
 * Outcome-token leverage only (wallet YES/NO collateral). Lives in the Trade
 * panel **Leverage** tab; spot buy/sell is Buy / Sell.
 */
const MarketOutcomeLeveragePanelInner = function MarketOutcomeLeveragePanel({
  market,
  snapshot,
  onAfterTx,
}: Props) {
  const { publicKey, connected } = useWallet();
  const balances = useMarketTradingBalances(market, publicKey);
  const [positionWarningSig, setPositionWarningSig] = useState<string | null>(
    null,
  );

  const sk = snapshotKey(snapshot);
  const renderCountRef = useRef(0);
  const prevPropsRef = useRef<{
    snap: string;
    marketId: string;
    onAfter: Props["onAfterTx"];
  } | null>(null);

  const pool = market.pool;
  const hasAnyOutcome =
    connected && !balances.loading && (balances.yesRaw > 0n || balances.noRaw > 0n);

  const verifyPositionAfterTx = useCallback(
    async (signature: string) => {
      if (!publicKey || !pool?.poolId) return;
      const qs = new URLSearchParams({
        slug: market.id,
        wallet: publicKey.toBase58(),
      });
      try {
        const res = await fetch(`/api/market/omnipair-position?${qs.toString()}`, {
          credentials: "same-origin",
        });
        const data = (await res.json()) as {
          snapshot?: {
            collateralYesAtoms: string;
            collateralNoAtoms: string;
            debtYesAtoms: string;
            debtNoAtoms: string;
          } | null;
        };
        const s = data.snapshot;
        const meaningful =
          s &&
          (BigInt(s.collateralYesAtoms) > 0n ||
            BigInt(s.collateralNoAtoms) > 0n ||
            BigInt(s.debtYesAtoms) > 0n ||
            BigInt(s.debtNoAtoms) > 0n);
        setPositionWarningSig(!meaningful ? signature : null);
      } catch {
        setPositionWarningSig(signature);
      }
    },
    [market.id, pool?.poolId, publicKey],
  );

  const onSettled = useCallback(
    async (detail?: { signature: string }) => {
      balances.refresh();
      await Promise.resolve(
        onAfterTx(detail ? { signature: detail.signature } : undefined),
      );
      const sig = detail?.signature;
      if (sig) await verifyPositionAfterTx(sig);
    },
    [balances.refresh, onAfterTx, verifyPositionAfterTx],
  );

  if (!pool?.poolId) return null;

  if (!connected || !publicKey) {
    return (
      <p className="text-[11px] leading-relaxed text-zinc-600">
        Connect a wallet to use leverage.
      </p>
    );
  }

  renderCountRef.current += 1;
  if (process.env.NODE_ENV === "development") {
    const p = prevPropsRef.current;
    const changed: string[] = [];
    if (p) {
      if (p.snap !== sk) changed.push("snapshot");
      if (p.marketId !== market.id) changed.push("marketId");
      if (p.onAfter !== onAfterTx) changed.push("onAfterTx");
    }
    console.info(
      "[predicted][leverage-refresh-debug]",
      JSON.stringify({
        cause: !p
          ? "mount"
          : changed.length
            ? `props:${changed.join(",")}`
            : "reconcile",
        component: "MarketOutcomeLeveragePanel",
        changedInputs: changed.length ? changed : undefined,
        rerenderCount: renderCountRef.current,
        inputs: { marketId: market.id, snapshotKey: sk },
      }),
    );
    prevPropsRef.current = { snap: sk, marketId: market.id, onAfter: onAfterTx };
  }

  const emptyNoOutcome =
    !balances.loading && balances.yesRaw <= 0n && balances.noRaw <= 0n;
  const loadingNoOutcome = balances.loading && !hasAnyOutcome;

  const expandedBody = emptyNoOutcome ? (
    <p className="text-[11px] leading-relaxed text-zinc-600">
      Buy YES or NO in Trade, then open leverage with your wallet balance here.
    </p>
  ) : loadingNoOutcome ? (
    <p className="text-[11px] text-zinc-600">Loading balances…</p>
  ) : (
    <>
      <MarketLeverageSection
        market={market}
        hideSectionTitle
        omnipairPosition={
          snapshot?.userPositionPda
            ? {
                collateralYesAtoms: snapshot.collateralYesAtoms,
                collateralNoAtoms: snapshot.collateralNoAtoms,
                debtYesAtoms: snapshot.debtYesAtoms,
                debtNoAtoms: snapshot.debtNoAtoms,
              }
            : null
        }
        onSettled={onSettled}
      />
      {positionWarningSig ? (
        <p className="mt-3 border-t border-white/[0.06] pt-3 text-[10px] leading-relaxed text-amber-200/90">
          Transaction confirmed, but no leverage position was detected yet. Check
          the explorer or refresh in a few seconds.
        </p>
      ) : null}
    </>
  );

  return <div className="space-y-2">{expandedBody}</div>;
};

export const MarketOutcomeLeveragePanel = memo(
  MarketOutcomeLeveragePanelInner,
  marketOutcomeLeveragePropsEqual,
);

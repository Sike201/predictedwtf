"use client";

import { useCallback, useState } from "react";

import { MarketLeverageSection } from "@/components/market/market-leverage-section";
import { useWallet } from "@/lib/hooks/use-wallet";
import { useMarketTradingBalances } from "@/lib/hooks/use-market-trading-balances";
import type { OmnipairUserPositionSnapshot } from "@/lib/hooks/use-omnipair-user-position";
import type { Market } from "@/lib/types/market";

type Props = {
  market: Market;
  snapshot: OmnipairUserPositionSnapshot | null;
  onAfterTx: () => void | Promise<void>;
};

/**
 * Outcome-token leverage only (wallet YES/NO collateral). Lives in the Trade
 * panel **Leverage** tab; spot buy/sell is Buy / Sell.
 */
export function MarketOutcomeLeveragePanel({
  market,
  snapshot,
  onAfterTx,
}: Props) {
  const { publicKey, connected } = useWallet();
  const balances = useMarketTradingBalances(market, publicKey);
  const [positionWarningSig, setPositionWarningSig] = useState<string | null>(
    null,
  );

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
      await Promise.resolve(onAfterTx());
      const sig = detail?.signature;
      if (sig) await verifyPositionAfterTx(sig);
    },
    [balances, onAfterTx, verifyPositionAfterTx],
  );

  if (!pool?.poolId) return null;

  if (!connected || !publicKey) {
    return (
      <p className="text-[11px] leading-relaxed text-zinc-600">
        Connect a wallet to use leverage.
      </p>
    );
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
}

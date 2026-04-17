"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@/lib/hooks/use-wallet";
import type { Market, DateOutcomeOption } from "@/lib/types/market";
import { MarketTradingPrimaryButton } from "@/components/market/market-trading-primary-button";
import { TxExplorerLink } from "@/components/market/tx-explorer-link";
import { pushRecentMarketTransaction } from "@/lib/market/recent-market-transactions";
import { cn } from "@/lib/utils/cn";

type Props = {
  market: Market;
};

export function DateTradingPanel({ market }: Props) {
  const { publicKey } = useWallet();
  const outcomes = market.dateOutcomes ?? [];
  const [selected, setSelected] = useState<DateOutcomeOption | null>(
    outcomes[0] ?? null,
  );
  const [amount, setAmount] = useState("0");
  const [tradeSuccess, setTradeSuccess] = useState<{
    signature: string;
    amountLabel: string;
    windowLabel: string;
  } | null>(null);

  useEffect(() => {
    setTradeSuccess(null);
  }, [amount, selected?.id]);

  const price = selected?.probability ?? 0;
  const pct = Math.round(price * 100);
  const parsedAmt = Number.parseFloat(amount.replace(/[^0-9.]/g, "")) || 0;
  const payout = useMemo(() => {
    if (!selected || !Number.isFinite(parsedAmt) || parsedAmt <= 0) return 0;
    if (price <= 0) return 0;
    return parsedAmt / price;
  }, [parsedAmt, price, selected]);

  const bumpAmount = (delta: number) => {
    setAmount(String((parsedAmt || 0) + delta));
  };

  const windowLabel = selected?.label ?? "window";

  return (
    <>
    <div className="rounded-xl bg-[#111] p-4 ring-1 ring-white/[0.06]">
      <p className="text-[10px] text-zinc-600">
        Outcome{" "}
        <span className="font-medium text-zinc-400">
          {selected?.label ?? "—"}
        </span>
      </p>

      <div className="mt-2 flex flex-col gap-1.5">
        {outcomes.map((o) => {
          const active = selected?.id === o.id;
          const p = Math.round(o.probability * 100);
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => setSelected(o)}
              className={cn(
                "flex w-full items-center justify-between border-0 px-4 py-2.5 text-left text-[12px] font-medium transition",
                active
                  ? "rounded-full bg-emerald-600/20 text-emerald-300 ring-1 ring-emerald-500/30"
                  : "trade-field text-zinc-300 hover:text-zinc-100",
              )}
            >
              <span className="truncate pr-2">{o.label}</span>
              <span className="shrink-0 tabular-nums text-zinc-400">{p}%</span>
            </button>
          );
        })}
      </div>

      {/* Amount — primary */}
      <div className="mt-5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-300">
          Amount (USDC)
        </span>
        <div className="trade-field mt-2 flex items-baseline gap-2 px-5 py-4">
          <span className="shrink-0 text-xl font-medium text-zinc-500">$</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0"
            className="min-w-0 flex-1 border-0 bg-transparent text-2xl font-semibold tabular-nums tracking-tight text-white outline-none placeholder:text-zinc-600 sm:text-[1.65rem]"
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {([1, 5, 10, 100] as const).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => bumpAmount(n)}
              className="search-pill px-3 py-1.5 text-[11px] font-medium text-zinc-400 transition hover:text-zinc-200"
            >
              +{n}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setAmount("10000")}
            className="search-pill px-3 py-1.5 text-[11px] font-medium text-zinc-400 transition hover:text-zinc-200"
          >
            Max
          </button>
        </div>
      </div>

      <div className="mt-5 border-t border-white/[0.06] pt-4">
        <h4 className="text-[9px] font-medium uppercase tracking-wide text-zinc-600">
          Borrow
        </h4>
        <p className="mt-1 text-[9px] leading-relaxed text-zinc-600">
          <span className="font-medium text-zinc-500">{windowLabel}</span>{" "}
          markets use the same Omnipair rule: you can only borrow/repay the pool’s two mints (outcome
          tokens), not devnet USDC as a third asset. Native USDC borrow against outcome collateral is not
          available on a YES/NO-only pair.
        </p>
      </div>

      <dl className="mt-4 space-y-0.5 text-[12px]">
        <div className="flex justify-between text-zinc-500">
          <dt>Mid ({selected?.label ?? "—"})</dt>
          <dd className="tabular-nums text-zinc-200">{pct}¢</dd>
        </div>
        <div className="flex justify-between text-zinc-500">
          <dt>Est. payout</dt>
          <dd className="font-medium tabular-nums text-[#22c55e]">
            {payout > 0 ? `$${payout.toFixed(2)}` : "—"}
          </dd>
        </div>
      </dl>

      <MarketTradingPrimaryButton
        market={market}
        side="yes"
        usdcAmountHuman={amount}
        buyLabel={
          selected
            ? `BUY "${selected.label}"`
            : "BUY"
        }
        outcomeDetail={selected?.label}
        onTradeSuccess={({ signature, usdcAmountHuman: amt, outcomeDetail }) => {
          const trimmed = amt.trim() || "0";
          const amountLabel =
            trimmed === "0" || trimmed === ""
              ? "USDC"
              : `${trimmed} USDC`;
          const windowLabel = outcomeDetail ?? selected?.label ?? "Outcome";
          pushRecentMarketTransaction(
            market.id,
            {
              action: "buy_yes",
              amount: amountLabel,
              signature,
              detail: windowLabel,
            },
            publicKey?.toBase58(),
          );
          setTradeSuccess({
            signature,
            amountLabel,
            windowLabel,
          });
        }}
      />

      {tradeSuccess ? (
        <div className="mt-4 rounded-lg border border-emerald-500/25 bg-emerald-950/30 px-3 py-3 ring-1 ring-emerald-500/15">
          <p className="text-[11px] font-medium text-emerald-200/95">
            Transaction confirmed
          </p>
          <p className="mt-1 text-[10px] text-zinc-500">
            {tradeSuccess.windowLabel} · {tradeSuccess.amountLabel}
          </p>
          <div className="mt-2 text-[11px] leading-relaxed">
            <TxExplorerLink signature={tradeSuccess.signature} />
          </div>
        </div>
      ) : null}
    </div>

    </>
  );
}

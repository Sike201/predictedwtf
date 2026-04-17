"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/lib/hooks/use-wallet";
import type { Market } from "@/lib/types/market";
import { marketDisplayMeta } from "@/lib/data/market-presentation";
import {
  MARKET_COMMENTS_UPDATED_EVENT,
  addMarketComment,
  readMarketComments,
  type MarketComment,
} from "@/lib/market/market-comments";
import {
  MARKET_TXS_UPDATED_EVENT,
  filterSwapEntries,
  formatRecentTxAction,
  readRecentMarketTransactions,
  type RecentMarketTxEntry,
} from "@/lib/market/recent-market-transactions";
import {
  devnetAccountExplorerUrl,
  devnetTxExplorerUrl,
  shortenTransactionSignature,
} from "@/lib/utils/solana-explorer";
import { shortAddress } from "@/lib/utils/short-address";
import { cn } from "@/lib/utils/cn";

const TABS = [
  { id: "comments", label: "Comments" },
  { id: "activity", label: "Activity" },
  { id: "holders", label: "Top holders" },
  { id: "rules", label: "Rules" },
] as const;

type TabId = (typeof TABS)[number]["id"];

type Props = {
  market: Market;
};

function formatCommentTime(at: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(at));
  } catch {
    return "";
  }
}

function formatActivityTime(at: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(at));
  } catch {
    return "";
  }
}

export function MarketDetailTabs({ market }: Props) {
  const { publicKey } = useWallet();
  const walletForActivity = publicKey?.toBase58() ?? null;
  const [tab, setTab] = useState<TabId>("comments");
  const { aiOverview } = marketDisplayMeta(market);

  const [comments, setComments] = useState<MarketComment[]>([]);
  const [draft, setDraft] = useState("");
  const [activityRows, setActivityRows] = useState<RecentMarketTxEntry[]>([]);
  const [holdersData, setHoldersData] = useState<{
    yes: { rank: number; owner: string; amountUi: string }[];
    no: { rank: number; owner: string; amountUi: string }[];
  } | null>(null);
  const [holdersLoading, setHoldersLoading] = useState(false);
  const [holdersError, setHoldersError] = useState<string | null>(null);

  useEffect(() => {
    setComments(readMarketComments(market.id));
  }, [market.id]);

  useEffect(() => {
    const handler = (ev: Event) => {
      const ce = ev as CustomEvent<{ slug?: string }>;
      if (ce.detail?.slug === market.id) {
        setComments(readMarketComments(market.id));
      }
    };
    window.addEventListener(MARKET_COMMENTS_UPDATED_EVENT, handler);
    return () => window.removeEventListener(MARKET_COMMENTS_UPDATED_EVENT, handler);
  }, [market.id]);

  useEffect(() => {
    const full = readRecentMarketTransactions(market.id, walletForActivity);
    setActivityRows(filterSwapEntries(full));
  }, [market.id, walletForActivity]);

  useEffect(() => {
    const handler = (ev: Event) => {
      const ce = ev as CustomEvent<{ slug?: string; wallet?: string }>;
      if (ce.detail?.slug !== market.id) return;
      if (
        walletForActivity &&
        ce.detail.wallet &&
        ce.detail.wallet !== walletForActivity
      ) {
        return;
      }
      const full = readRecentMarketTransactions(market.id, walletForActivity);
      setActivityRows(filterSwapEntries(full));
    };
    window.addEventListener(MARKET_TXS_UPDATED_EVENT, handler);
    return () => window.removeEventListener(MARKET_TXS_UPDATED_EVENT, handler);
  }, [market.id, walletForActivity]);

  useEffect(() => {
    if (tab !== "holders") return;
    if (market.kind !== "binary" || !market.pool?.poolId) {
      setHoldersData(null);
      setHoldersError(null);
      setHoldersLoading(false);
      return;
    }
    let cancelled = false;
    setHoldersLoading(true);
    setHoldersError(null);
    void fetch(
      `/api/market/holders?slug=${encodeURIComponent(market.id)}`,
    )
      .then(async (r) => {
        const data = (await r.json()) as {
          error?: string;
          yes?: { rank: number; owner: string; amountUi: string }[];
          no?: { rank: number; owner: string; amountUi: string }[];
        };
        if (!r.ok) {
          throw new Error(data.error ?? "Could not load holders");
        }
        if (!cancelled) {
          setHoldersData({
            yes: data.yes ?? [],
            no: data.no ?? [],
          });
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setHoldersError(e instanceof Error ? e.message : "Failed to load holders");
          setHoldersData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setHoldersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, market.id, market.kind, market.pool?.poolId]);

  const postComment = () => {
    if (
      addMarketComment(market.id, draft, {
        authorWallet: walletForActivity ?? undefined,
      })
    ) {
      setDraft("");
    }
  };

  return (
    <div className="space-y-4">
      <div className="scrollbar-thin flex w-full gap-0.5 overflow-x-auto rounded-full bg-black/40 p-0.5 ring-1 ring-white/[0.06]">
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "shrink-0 rounded-full px-3 py-1.5 text-[12px] font-medium transition",
                active
                  ? "bg-white/[0.1] text-white"
                  : "text-zinc-500 hover:text-zinc-300",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="min-h-[96px] rounded-xl bg-[#111] p-4 ring-1 ring-white/[0.06]">
        {tab === "comments" && (
          <div className="space-y-4">
            <div>
              <label htmlFor={`market-comment-${market.id}`} className="sr-only">
                Write a comment
              </label>
              <textarea
                id={`market-comment-${market.id}`}
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, 2000))}
                placeholder="Share a take on this market…"
                rows={3}
                className="w-full resize-none rounded-lg border border-white/[0.08] bg-black/50 px-3 py-2.5 text-[13px] leading-relaxed text-zinc-100 outline-none ring-0 placeholder:text-zinc-600 focus:border-white/[0.14] focus:bg-black/60"
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[10px] text-zinc-600">
                  {draft.length}/2000 · stored on this device only
                </span>
                <button
                  type="button"
                  onClick={postComment}
                  disabled={!draft.trim()}
                  className="rounded-full bg-white/[0.12] px-4 py-1.5 text-[12px] font-medium text-white transition hover:bg-white/[0.18] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Post
                </button>
              </div>
            </div>
            {comments.length === 0 ? (
              <p className="text-[12px] leading-relaxed text-zinc-500">
                No comments yet. Start the thread above.
              </p>
            ) : (
              <ul className="space-y-3 border-t border-white/[0.06] pt-4">
                {comments.map((c) => (
                  <li
                    key={c.id}
                    className="rounded-lg border border-white/[0.05] bg-black/30 px-3 py-2.5"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                      <span className="font-mono text-[11px] font-medium text-zinc-400">
                        {c.authorWallet
                          ? shortAddress(c.authorWallet, {
                              start: 4,
                              end: 4,
                            })
                          : "Anonymous"}
                      </span>
                      <span className="text-[10px] text-zinc-600">
                        <time dateTime={new Date(c.at).toISOString()}>
                          {formatCommentTime(c.at)}
                        </time>
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-zinc-200">
                      {c.body}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {tab === "activity" && (
          <div className="scrollbar-thin max-h-[min(420px,55vh)] overflow-y-auto pr-1">
            {walletForActivity ? (
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-[12px] font-semibold tracking-tight text-zinc-200">
                  Your activity
                </h3>
                <span className="text-[10px] text-zinc-600">
                  This wallet · this device
                </span>
              </div>
            ) : null}
            {activityRows.length === 0 ? (
              <p className="text-[12px] text-zinc-500">
                {walletForActivity
                  ? "No trades recorded for this wallet on this device yet. Buy and sell from the panel — swaps aggregate here and on the Orderbook tab."
                  : "Connect a wallet to see your session activity for this market."}
              </p>
            ) : (
              <ul className="space-y-3">
                {activityRows.map((row) => (
                  <li
                    key={`${row.signature}-${row.at}`}
                    className="border-b border-white/[0.05] pb-3 text-[12px] last:border-0 last:pb-0"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium text-zinc-200">
                        {formatRecentTxAction(row.action, row.detail)}
                      </span>
                      <time className="text-[10px] tabular-nums text-zinc-600">
                        {formatActivityTime(row.at)}
                      </time>
                    </div>
                    <p className="mt-1 text-zinc-500">{row.amount}</p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className="font-mono text-[10px] text-zinc-600">
                        {shortenTransactionSignature(row.signature, 6, 6)}
                      </span>
                      <a
                        href={devnetTxExplorerUrl(row.signature)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] font-medium text-emerald-400/90 hover:text-emerald-300"
                      >
                        Explorer
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {tab === "holders" &&
          (market.kind !== "binary" || !market.pool?.poolId ? (
            <p className="text-[12px] text-zinc-500">
              Holder breakdown is available for binary markets with a live pool.
            </p>
          ) : (
          <div className="space-y-3">
            <p className="text-[11px] leading-snug text-zinc-600">
              Largest SPL token balances by wallet (pool reserve vaults excluded). Up to 50
              per side from on-chain token accounts.
            </p>
            {holdersLoading ? (
              <p className="text-[12px] text-zinc-500">Loading holders…</p>
            ) : holdersError ? (
              <p className="text-[12px] text-amber-200/90">{holdersError}</p>
            ) : holdersData ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <h4 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-400/90">
                    YES
                  </h4>
                  <div className="scrollbar-thin mt-2 max-h-[220px] overflow-y-auto pr-1">
                    {holdersData.yes.length === 0 ? (
                      <p className="text-[11px] text-zinc-600">No accounts</p>
                    ) : (
                      <ul className="space-y-2">
                        {holdersData.yes.map((h) => (
                          <li
                            key={`${h.rank}-yes-${h.owner}`}
                            className="flex items-baseline justify-between gap-2 border-b border-white/[0.04] pb-2 text-[11px] last:border-0 last:pb-0"
                          >
                            <div className="min-w-0 flex-1">
                              <span className="text-[10px] tabular-nums text-zinc-600">
                                #{h.rank}
                              </span>{" "}
                              <a
                                href={devnetAccountExplorerUrl(h.owner)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-zinc-300 underline decoration-zinc-700 underline-offset-2 hover:text-white"
                              >
                                {shortAddress(h.owner, { start: 4, end: 4 })}
                              </a>
                            </div>
                            <span className="shrink-0 tabular-nums text-zinc-100">
                              {h.amountUi}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
                <div>
                  <h4 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-red-400/90">
                    NO
                  </h4>
                  <div className="scrollbar-thin mt-2 max-h-[220px] overflow-y-auto pr-1">
                    {holdersData.no.length === 0 ? (
                      <p className="text-[11px] text-zinc-600">No accounts</p>
                    ) : (
                      <ul className="space-y-2">
                        {holdersData.no.map((h) => (
                          <li
                            key={`${h.rank}-no-${h.owner}`}
                            className="flex items-baseline justify-between gap-2 border-b border-white/[0.04] pb-2 text-[11px] last:border-0 last:pb-0"
                          >
                            <div className="min-w-0 flex-1">
                              <span className="text-[10px] tabular-nums text-zinc-600">
                                #{h.rank}
                              </span>{" "}
                              <a
                                href={devnetAccountExplorerUrl(h.owner)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-zinc-300 underline decoration-zinc-700 underline-offset-2 hover:text-white"
                              >
                                {shortAddress(h.owner, { start: 4, end: 4 })}
                              </a>
                            </div>
                            <span className="shrink-0 tabular-nums text-zinc-100">
                              {h.amountUi}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          ))}
        {tab === "rules" && (
          <div className="space-y-2 text-[12px] leading-relaxed text-zinc-400">
            <p>{market.resolution.rules}</p>
            <p className="text-[11px] text-zinc-600">
              <span className="font-medium text-zinc-500">Source: </span>
              {market.resolution.source}
            </p>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-4">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-400/90">
          AI overview
        </h3>
        <p className="mt-2 whitespace-pre-line text-[12px] leading-relaxed text-zinc-200">
          {aiOverview}
        </p>
      </div>
    </div>
  );
}

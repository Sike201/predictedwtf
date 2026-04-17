export type RecentMarketTxAction =
  | "buy_yes"
  | "buy_no"
  | "sell_yes"
  | "sell_no"
  | "create_market";

export type RecentMarketTxEntry = {
  action: RecentMarketTxAction;
  /** Human-readable amount, e.g. `12.5 USDC` */
  amount: string;
  signature: string;
  at: number;
  /** Extra context (e.g. date-window label). */
  detail?: string;
};

const KEY = (slug: string, wallet: string) =>
  `predicted:market-txs:${slug}:${wallet}`;

const MAX = 12;

export const MARKET_TXS_UPDATED_EVENT = "predicted:market-txs-updated";

/** Orderbook on-chain activity table listens to refetch after a trade is recorded. */
export const POOL_ACTIVITY_REFRESH_EVENT = "predicted:pool-activity-refresh";

function dispatchUpdated(slug: string, wallet: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(MARKET_TXS_UPDATED_EVENT, { detail: { slug, wallet } }),
  );
  window.dispatchEvent(
    new CustomEvent(POOL_ACTIVITY_REFRESH_EVENT, { detail: { slug } }),
  );
}

export function pushRecentMarketTransaction(
  slug: string,
  entry: Omit<RecentMarketTxEntry, "at"> & { at?: number },
  wallet: string | null | undefined,
): void {
  if (typeof window === "undefined") return;
  const w = wallet?.trim();
  if (!w) return;
  try {
    const at = entry.at ?? Date.now();
    const full: RecentMarketTxEntry = {
      action: entry.action,
      amount: entry.amount,
      signature: entry.signature,
      detail: entry.detail,
      at,
    };
    const raw = localStorage.getItem(KEY(slug, w));
    const prev: RecentMarketTxEntry[] = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(prev)) {
      localStorage.setItem(KEY(slug, w), JSON.stringify([full]));
      dispatchUpdated(slug, w);
      return;
    }
    const next = [
      full,
      ...prev.filter((e) => e.signature !== full.signature),
    ].slice(0, MAX);
    localStorage.setItem(KEY(slug, w), JSON.stringify(next));
    dispatchUpdated(slug, w);
  } catch {
    /* quota / private mode */
  }
}

export function readRecentMarketTransactions(
  slug: string,
  wallet: string | null | undefined,
): RecentMarketTxEntry[] {
  if (typeof window === "undefined") return [];
  const w = wallet?.trim();
  if (!w) return [];
  try {
    const raw = localStorage.getItem(KEY(slug, w));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentMarketTxEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function formatRecentTxAction(
  action: RecentMarketTxAction,
  detail?: string,
): string {
  switch (action) {
    case "buy_yes":
      return detail ? `Buy (${detail})` : "Buy YES";
    case "buy_no":
      return "Buy NO";
    case "sell_yes":
      return detail ? `Sell YES (${detail})` : "Sell YES";
    case "sell_no":
      return detail ? `Sell NO (${detail})` : "Sell NO";
    case "create_market":
      return "Create market";
    default:
      return action;
  }
}

/** Swaps / trades only (excludes market creation) — for orderbook activity. */
export function filterSwapEntries(
  rows: RecentMarketTxEntry[],
): RecentMarketTxEntry[] {
  return rows.filter((e) => e.action !== "create_market");
}

export type SwapSessionSummary = {
  tradeCount: number;
  buyYes: number;
  buyNo: number;
  sellYes: number;
  sellNo: number;
};

export function summarizeSessionSwaps(rows: RecentMarketTxEntry[]): SwapSessionSummary {
  const t = filterSwapEntries(rows);
  let buyYes = 0;
  let buyNo = 0;
  let sellYes = 0;
  let sellNo = 0;
  for (const e of t) {
    switch (e.action) {
      case "buy_yes":
        buyYes += 1;
        break;
      case "buy_no":
        buyNo += 1;
        break;
      case "sell_yes":
        sellYes += 1;
        break;
      case "sell_no":
        sellNo += 1;
        break;
      default:
        break;
    }
  }
  return {
    tradeCount: t.length,
    buyYes,
    buyNo,
    sellYes,
    sellNo,
  };
}

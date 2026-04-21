export type MarketComment = {
  id: string;
  body: string;
  at: number;
  /** Base58 wallet; display shortened. */
  authorWallet?: string;
};

const KEY = (slug: string) => `predicted:market-comments:${slug}`;
const MAX = 200;

export const MARKET_COMMENTS_UPDATED_EVENT = "predicted:market-comments-updated";

function dispatch(slug: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(MARKET_COMMENTS_UPDATED_EVENT, { detail: { slug } }),
  );
}

export function readMarketComments(slug: string): MarketComment[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY(slug));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as MarketComment[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Merge comments stored under any legacy key (slug casing, or row id) so threads stay visible.
 */
export function readMarketCommentsForDisplay(
  slug: string,
  marketRowId?: string | null,
): MarketComment[] {
  if (typeof window === "undefined") return [];
  const keys = new Set<string>();
  keys.add(slug);
  if (slug !== slug.toLowerCase()) keys.add(slug.toLowerCase());
  if (marketRowId && marketRowId !== slug) keys.add(marketRowId);

  const merged = new Map<string, MarketComment>();
  for (const k of keys) {
    for (const c of readMarketComments(k)) {
      merged.set(c.id, c);
    }
  }
  return Array.from(merged.values()).sort((a, b) => b.at - a.at);
}

export function addMarketComment(
  slug: string,
  bodyRaw: string,
  meta?: { authorWallet?: string },
): boolean {
  if (typeof window === "undefined") return false;
  const body = bodyRaw.trim();
  if (!body || body.length > 2000) return false;
  try {
    const prev = readMarketComments(slug);
    const next: MarketComment[] = [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        body,
        at: Date.now(),
        ...(meta?.authorWallet ? { authorWallet: meta.authorWallet } : {}),
      },
      ...prev,
    ].slice(0, MAX);
    localStorage.setItem(KEY(slug), JSON.stringify(next));
    dispatch(slug);
    return true;
  } catch {
    return false;
  }
}

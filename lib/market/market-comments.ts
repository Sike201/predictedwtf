export type MarketComment = {
  id: string;
  body: string;
  at: number;
  /** Base58 wallet; display shortened. */
  authorWallet?: string;
};

const PREFIX = "predicted:market-comments:";
const KEY = (slug: string) => `${PREFIX}${slug}`;
const MAX = 200;

export const MARKET_COMMENTS_UPDATED_EVENT = "predicted:market-comments-updated";

const COMMENTS_REPAIR = "[predicted][comments-repair]";

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

/** All `predicted:market-comments:*` keys in localStorage (browser only). */
export function listAllMarketCommentStorageKeyNames(): string[] {
  if (typeof window === "undefined") return [];
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(PREFIX)) keys.push(k);
  }
  return keys.sort();
}

function readCommentsFromFullKey(fullKey: string): MarketComment[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(fullKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as MarketComment[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Keys that may hold comments for this market: canonical slug, casing, row id,
 * and any legacy key whose suffix matches slug/row-id/prefix heuristics.
 */
export function discoverCommentKeysForMarket(
  slug: string,
  marketRowId?: string | null,
): string[] {
  const out = new Set<string>();
  const addSuffix = (suffix: string) => {
    if (suffix.length > 0) out.add(KEY(suffix));
  };
  addSuffix(slug);
  if (slug !== slug.toLowerCase()) addSuffix(slug.toLowerCase());
  if (marketRowId && marketRowId.length > 0 && marketRowId !== slug) {
    addSuffix(marketRowId);
  }

  for (const full of listAllMarketCommentStorageKeyNames()) {
    const suf = full.startsWith(PREFIX) ? full.slice(PREFIX.length) : full;
    if (suf === slug || suf === slug.toLowerCase()) {
      out.add(full);
      continue;
    }
    if (marketRowId && suf === marketRowId) {
      out.add(full);
      continue;
    }
    if (marketRowId && suf.length >= 8 && marketRowId.includes(suf)) {
      out.add(full);
      continue;
    }
    if (suf.length >= 12 && slug.startsWith(suf)) {
      out.add(full);
      continue;
    }
    if (slug.length >= 12 && suf.startsWith(slug)) {
      out.add(full);
      continue;
    }
  }
  return [...out];
}

/**
 * Merge all discovered keys into `predicted:market-comments:<canonicalSlug>` (idempotent).
 * Comments only ever persist in localStorage — this recovers legacy keys.
 */
export function migrateMarketCommentsToCanonical(
  canonicalSlug: string,
  marketRowId?: string | null,
): {
  keysFound: string[];
  counts: Record<string, number>;
  migratedCount: number;
  finalCount: number;
} {
  if (typeof window === "undefined") {
    return { keysFound: [], counts: {}, migratedCount: 0, finalCount: 0 };
  }

  const keys = discoverCommentKeysForMarket(canonicalSlug, marketRowId);
  const counts: Record<string, number> = {};
  const merged = new Map<string, MarketComment>();

  for (const fullKey of keys) {
    const list = readCommentsFromFullKey(fullKey);
    counts[fullKey] = list.length;
    for (const c of list) merged.set(c.id, c);
  }

  const mergedList = Array.from(merged.values())
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX);

  const canonicalKey = KEY(canonicalSlug);
  const before = readCommentsFromFullKey(canonicalKey).length;

  try {
    localStorage.setItem(canonicalKey, JSON.stringify(mergedList));
  } catch {
    return {
      keysFound: keys,
      counts,
      migratedCount: 0,
      finalCount: before,
    };
  }

  const finalCount = mergedList.length;
  const migratedCount = Math.max(0, finalCount - before);

  return { keysFound: keys, counts, migratedCount, finalCount };
}

/**
 * Merge comments stored under any legacy key so threads stay visible.
 */
export function readMarketCommentsForDisplay(
  slug: string,
  marketRowId?: string | null,
): MarketComment[] {
  if (typeof window === "undefined") return [];
  const keys = discoverCommentKeysForMarket(slug, marketRowId);
  const merged = new Map<string, MarketComment>();
  for (const fullKey of keys) {
    for (const c of readCommentsFromFullKey(fullKey)) {
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

/** Dev: log comment repair stats (localStorage only). */
export function logCommentsRepairDev(payload: {
  keysFound: string[];
  counts: Record<string, number>;
  migratedCount: number;
  finalCount: number;
}): void {
  if (process.env.NODE_ENV !== "development") return;
  const rawSumAcrossKeys = Object.values(payload.counts).reduce((a, b) => a + b, 0);
  console.info(COMMENTS_REPAIR, "keys_found", {
    keys: payload.keysFound,
    countsPerKey: payload.counts,
    rawSumAcrossKeys,
  });
  console.info(COMMENTS_REPAIR, "migrated_count", { count: payload.migratedCount });
  console.info(COMMENTS_REPAIR, "final_count", { count: payload.finalCount });
}

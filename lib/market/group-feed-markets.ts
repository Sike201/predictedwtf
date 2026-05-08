import type { Market, MarketDraft } from "@/lib/types/market";

/**
 * Common binary winner phrasing: candidate + shared event tail.
 * Pattern A: Will X win …?
 * Pattern B: X wins …?
 * Pattern C: Does X win …?
 * Pattern D: Can X win …?
 */
const WINNER_QUESTION_RES: RegExp[] = [
  /^will\s+(.+?)\s+win\s+(?:the\s+)?(?:next\s+)?(.+?)\??\s*$/i,
  /^(.+?)\s+wins\s+(?:the\s+)?(?:next\s+)?(.+?)\??\s*$/i,
  /^does\s+(.+?)\s+win\s+(?:the\s+)?(?:next\s+)?(.+?)\??\s*$/i,
  /^can\s+(.+?)\s+win\s+(?:the\s+)?(?:next\s+)?(.+?)\??\s*$/i,
];

const NONE_OF_THEM_RES: ReadonlyArray<{
  re: RegExp;
  tailGroup: 1 | 2;
}> = [
  {
    re: /^will\s+none\s+of\s+the\s+(?:listed\s+)?options?\s+win\s+(?:the\s+)?(?:next\s+)?(.+?)\??\s*$/i,
    tailGroup: 1,
  },
  {
    re: /^will\s+none\s+of\s+them\s*(?:\([^)]*\))?\s+win\s+(?:the\s+)?(?:next\s+)?(.+?)\??\s*$/i,
    tailGroup: 1,
  },
  {
    re: /^does\s+none\s+of\s+the\s+(?:listed\s+)?options?\s+win\s+(?:the\s+)?(?:next\s+)?(.+?)\??\s*$/i,
    tailGroup: 1,
  },
  {
    re: /^does\s+none\s+of\s+them\s*(?:\([^)]*\))?\s+win\s+(?:the\s+)?(?:next\s+)?(.+?)\??\s*$/i,
    tailGroup: 1,
  },
  {
    re: /^can\s+none\s+of\s+the\s+(?:listed\s+)?options?\s+win\s+(?:the\s+)?(?:next\s+)?(.+?)\??\s*$/i,
    tailGroup: 1,
  },
  {
    re: /^can\s+none\s+of\s+them\s*(?:\([^)]*\))?\s+win\s+(?:the\s+)?(?:next\s+)?(.+?)\??\s*$/i,
    tailGroup: 1,
  },
  {
    re: /^none\s+of\s+the\s+(?:listed\s+)?options?\s+wins?\s+(?:the\s+)?(?:next\s+)?(.+?)\??\s*$/i,
    tailGroup: 1,
  },
  /** "None of them …" / "None of them (comma names in parens) …" — outcome label always "None of them". */
  {
    re: /^none\s+of\s+them\s*(?:\([^)]*\))?\s+wins?\s+(?:the\s+)?(?:next\s+)?(.+?)\??\s*$/i,
    tailGroup: 1,
  },
  /**
   * "None of Cuddly, Matt, … win(s) …" — discard name list; same groupKey as other winner markets.
   */
  {
    re: /^none\s+of\s+(?!them\b)(.+?)\s+wins?\s+(?:the\s+)?(?:next\s+)?(.+?)\??\s*$/i,
    tailGroup: 2,
  },
];

export const NONE_OF_THEM_OUTCOME_LABEL = "None of them";

export const DRAW_OUTCOME_LABEL = "Draw";

/** Stable URL / DB slug from human event title (shared group key). */
export function slugifyEventGroupKey(title: string): string {
  let s = title.trim().toLowerCase();
  s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  s = s.replace(/[^a-z0-9]+/g, "-");
  s = s.replace(/-+/g, "-").replace(/^-|-$/g, "");
  return s.slice(0, 96) || "event";
}

/**
 * Normalize group keys for equality (hyphen slug, lowercase).
 * Works for parser tails with spaces and for stored slugs.
 */
export function normalizeStoredGroupKey(key: string): string {
  let s = key;
  try {
    s = decodeURIComponent(s);
  } catch {
    /* ignore */
  }
  s = s.trim().toLowerCase();
  s = s.replace(/[_\s/]+/g, "-");
  s = s.replace(/[^a-z0-9-]+/g, "-");
  s = s.replace(/-+/g, "-").replace(/^-|-$/g, "");
  return s;
}

export type ParsedWillWin = {
  candidate: string;
  eventTail: string;
};

export type GroupMeta = {
  groupKey: string;
  outcomeLabel: string;
  eventTailRaw: string;
};

/** Strip leading prose filler so "the next SparkIdeas hackathon" ↔ "SparkIdeas hackathon". */
export function stripLeadingEventFiller(raw: string): string {
  let s = raw.trim();
  for (let i = 0; i < 6; i++) {
    const next = s
      .replace(/^(?:the|next|a|an)\s+/i, "")
      .trim();
    if (next === s) break;
    s = next;
  }
  return s;
}

export function tryParseNoneOfThemQuestion(
  question: string,
): { eventTail: string } | null {
  const q = question.trim();
  for (const { re, tailGroup } of NONE_OF_THEM_RES) {
    const m = q.match(re);
    if (!m) continue;
    const raw = m[tailGroup];
    if (raw == null || typeof raw !== "string") continue;
    let tail = raw.trim().replace(/\s+/g, " ");
    tail = tail.replace(/[?!.]+$/g, "").trim();
    if (!tail) continue;
    return { eventTail: tail };
  }
  return null;
}

/** True for the grouped “none of the listed options / none of them” bin market row. */
export function isNoneOfListedOutcomeDraft(d: MarketDraft): boolean {
  const ol = d.outcomeLabel?.trim();
  if (
    ol &&
    normalizeOutcomeLabel(ol) ===
      normalizeOutcomeLabel(NONE_OF_THEM_OUTCOME_LABEL)
  ) {
    return true;
  }
  if (tryParseNoneOfThemQuestion(d.question)) return true;
  const q = d.question.trim().toLowerCase();
  if (/^will\s+none\s+of\s+the\s+(?:listed\s+)?options?/.test(q)) return true;
  if (/^does\s+none\s+of\s+the\s+(?:listed\s+)?options?/.test(q)) return true;
  if (/^can\s+none\s+of\s+the\s+(?:listed\s+)?options?/.test(q)) return true;
  if (/^none\s+of\s+the\s+(?:listed\s+)?options?\s+wins?\s+/.test(q))
    return true;
  return false;
}

export function tryParseWinnerQuestionInternal(
  question: string,
): ParsedWillWin | null {
  const q = question.trim();
  /** Never treat "none of …" bin markets as a named candidate (e.g. "None of them (A,B) win …"). */
  if (tryParseNoneOfThemQuestion(q)) return null;
  for (const re of WINNER_QUESTION_RES) {
    const m = q.match(re);
    if (!m) continue;
    const candidate = m[1].trim().replace(/\s+/g, " ");
    let tail = m[2].trim().replace(/\s+/g, " ");
    tail = tail.replace(/[?!.]+$/g, "").trim();
    if (!candidate || !tail) continue;
    if (candidate.length > 120) continue;
    return { candidate, eventTail: tail };
  }
  return null;
}

/**
 * Parse a binary "who wins this event?" style question (Will / wins / Does / Can variants).
 */
export function tryParseWillWinBinary(question: string): ParsedWillWin | null {
  return tryParseWinnerQuestionInternal(question);
}

export function normalizeOutcomeLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Stable key shared by all markets in the same event (normalized tail). */
export function normalizeEventGroupKey(eventTail: string): string {
  let s = eventTail.toLowerCase().trim();
  s = s.replace(/[?!.]+$/g, "");
  s = stripLeadingEventFiller(s);
  s = s.replace(/\s+/g, " ");
  return s.trim();
}

export function groupMetaFromQuestion(question: string): GroupMeta | null {
  const none = tryParseNoneOfThemQuestion(question);
  if (none) {
    const key = normalizeEventGroupKey(none.eventTail);
    if (!key) return null;
    return {
      groupKey: key,
      outcomeLabel: NONE_OF_THEM_OUTCOME_LABEL,
      eventTailRaw: none.eventTail,
    };
  }
  const win = tryParseWinnerQuestionInternal(question);
  if (win) {
    const key = normalizeEventGroupKey(win.eventTail);
    if (!key) return null;
    return {
      groupKey: key,
      outcomeLabel: win.candidate.trim(),
      eventTailRaw: win.eventTail,
    };
  }
  return null;
}

export function groupMetaFromMarket(m: Market): GroupMeta | null {
  if (m.kind !== "binary") return null;
  const egk = m.eventGroupKey?.trim();
  const ol = m.outcomeLabel?.trim();
  if (egk && ol) {
    return {
      groupKey: egk,
      outcomeLabel: ol,
      eventTailRaw: m.eventTitle?.trim() || egk,
    };
  }
  return groupMetaFromQuestion(m.question);
}

/** Polymarket-style heading, mirroring create-flow `eventTitle`. */
export function displayTitleForEventTail(eventTail: string): string {
  let raw = eventTail.replace(/[?!.]+$/g, "").trim();
  raw = stripLeadingEventFiller(raw);
  const words = raw.split(/\s+/).filter(Boolean);
  const titled = words
    .map((w) => {
      if (/^[0-9]/.test(w)) return w;
      if (/[a-z]/.test(w) && /[A-Z]/.test(w) && w.length > 2) return w;
      const lower = w.toLowerCase();
      if (lower.length <= 3 && /^[a-z]+$/i.test(w)) return lower;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
  return `${titled} — Winner`;
}

export function eventDisplayTitleFromMarkets(markets: Market[]): string {
  const titled = markets.find((m) => m.eventTitle?.trim())?.eventTitle?.trim();
  if (titled) return titled;

  const noNone = markets.find((m) => {
    const om = groupMetaFromMarket(m);
    return (
      om &&
      normalizeOutcomeLabel(om.outcomeLabel) !==
        normalizeOutcomeLabel(NONE_OF_THEM_OUTCOME_LABEL)
    );
  });
  if (noNone) {
    const w = tryParseWinnerQuestionInternal(noNone.question);
    if (w) return displayTitleForEventTail(w.eventTail);
  }
  const any = markets[0];
  if (any) {
    const nm = tryParseNoneOfThemQuestion(any.question);
    if (nm) return displayTitleForEventTail(nm.eventTail);
    const gm = groupMetaFromMarket(any);
    if (gm) return displayTitleForEventTail(gm.eventTailRaw);
  }
  return "Event — Winner";
}

export function eventPagePathForGroupKey(groupKey: string): string {
  return `/events/${encodeURIComponent(groupKey)}`;
}

function resolutionRank(m: Market): number {
  const s = m.resolution.status;
  if (s === "active") return 0;
  if (s === "resolving") return 1;
  return 2;
}

function volumeOf(m: Market): number {
  const v = m.snapshot?.volumeUsd;
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 0;
}

function pickBestMarketDuplicate(candidates: Market[]): Market {
  return [...candidates].sort((a, b) => {
    const ra = resolutionRank(a);
    const rb = resolutionRank(b);
    if (ra !== rb) return ra - rb;
    const va = volumeOf(a);
    const vb = volumeOf(b);
    if (vb !== va) return vb - va;
    return b.createdAt - a.createdAt;
  })[0]!;
}

/**
 * Collapse duplicate slugs for the same normalized outcome label; dev-warns.
 */
export function dedupeMarketsByGroupedOutcome(
  markets: Market[],
  logGroupKey: string,
): Market[] {
  const labelOrder: string[] = [];
  const byLabel = new Map<string, Market[]>();

  for (const m of markets) {
    const meta = groupMetaFromMarket(m);
    if (!meta) continue;
    const lk = normalizeOutcomeLabel(meta.outcomeLabel);
    if (!byLabel.has(lk)) {
      labelOrder.push(lk);
      byLabel.set(lk, []);
    }
    byLabel.get(lk)!.push(m);
  }

  const out: Market[] = [];
  for (const lk of labelOrder) {
    const arr = byLabel.get(lk)!;
    if (arr.length > 1 && process.env.NODE_ENV === "development") {
      console.warn("Duplicate grouped outcome detected", {
        groupKey: logGroupKey,
        outcomeLabel: groupMetaFromMarket(arr[0]!)?.outcomeLabel,
        slugs: arr.map((x) => x.id),
      });
    }
    out.push(pickBestMarketDuplicate(arr));
  }
  return out;
}

export function sortOutcomesForEventDisplay(markets: Market[]): Market[] {
  const noneNorm = normalizeOutcomeLabel(NONE_OF_THEM_OUTCOME_LABEL);
  const drawNorm = normalizeOutcomeLabel(DRAW_OUTCOME_LABEL);
  const tailBins = (m: Market) => {
    const om = groupMetaFromMarket(m);
    if (!om) return false;
    const n = normalizeOutcomeLabel(om.outcomeLabel);
    return n === noneNorm || n === drawNorm;
  };
  const winners = markets.filter((m) => !tailBins(m));
  const bins = markets.filter((m) => tailBins(m));
  const sortedWinners = [...winners].sort((a, b) => {
    const vb = volumeOf(b);
    const va = volumeOf(a);
    if (vb !== va) return vb - va;
    const pa = Number.isFinite(a.yesProbability) ? a.yesProbability : 0;
    const pb = Number.isFinite(b.yesProbability) ? b.yesProbability : 0;
    if (pb !== pa) return pb - pa;
    const la = outcomeLabelFromMarket(a) ?? a.question;
    const lb = outcomeLabelFromMarket(b) ?? b.question;
    return la.localeCompare(lb, undefined, { sensitivity: "base" });
  });
  const sortedBins = [...bins].sort((a, b) => {
    const oa = normalizeOutcomeLabel(outcomeLabelFromMarket(a) ?? "");
    const ob = normalizeOutcomeLabel(outcomeLabelFromMarket(b) ?? "");
    if (oa === noneNorm && ob !== noneNorm) return 1;
    if (oa !== noneNorm && ob === noneNorm) return -1;
    if (oa === drawNorm && ob !== drawNorm) return 1;
    if (oa !== drawNorm && ob === drawNorm) return -1;
    return oa.localeCompare(ob, undefined, { sensitivity: "base" });
  });
  return [...sortedWinners, ...sortedBins];
}

export function collectMarketsForGroupKey(
  allMarkets: Market[],
  groupKeyQuery: string,
): Market[] {
  const want = normalizeStoredGroupKey(groupKeyQuery);
  if (!want) return [];
  const raw = allMarkets.filter((m) => {
    const meta = groupMetaFromMarket(m);
    return meta && normalizeStoredGroupKey(meta.groupKey) === want;
  });
  return sortOutcomesForEventDisplay(
    dedupeMarketsByGroupedOutcome(raw, want),
  );
}

export function resolveEventGroupForMarket(
  allMarkets: Market[],
  target: Market,
): { groupKey: string; title: string; markets: Market[] } | null {
  const meta = groupMetaFromMarket(target);
  if (!meta) return null;
  const norm = normalizeStoredGroupKey(meta.groupKey);
  const markets = collectMarketsForGroupKey(allMarkets, norm);
  if (markets.length < 2) return null;
  return {
    groupKey: norm,
    title: eventDisplayTitleFromMarkets(markets),
    markets,
  };
}

export function outcomeLabelFromMarket(m: Market): string | null {
  return groupMetaFromMarket(m)?.outcomeLabel ?? null;
}

export type FeedGroupItem = {
  type: "group";
  groupKey: string;
  title: string;
  markets: Market[];
  minIndex: number;
};

export type FeedSingleItem = {
  type: "single";
  market: Market;
  minIndex: number;
};

export type FeedPartitionItem = FeedGroupItem | FeedSingleItem;

/**
 * Cluster binary winner-style questions that share the same normalized event tail
 * (including “none of them” bins). Dedupes duplicate outcomes. Singleton clusters
 * stay as standalone items. Order follows first appearance in `markets`.
 */
export function partitionMarketsForEventGroups(
  markets: Market[],
): FeedPartitionItem[] {
  type Acc = { markets: Market[]; minIndex: number };
  const clusters = new Map<string, Acc>();
  const noKey: { market: Market; index: number }[] = [];

  markets.forEach((m, index) => {
    const meta = groupMetaFromMarket(m);
    if (!meta) {
      noKey.push({ market: m, index });
      return;
    }
    const key = normalizeStoredGroupKey(meta.groupKey);
    const prev = clusters.get(key);
    if (!prev) clusters.set(key, { markets: [m], minIndex: index });
    else {
      prev.markets.push(m);
      prev.minIndex = Math.min(prev.minIndex, index);
    }
  });

  const out: FeedPartitionItem[] = [];

  for (const [groupKey, { markets: ms, minIndex }] of clusters) {
    const deduped = dedupeMarketsByGroupedOutcome(ms, groupKey);
    if (deduped.length >= 2) {
      const ordered = sortOutcomesForEventDisplay(deduped);
      out.push({
        type: "group",
        groupKey,
        title: eventDisplayTitleFromMarkets(ordered),
        markets: ordered,
        minIndex,
      });
    } else {
      out.push({ type: "single", market: deduped[0] ?? ms[0]!, minIndex });
    }
  }

  for (const { market, index } of noKey) {
    out.push({ type: "single", market, minIndex: index });
  }

  out.sort((a, b) => a.minIndex - b.minIndex);
  return out;
}

export function dedupeWinnerDrafts(drafts: MarketDraft[]): MarketDraft[] {
  const seen = new Set<string>();
  const out: MarketDraft[] = [];
  for (const d of drafts) {
    const egk = d.eventGroupKey?.trim();
    const ol = d.outcomeLabel?.trim();
    let k: string;
    if (egk && ol) {
      k = `${normalizeStoredGroupKey(egk)}\0${normalizeOutcomeLabel(ol)}`;
    } else {
      const meta = groupMetaFromQuestion(d.question);
      if (!meta) {
        out.push(d);
        continue;
      }
      k = `${normalizeStoredGroupKey(meta.groupKey)}\0${normalizeOutcomeLabel(meta.outcomeLabel)}`;
    }
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(d);
  }
  return out;
}

/**
 * When two or more winner markets share a group, append a single “none of them” draft.
 */
export function appendNoneOfThemDraftIfNeeded(
  drafts: MarketDraft[],
): MarketDraft[] {
  const winnerMetas = drafts
    .map((d) => ({ d, meta: groupMetaFromQuestion(d.question) }))
    .filter(
      (
        x,
      ): x is {
        d: MarketDraft;
        meta: GroupMeta;
      } =>
        x.meta != null &&
        normalizeOutcomeLabel(x.meta.outcomeLabel) !==
          normalizeOutcomeLabel(NONE_OF_THEM_OUTCOME_LABEL),
    );

  const byGroup = new Map<string, { drafts: MarketDraft[]; meta: GroupMeta }>();
  for (const { d, meta } of winnerMetas) {
    const prev = byGroup.get(meta.groupKey);
    if (!prev) {
      byGroup.set(meta.groupKey, { drafts: [d], meta });
    } else {
      prev.drafts.push(d);
    }
  }

  const extra: MarketDraft[] = [];

  for (const [, { drafts: gdrafts, meta: firstMeta }] of byGroup) {
    if (gdrafts.length < 2) continue;
    const hasNoneForGroup = drafts.some((d) => {
      const gm = groupMetaFromQuestion(d.question);
      return (
        gm != null &&
        normalizeOutcomeLabel(gm.outcomeLabel) ===
          normalizeOutcomeLabel(NONE_OF_THEM_OUTCOME_LABEL) &&
        gm.groupKey === firstMeta.groupKey
      );
    });
    if (hasNoneForGroup) continue;

    const template = gdrafts[0]!;
    const tailPhrase = firstMeta.eventTailRaw.replace(/\?+$/, "").trim();
    const question = `Will none of the listed options win ${tailPhrase}?`;
    extra.push({
      ...template,
      question,
      description: `Resolves YES if none of the listed entrants is announced as the winner for ${stripLeadingEventFiller(firstMeta.eventTailRaw)}. Resolves NO if one of the listed entrants wins.`,
      resolutionRules:
        "YES: None of the named entrants is announced the winner.\nNO: One of the named entrants is announced the winner.",
      aiReasoning: "",
    });
  }

  return [...drafts, ...extra];
}

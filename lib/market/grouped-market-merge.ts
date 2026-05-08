/**
 * Merge AI-proposed grouped drafts with markets that already exist for the same event,
 * so creation extends the group instead of forking duplicates.
 */

import { createClient } from "@supabase/supabase-js";
import type { MarketDraft } from "@/lib/types/market";
import type { MarketRecord } from "@/lib/types/market-record";
import {
  groupMetaFromQuestion,
  normalizeOutcomeLabel,
  normalizeStoredGroupKey,
  slugifyEventGroupKey,
  stripLeadingEventFiller,
} from "@/lib/market/group-feed-markets";

/** Same shape as {@link getSupabaseAdmin} client. */
type SupabaseAdminClient = ReturnType<typeof createClient>;

/** Normalize human event titles for fuzzy equality (lowercase, strip punctuation/filler). */
export function normalizeEventTitleForGroupDedup(raw: string): string {
  let s = raw.trim().toLowerCase();
  s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  s = stripLeadingEventFiller(s);
  s = s.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  return s;
}

const MONTH_NUM = new Map<string, number>([
  ["january", 1],
  ["jan", 1],
  ["february", 2],
  ["feb", 2],
  ["march", 3],
  ["mar", 3],
  ["april", 4],
  ["apr", 4],
  ["may", 5],
  ["june", 6],
  ["jun", 6],
  ["july", 7],
  ["jul", 7],
  ["august", 8],
  ["aug", 8],
  ["september", 9],
  ["sep", 9],
  ["sept", 9],
  ["october", 10],
  ["oct", 10],
  ["november", 11],
  ["nov", 11],
  ["december", 12],
  ["dec", 12],
]);

function monthNameToNum(tok: string): number | null {
  const t = tok.toLowerCase().replace(/\.$/, "").trim();
  return MONTH_NUM.get(t) ?? null;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/**
 * Canonical outcome key for date-style thresholds (May 8, 8th May, May 8th → `05-08`)
 * plus plain {@link normalizeOutcomeLabel} fallback.
 */
export function normalizeOutcomeKeyForGroupedMerge(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  let compact = trimmed.toLowerCase().replace(/,/g, " ");
  compact = compact.replace(/\b(the|a|an|by|on|before)\b/g, " ");
  compact = compact.replace(/\b(threshold|deadline|cutoff|end)\b/g, " ");
  compact = compact.replace(/\s+/g, " ").trim();

  const MONTH =
    "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

  const reDM = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH})\\b`,
    "i",
  );
  const reMD = new RegExp(
    `\\b(${MONTH})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`,
    "i",
  );

  let m = compact.match(reDM);
  if (m) {
    const day = Number(m[1]);
    const mo = monthNameToNum(m[2] ?? "");
    if (mo != null && day >= 1 && day <= 31)
      return `date:${pad2(mo)}-${pad2(day)}`;
  }
  m = compact.match(reMD);
  if (m) {
    const mo = monthNameToNum(m[1] ?? "");
    const day = Number(m[2]);
    if (mo != null && day >= 1 && day <= 31)
      return `date:${pad2(mo)}-${pad2(day)}`;
  }

  return normalizeOutcomeLabel(trimmed);
}

export function tokenSetJaccard(a: string, b: string): number {
  const ta = new Set(
    a
      .trim()
      .split(/\s+/)
      .filter((x) => x.length > 1),
  );
  const tb = new Set(
    b
      .trim()
      .split(/\s+/)
      .filter((x) => x.length > 1),
  );
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const x of ta) {
    if (tb.has(x)) inter += 1;
  }
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function dbStatusRank(s: MarketRecord["status"]): number {
  if (s === "live") return 0;
  if (s === "creating") return 1;
  return 2;
}

/** Prefer live row when duplicate outcome rows exist in DB. */
export function pickBetterGroupedDuplicate(a: MarketRecord, b: MarketRecord): MarketRecord {
  const ra = dbStatusRank(a.status);
  const rb = dbStatusRank(b.status);
  if (ra !== rb) return ra <= rb ? a : b;
  const va = Number(a.last_known_volume_usd ?? 0);
  const vb = Number(b.last_known_volume_usd ?? 0);
  if (vb !== va) return vb >= va ? b : a;
  return Date.parse(b.created_at) >= Date.parse(a.created_at) ? b : a;
}

export function outcomeKeyFromDraftForMerge(d: MarketDraft): string | null {
  const ol = d.outcomeLabel?.trim();
  if (ol) return normalizeOutcomeKeyForGroupedMerge(ol);
  const meta = groupMetaFromQuestion(d.question);
  if (meta?.outcomeLabel) return normalizeOutcomeKeyForGroupedMerge(meta.outcomeLabel);
  return null;
}

function outcomeKeyFromExistingRow(r: MarketRecord): string | null {
  const ol = r.outcome_label?.trim();
  if (ol) return normalizeOutcomeKeyForGroupedMerge(ol);
  const meta = groupMetaFromQuestion(r.title);
  const ol2 = meta?.outcomeLabel?.trim();
  if (ol2) return normalizeOutcomeKeyForGroupedMerge(ol2);
  return null;
}

function displayOutcomeLabelFromDraft(d: MarketDraft): string {
  const ol = d.outcomeLabel?.trim();
  if (ol) return ol;
  const meta = groupMetaFromQuestion(d.question);
  if (meta?.outcomeLabel) return meta.outcomeLabel.trim();
  return d.question.trim().slice(0, 48);
}

function pickCanonicalFromExisting(
  existingMembers: MarketRecord[],
): { key: string; title: string } | null {
  if (!existingMembers.length) return null;
  const sorted = [...existingMembers].sort(
    (a, b) => (a.group_order ?? 999) - (b.group_order ?? 999),
  );
  const row =
    sorted.find((r) => r.event_group_key?.trim() && r.event_title?.trim()) ?? sorted[0];
  const key = row?.event_group_key?.trim();
  const title = row?.event_title?.trim();
  if (!key || !title) return null;
  return { key: normalizeStoredGroupKey(key), title };
}

function attachCanonical(d: MarketDraft, canon: { key: string; title: string }): MarketDraft {
  return {
    ...d,
    eventGroupKey: canon.key,
    eventTitle: canon.title,
  };
}

async function fetchRowsByGroupKey(
  sb: SupabaseAdminClient,
  nk: string,
): Promise<MarketRecord[]> {
  const { data, error } = await sb
    .from("markets")
    .select("*")
    .in("status", ["live", "creating"])
    .eq("event_group_key", nk);
  if (error || !data?.length) return [];
  return data as MarketRecord[];
}

async function fetchGroupedCandidateRows(
  sb: SupabaseAdminClient,
): Promise<MarketRecord[]> {
  const { data, error } = await sb
    .from("markets")
    .select("*")
    .in("status", ["live", "creating"])
    .not("event_group_key", "is", null)
    .limit(900);
  if (error || !data?.length) return [];
  return data as MarketRecord[];
}

function clusterByGroupKey(rows: MarketRecord[]): Map<string, MarketRecord[]> {
  const m = new Map<string, MarketRecord[]>();
  for (const r of rows) {
    const k = r.event_group_key?.trim();
    if (!k) continue;
    const nk = normalizeStoredGroupKey(k);
    const prev = m.get(nk) ?? [];
    prev.push(r);
    m.set(nk, prev);
  }
  return m;
}

/**
 * Discover live/creating rows for an event similar to the proposed group:
 * event_group_key → slugified title → exact normalized event_title → fuzzy token match on titles/questions.
 */
export async function findSimilarGroupedMarketCluster(
  sb: SupabaseAdminClient,
  opts: {
    eventGroupKey?: string | null;
    eventTitle?: string | null;
    draftQuestions?: string[];
  },
): Promise<MarketRecord[]> {
  const nkFromModel = opts.eventGroupKey?.trim()
    ? normalizeStoredGroupKey(opts.eventGroupKey.trim())
    : null;

  if (nkFromModel) {
    const rows = await fetchRowsByGroupKey(sb, nkFromModel);
    if (rows.length) return rows;
  }

  const slugTry = opts.eventTitle?.trim()
    ? normalizeStoredGroupKey(slugifyEventGroupKey(opts.eventTitle.trim()))
    : null;
  if (slugTry && slugTry !== nkFromModel) {
    const rows = await fetchRowsByGroupKey(sb, slugTry);
    if (rows.length) return rows;
  }

  const titleNorm = opts.eventTitle?.trim()
    ? normalizeEventTitleForGroupDedup(opts.eventTitle.trim())
    : "";

  const fingerprints = new Set<string>();
  if (titleNorm.length >= 8) fingerprints.add(titleNorm);
  for (const q of opts.draftQuestions ?? []) {
    const qq = q.trim();
    if (!qq) continue;
    let stem = qq.replace(/\?+$/, "");
    stem = stem.replace(/^will\s+/i, "").replace(/\s+before\s+.+$/i, "").trim();
    const n = normalizeEventTitleForGroupDedup(stem);
    if (n.length >= 10) fingerprints.add(n);
  }

  const grouped = await fetchGroupedCandidateRows(sb);
  if (!grouped.length) return [];

  if (titleNorm.length >= 8) {
    const exact = grouped.filter((r) => {
      const et = r.event_title?.trim();
      return et && normalizeEventTitleForGroupDedup(et) === titleNorm;
    });
    if (exact.length) return exact;
  }

  if (fingerprints.size === 0) return [];

  const clusters = clusterByGroupKey(grouped);
  let bestKey: string | null = null;
  let bestScore = 0;

  for (const [gk, members] of clusters) {
    const repRow =
      [...members].sort(
        (a, b) => (a.group_order ?? 999) - (b.group_order ?? 999),
      )[0] ?? members[0];
    const repTitle = repRow?.event_title?.trim() ?? "";
    const repNorm = normalizeEventTitleForGroupDedup(repTitle);
    const questionsNorm = members
      .map((rec) => normalizeEventTitleForGroupDedup(rec.title.trim()))
      .filter(Boolean);

    let score = 0;
    for (const fp of fingerprints) {
      score = Math.max(score, tokenSetJaccard(fp, repNorm));
      for (const qn of questionsNorm) {
        score = Math.max(score, tokenSetJaccard(fp, qn));
        if (fp.includes(qn) || qn.includes(fp)) score = Math.max(score, 0.72);
      }
      if (fp.includes(repNorm) || repNorm.includes(fp))
        score = Math.max(score, 0.68);
    }

    if (score > bestScore) {
      bestScore = score;
      bestKey = gk;
    }
  }

  const MIN_SCORE = 0.46;
  if (bestKey && bestScore >= MIN_SCORE) {
    const cluster = clusters.get(bestKey);
    if (cluster?.length) return cluster;
  }

  return [];
}

export type GroupReconciliationPayload = {
  headline: string;
  matchedEventTitle: string;
  matchedGroupKey?: string;
  existingOutcomeLabels: string[];
  newOutcomeLabels: string[];
};

export type GroupedMarketMergeResult = {
  /** Only markets that still need POST /create — preview + payload. */
  draftsToCreate: MarketDraft[];
  /** Present when at least one proposed outcome matched an existing row. */
  reconciliation: GroupReconciliationPayload | null;
  mergeNotice: string | undefined;
  reusedCount: number;
  newCount: number;
};

export function formatGroupedMergeAssistantLine(params: {
  /** Reserved for future copy personalization */
  eventTitle?: string;
  reusedCount: number;
  newCount: number;
}): string | undefined {
  const { reusedCount, newCount } = params;
  if (newCount === 0 && reusedCount > 0) {
    return `All outcomes already exist for this event.`;
  }
  if (newCount > 0 && reusedCount > 0) {
    return `${reusedCount} outcome${reusedCount === 1 ? "" : "s"} already exist. ${newCount} new outcome${newCount === 1 ? "" : "s"} will be added.`;
  }
  return undefined;
}

/**
 * Split proposals into DB-backed duplicates vs net-new rows; only net-new appear in {@link GroupedMarketMergeResult.draftsToCreate}.
 */
export function mergeProposedGroupedDraftsWithExistingMembers(params: {
  proposedDrafts: MarketDraft[];
  existingMembers: MarketRecord[];
}): GroupedMarketMergeResult {
  const { proposedDrafts, existingMembers } = params;
  if (existingMembers.length === 0) {
    return {
      draftsToCreate: proposedDrafts,
      reconciliation: null,
      mergeNotice: undefined,
      reusedCount: 0,
      newCount: proposedDrafts.length,
    };
  }

  if (proposedDrafts.length === 0) {
    return {
      draftsToCreate: [],
      reconciliation: null,
      mergeNotice: undefined,
      reusedCount: 0,
      newCount: 0,
    };
  }

  const canon = pickCanonicalFromExisting(existingMembers);
  if (!canon) {
    return {
      draftsToCreate: proposedDrafts,
      reconciliation: null,
      mergeNotice: undefined,
      reusedCount: 0,
      newCount: proposedDrafts.length,
    };
  }

  const byOutcome = new Map<string, MarketRecord>();
  for (const r of existingMembers) {
    const k = outcomeKeyFromExistingRow(r);
    if (!k) continue;
    const prev = byOutcome.get(k);
    byOutcome.set(k, prev ? pickBetterGroupedDuplicate(prev, r) : r);
  }

  function labelFromRecordOutcome(rec: MarketRecord): string {
    return rec.outcome_label?.trim() || rec.title.trim().slice(0, 48);
  }

  let reusedCount = 0;
  const existingMatchedLabels: string[] = [];
  const newOutcomeLabels: string[] = [];
  const draftsToCreate: MarketDraft[] = [];

  for (const d of proposedDrafts) {
    const k = outcomeKeyFromDraftForMerge(d);
    if (!k) {
      const label = displayOutcomeLabelFromDraft(d);
      newOutcomeLabels.push(label);
      draftsToCreate.push(attachCanonical({ ...d }, canon));
      continue;
    }
    const hit = byOutcome.get(k);
    if (hit) {
      reusedCount += 1;
      const lbl =
        hit.outcome_label?.trim() ||
        groupMetaFromQuestion(hit.title)?.outcomeLabel?.trim() ||
        labelFromRecordOutcome(hit);
      if (
        lbl &&
        existingMatchedLabels.every(
          (x) => normalizeOutcomeKeyForGroupedMerge(x) !== k,
        )
      ) {
        existingMatchedLabels.push(lbl);
      }
    } else {
      const label = displayOutcomeLabelFromDraft(d);
      newOutcomeLabels.push(label);
      draftsToCreate.push(attachCanonical({ ...d }, canon));
    }
  }

  const newCount = draftsToCreate.length;
  const reindexed = draftsToCreate.map((row, i) => ({ ...row, groupOrder: i }));

  const mergeNotice = formatGroupedMergeAssistantLine({
    eventTitle: canon.title,
    reusedCount,
    newCount,
  });

  const reconciliation: GroupReconciliationPayload | null =
    reusedCount > 0
      ? {
          headline: "This event already exists.",
          matchedEventTitle: canon.title,
          matchedGroupKey: canon.key,
          existingOutcomeLabels: existingMatchedLabels,
          newOutcomeLabels,
        }
      : null;

  return {
    draftsToCreate: reindexed,
    reconciliation,
    mergeNotice: reusedCount > 0 ? mergeNotice : undefined,
    reusedCount,
    newCount,
  };
}

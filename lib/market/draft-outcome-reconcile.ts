/**
 * Deterministic reconciliation of grouped market drafts when the user edits outcomes in chat.
 * Merges LLM output with the previous draft set so removals/replaces/keep-only stick even if the model
 * returns a stale or append-only markets[] list.
 */

import {
  groupMetaFromQuestion,
  isNoneOfListedOutcomeDraft,
  normalizeOutcomeLabel,
} from "@/lib/market/group-feed-markets";
import type { MarketDraft } from "@/lib/types/market";

export const DRAFT_UPDATE_LOG_PREFIX = "[draft-update]";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Stable comparison key for an outcome row (lowercase, collapsed spaces). */
export function draftOutcomeKey(d: MarketDraft): string {
  const ol = d.outcomeLabel?.trim();
  if (ol) return normalizeOutcomeLabel(ol);
  const m = groupMetaFromQuestion(d.question);
  if (m?.outcomeLabel) return normalizeOutcomeLabel(m.outcomeLabel);
  return normalizeOutcomeLabel(d.question.slice(0, 120));
}

function displayOutcomeLabel(d: MarketDraft): string {
  const ol = d.outcomeLabel?.trim();
  if (ol) return ol;
  const m = groupMetaFromQuestion(d.question);
  if (m?.outcomeLabel) return m.outcomeLabel.trim();
  return d.question.trim().slice(0, 48);
}

function splitOutcomePhrases(blob: string): string[] {
  return blob
    .replace(/\s+/g, " ")
    .split(/\s*(?:,|\/|\band\b)\s*/i)
    .map((x) => x.replace(/^the\s+/i, "").trim())
    .filter(Boolean);
}

function resolvePhrasesToKeys(
  phrases: string[],
  previous: MarketDraft[],
): string[] {
  const prevKeys = [...new Set(previous.map(draftOutcomeKey))];
  const matched = new Set<string>();
  for (const phrase of phrases) {
    const nt = normalizeOutcomeLabel(phrase);
    if (!nt) continue;
    for (const pk of prevKeys) {
      if (pk === nt || pk.includes(nt) || nt.includes(pk)) {
        matched.add(pk);
      }
    }
  }
  return [...matched];
}

function parseKeepOnlyKeys(
  prompt: string,
  previous: MarketDraft[],
): string[] | null {
  const m = prompt.match(/\b(?:only\s+keep|keep\s+only)\s+(.+)/i);
  if (!m?.[1]) return null;
  const blob = m[1].replace(/[.!?]+\s*$/, "").trim();
  const phrases = splitOutcomePhrases(blob);
  if (phrases.length === 0) return null;
  const keys = resolvePhrasesToKeys(phrases, previous);
  return keys.length > 0 ? keys : null;
}

/**
 * User phrases like “remove none of the listed option” refer to the none-bin draft whose key is
 * usually `none of them`, which substring matching against the prompt would otherwise miss.
 */
function promptTargetsRemovalOfNoneBin(prompt: string): boolean {
  const p = prompt.toLowerCase();
  const editCue =
    /\b(remove|delete|drop|omit|exclude|get\s+rid\s+of|take\s+out|scrap)\b/.test(
      p,
    ) ||
    /\b(?:without|excluding)\b/.test(p) ||
    /\bno\s+longer\s+(?:want|need|include)\b/.test(p);
  if (!editCue) return false;
  if (/\bnone\s+of\s+the\s+(?:listed\s+)?options?\b/.test(p)) return true;
  if (/\bnone\s+of\s+them\b/.test(p)) return true;
  if (/\b(remove|delete|drop)\s+(?:the\s+)?none\b/i.test(prompt)) return true;
  if (
    /\bnone\b/.test(p) &&
    /\b(option|choices?|outcomes?|listed)\b/.test(p)
  ) {
    return true;
  }
  return false;
}

function parseRemoveKeys(prompt: string, previous: MarketDraft[]): Set<string> {
  const out = new Set<string>();
  const patterns: RegExp[] = [
    /\b(?:remove|delete|drop|omit|exclude|get\s+rid\s+of|take\s+out|scrap)\s+([^?.!\n]+)/gi,
    /\b(?:without|excluding)\s+([^?.!\n]+)/gi,
    /\bno\s+longer\s+(?:want|need|include)\s+([^?.!\n]+)/gi,
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(prompt)) !== null) {
      const phrases = splitOutcomePhrases(m[1] ?? "");
      for (const k of resolvePhrasesToKeys(phrases, previous)) {
        out.add(k);
      }
    }
  }
  return out;
}

function parseReplaceSpecs(
  prompt: string,
  previous: MarketDraft[],
): { fromKey: string; toRaw: string }[] {
  const raw: { fromKey: string; toRaw: string }[] = [];
  const patterns: RegExp[] = [
    /\breplace\s+(.+?)\s+with\s+([^?.!\n]+)/gi,
    /\bchange\s+(.+?)\s+to\s+([^?.!\n]+)/gi,
    /\bswap\s+(.+?)\s+(?:for|with)\s+([^?.!\n]+)/gi,
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(prompt)) !== null) {
      const fromPhrases = splitOutcomePhrases(m[1] ?? "");
      const toRaw = (m[2] ?? "").trim();
      if (!toRaw) continue;
      const fromKeys = resolvePhrasesToKeys(fromPhrases, previous);
      for (const fk of fromKeys) {
        raw.push({ fromKey: fk, toRaw });
      }
    }
  }
  const seen = new Set<string>();
  const specs: { fromKey: string; toRaw: string }[] = [];
  for (const s of raw) {
    if (seen.has(s.fromKey)) continue;
    seen.add(s.fromKey);
    specs.push(s);
  }
  return specs;
}

function parseAddPhrases(prompt: string): string[] {
  const out: string[] = [];
  const re =
    /\b(?:add|include|also\s+add|throw\s+in)\s+([^?.!\n]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt)) !== null) {
    out.push(...splitOutcomePhrases(m[1] ?? ""));
  }
  return [...new Set(out.map((x) => x.trim()).filter(Boolean))];
}

function mergeDraftPreserveRow(dPrev: MarketDraft, dLlm: MarketDraft): MarketDraft {
  return {
    ...dLlm,
    outcomeLabel: dPrev.outcomeLabel ?? dLlm.outcomeLabel,
    eventGroupKey: dPrev.eventGroupKey ?? dLlm.eventGroupKey,
    eventTitle: dPrev.eventTitle ?? dLlm.eventTitle,
    outcomeType: dPrev.outcomeType ?? dLlm.outcomeType,
    groupOrder: dPrev.groupOrder ?? dLlm.groupOrder,
  };
}

function cloneDraftNewOutcome(
  template: MarketDraft,
  oldDisplay: string,
  newLabelRaw: string,
): MarketDraft {
  const newLabel = newLabelRaw.trim();
  const q = template.question.replace(
    new RegExp(`\\b${escapeRegExp(oldDisplay)}\\b`, "gi"),
    newLabel,
  );
  const desc = template.description.replace(
    new RegExp(`\\b${escapeRegExp(oldDisplay)}\\b`, "gi"),
    newLabel,
  );
  const rules = template.resolutionRules.replace(
    new RegExp(`\\b${escapeRegExp(oldDisplay)}\\b`, "gi"),
    newLabel,
  );
  return {
    ...template,
    question: q,
    description: desc,
    resolutionRules: rules,
    outcomeLabel: newLabel,
    aiReasoning: template.aiReasoning,
  };
}

function llmDraftsByKey(llmDrafts: MarketDraft[]): Map<string, MarketDraft> {
  const m = new Map<string, MarketDraft>();
  for (const d of llmDrafts) {
    m.set(draftOutcomeKey(d), d);
  }
  return m;
}

export type DraftOutcomeReconcileResult = {
  drafts: MarketDraft[];
  /** When set, prefer this assistant line over generic client placeholders. */
  acknowledgment?: string;
  /** True when deterministic reconciliation changed the outcome set or merged rows. */
  reconciliationApplied: boolean;
};

/**
 * When the user already has 2+ drafts (group), reconcile LLM `markets[]` with `previousDrafts`
 * using parsed edit intents so outcomes are not append-only.
 */
export function reconcileGroupedDraftOutcomeMutations(params: {
  userPrompt: string;
  previousDrafts: MarketDraft[];
  llmDrafts: MarketDraft[];
}): DraftOutcomeReconcileResult {
  const { userPrompt, previousDrafts, llmDrafts } = params;

  if (previousDrafts.length <= 1) {
    return { drafts: llmDrafts, reconciliationApplied: false };
  }

  const prevKeys = previousDrafts.map(draftOutcomeKey);

  const keepOnlyKeys = parseKeepOnlyKeys(userPrompt, previousDrafts);
  let removedKeys = parseRemoveKeys(userPrompt, previousDrafts);
  if (promptTargetsRemovalOfNoneBin(userPrompt)) {
    for (const d of previousDrafts) {
      if (isNoneOfListedOutcomeDraft(d)) removedKeys.add(draftOutcomeKey(d));
    }
  }
  const replaceSpecs = parseReplaceSpecs(userPrompt, previousDrafts);
  const addPhrases = parseAddPhrases(userPrompt);

  const replacedFromKeys = new Set(replaceSpecs.map((s) => s.fromKey));
  for (const k of replacedFromKeys) {
    removedKeys.add(k);
  }

  let base = [...previousDrafts];

  if (keepOnlyKeys && keepOnlyKeys.length > 0) {
    const keepSet = new Set(keepOnlyKeys);
    base = base.filter((d) => keepSet.has(draftOutcomeKey(d)));
  }

  base = base.filter((d) => !removedKeys.has(draftOutcomeKey(d)));

  const llmByKey = llmDraftsByKey(llmDrafts);

  const forbidKeys = new Set<string>([...removedKeys, ...replacedFromKeys]);
  /* Outcomes dropped by keep-only (or any shrink of base vs previous) must not be re-appended from stale llmDrafts[]. */
  const baseKeySet = new Set(base.map(draftOutcomeKey));
  for (const d of previousDrafts) {
    const k = draftOutcomeKey(d);
    if (!baseKeySet.has(k)) forbidKeys.add(k);
  }

  const out: MarketDraft[] = [];

  for (const d of base) {
    const k = draftOutcomeKey(d);
    const patch = llmByKey.get(k);
    out.push(patch ? mergeDraftPreserveRow(d, patch) : { ...d });
  }

  const outKeys = new Set(out.map(draftOutcomeKey));

  for (const spec of replaceSpecs) {
    const template =
      previousDrafts.find((d) => draftOutcomeKey(d) === spec.fromKey) ?? null;
    if (!template) continue;
    const toNorm = normalizeOutcomeLabel(spec.toRaw);
    let row =
      llmByKey.get(toNorm) ??
      [...llmByKey.values()].find(
        (d) =>
          normalizeOutcomeLabel(d.outcomeLabel ?? "") === toNorm ||
          d.question.toLowerCase().includes(spec.toRaw.toLowerCase()),
      );
    if (!row) {
      row = cloneDraftNewOutcome(
        template,
        displayOutcomeLabel(template),
        spec.toRaw,
      );
    } else {
      row = mergeDraftPreserveRow(
        {
          ...template,
          outcomeLabel: spec.toRaw.trim(),
          groupOrder: template.groupOrder,
        },
        row,
      );
    }
    const rk = draftOutcomeKey(row);
    if (!forbidKeys.has(rk) && !outKeys.has(rk)) {
      out.push(row);
      outKeys.add(rk);
    }
  }

  for (const ld of llmDrafts) {
    const k = draftOutcomeKey(ld);
    if (forbidKeys.has(k)) continue;
    if (!outKeys.has(k)) {
      out.push(ld);
      outKeys.add(k);
    }
  }

  for (const phrase of addPhrases) {
    const kn = normalizeOutcomeLabel(phrase);
    if (!kn || outKeys.has(kn)) continue;
    const row =
      llmByKey.get(kn) ??
      [...llmByKey.values()].find(
        (d) =>
          normalizeOutcomeLabel(d.outcomeLabel ?? "") === kn ||
          d.question.toLowerCase().includes(phrase.toLowerCase()),
      );
    if (row && !forbidKeys.has(draftOutcomeKey(row))) {
      const dk = draftOutcomeKey(row);
      if (!outKeys.has(dk)) {
        out.push(row);
        outKeys.add(dk);
      }
    }
  }

  const prevSig = prevKeys.slice().sort().join("|");
  const nextSig = out.map(draftOutcomeKey).sort().join("|");
  const structureChanged = prevSig !== nextSig;
  const countChanged = out.length !== previousDrafts.length;

  const reconciliationApplied =
    structureChanged ||
    countChanged ||
    keepOnlyKeys != null ||
    removedKeys.size > 0 ||
    replaceSpecs.length > 0 ||
    addPhrases.length > 0;

  const prevKeySet = new Set(prevKeys);
  const nextKeySet = new Set(out.map(draftOutcomeKey));
  const removedForLog = [...prevKeySet].filter((k) => !nextKeySet.has(k));
  const addedForLog = [...nextKeySet].filter((k) => !prevKeySet.has(k));

  let intent = "merge_patch";
  if (keepOnlyKeys && keepOnlyKeys.length > 0) intent = "keep_only";
  else if (replaceSpecs.length > 0) intent = "replace_outcome";
  else if (removedKeys.size > 0) intent = "remove_outcome";
  else if (addPhrases.length > 0) intent = "add_outcome";

  const replacedFromSet = new Set(replaceSpecs.map((s) => s.fromKey));
  const removedForAck = removedForLog.filter((k) => !replacedFromSet.has(k));

  console.info(
    DRAFT_UPDATE_LOG_PREFIX,
    JSON.stringify({
      intent,
      prev: previousDrafts.map((d) => displayOutcomeLabel(d)),
      next: out.map((d) => displayOutcomeLabel(d)),
      removedKeys: removedForLog,
      addedKeys: addedForLog,
      keepOnlyKeys: keepOnlyKeys ?? null,
      replaceSpecs: replaceSpecs.map((s) => ({
        from: s.fromKey,
        to: s.toRaw,
      })),
      addPhrases,
    }),
  );

  let acknowledgment: string | undefined;
  if (reconciliationApplied && structureChanged) {
    const parts: string[] = [];
    if (removedForAck.length > 0) {
      const labels = removedForAck.map((k) => {
        const d = previousDrafts.find((x) => draftOutcomeKey(x) === k);
        return d ? displayOutcomeLabel(d) : k;
      });
      parts.push(`Removed ${labels.join(", ")} from the outcomes.`);
    }
    if (replaceSpecs.length > 0) {
      for (const s of replaceSpecs) {
        const fromD = previousDrafts.find((x) => draftOutcomeKey(x) === s.fromKey);
        parts.push(
          `Replaced "${fromD ? displayOutcomeLabel(fromD) : s.fromKey}" with "${s.toRaw.trim()}".`,
        );
      }
    }
    if (keepOnlyKeys && keepOnlyKeys.length > 0) {
      parts.push(
        `Kept only: ${out.map((d) => displayOutcomeLabel(d)).join(", ")}.`,
      );
    }
    if (addedForLog.length > 0 && removedForAck.length === 0 && replaceSpecs.length === 0) {
      parts.push(
        `Updated outcomes to: ${out.map((d) => displayOutcomeLabel(d)).join(", ")}.`,
      );
    }
    acknowledgment = parts.join(" ").trim();
    if (!acknowledgment && structureChanged) {
      acknowledgment = `Updated outcomes to: ${out.map((d) => displayOutcomeLabel(d)).join(", ")}.`;
    }
  }

  const reindexed = out.map((d, i) => ({ ...d, groupOrder: i }));

  return {
    drafts: reindexed,
    acknowledgment,
    reconciliationApplied,
  };
}

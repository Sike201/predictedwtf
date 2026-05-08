import {
  groupMetaFromQuestion,
  normalizeOutcomeLabel,
  normalizeStoredGroupKey,
  NONE_OF_THEM_OUTCOME_LABEL,
  DRAW_OUTCOME_LABEL,
} from "@/lib/market/group-feed-markets";
import type { GrokValidationJson } from "@/lib/market/validation-result";

function pickQuestion(p: GrokValidationJson): string {
  return (p.question ?? p.title ?? "").trim();
}

function pickEndTimeRaw(p: GrokValidationJson): string {
  return (p.endTimeUtc ?? p.end_time_utc ?? p.expiry_iso ?? "").trim();
}

function inferOutcomeLabel(p: GrokValidationJson): string {
  const explicit = (p.outcomeLabel ?? (p as { outcome_label?: string }).outcome_label ?? "").trim();
  if (explicit) return explicit;
  const q = pickQuestion(p);
  const meta = groupMetaFromQuestion(q);
  return meta?.outcomeLabel ?? "";
}

export function dedupeGroupedPayloads(
  payloads: GrokValidationJson[],
  eventGroupKey: string,
): GrokValidationJson[] {
  const gk = normalizeStoredGroupKey(eventGroupKey);
  const seen = new Set<string>();
  const out: GrokValidationJson[] = [];
  for (const p of payloads) {
    const ol = inferOutcomeLabel(p);
    const key = ol
      ? `${gk}\0${normalizeOutcomeLabel(ol)}`
      : `${gk}\0__row_${out.length}__`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

export function pickSharedExpiryFromPayloads(
  payloads: GrokValidationJson[],
  fallback: string,
): string {
  for (const p of payloads) {
    const t = pickEndTimeRaw(p);
    if (t) return t;
  }
  return fallback.trim();
}

export type GroupedBinOpts = {
  eventTitle: string;
  outcomeType: string | null | undefined;
  sharedExpiry: string;
};

/**
 * Adds a single "None of them" or "Draw" binary when appropriate.
 * Idempotent per normalized outcome label.
 */
export function appendGroupedBinPayloads(
  payloads: GrokValidationJson[],
  opts: GroupedBinOpts,
): GrokValidationJson[] {
  const t = (opts.outcomeType ?? "winner").toLowerCase().trim();
  const exp = opts.sharedExpiry.trim();
  if (!exp) return [...payloads];

  const labels = new Set<string>();
  for (const p of payloads) {
    const ol = inferOutcomeLabel(p);
    if (ol) labels.add(normalizeOutcomeLabel(ol));
  }

  const out = [...payloads];

  if (t === "match_result") {
    if (!labels.has(normalizeOutcomeLabel(DRAW_OUTCOME_LABEL))) {
      out.push({
        question: `Will ${opts.eventTitle} end in a draw?`,
        outcomeLabel: DRAW_OUTCOME_LABEL,
        yesCondition:
          "Resolves YES if the contest ends in a draw or tie, with neither side declared the outright sole winner under the official rules.",
        noCondition:
          "Resolves NO if either side wins outright (no draw / tie as the final outcome).",
        endTimeUtc: exp,
        warning: null,
      });
    }
    return out;
  }

  // winner | best_performer | custom — extra bin
  const candidateRows = out.filter((p) => {
    const ol = inferOutcomeLabel(p);
    if (!ol) return true;
    const n = normalizeOutcomeLabel(ol);
    return (
      n !== normalizeOutcomeLabel(NONE_OF_THEM_OUTCOME_LABEL) &&
      n !== normalizeOutcomeLabel(DRAW_OUTCOME_LABEL)
    );
  });
  if (
    candidateRows.length >= 2 &&
    !labels.has(normalizeOutcomeLabel(NONE_OF_THEM_OUTCOME_LABEL))
  ) {
    out.push({
      question: `Will none of the listed options win ${opts.eventTitle}?`,
      outcomeLabel: NONE_OF_THEM_OUTCOME_LABEL,
      yesCondition:
        `Resolves YES if none of the named options in "${opts.eventTitle}" occurs as described. Resolves NO if any listed option wins or is satisfied.`,
      noCondition:
        "Resolves NO if one of the listed options is the winner / satisfies the event outcome.",
      endTimeUtc: exp,
      warning: null,
    });
  }

  return out;
}

import type { MarketDraft } from "@/lib/types/market";
import { parseInstantUtcMs } from "@/lib/market/utc-instant";

const MIN_LEAD_MS = 60_000;

/** Single draft: YES/NO lines present in resolution rules. */
function draftHasYesNoConditions(d: MarketDraft): boolean {
  const lines = d.resolutionRules.split(/\n+/).filter(Boolean);
  const hasY = lines.some((l) => /^yes\s*:/i.test(l));
  const hasN = lines.some((l) => /^no\s*:/i.test(l));
  if (hasY && hasN) return true;
  return d.suggestedRules.filter(Boolean).length >= 2;
}

export function gateDraftExpiry(draft: MarketDraft): {
  ok: boolean;
  hint: string | null;
} {
  const ms = parseInstantUtcMs(draft.expiry.trim());
  if (ms == null) {
    return { ok: false, hint: "Add an end time to continue." };
  }
  if (ms <= Date.now() + MIN_LEAD_MS) {
    return {
      ok: false,
      hint: "That end time is in the past — pick a future time.",
    };
  }
  return { ok: true, hint: null };
}

export type BundleCreateReadiness = {
  canCreate: boolean;
  blockedHint: string | null;
};

export function evaluateBundleCreateReadiness(
  drafts: MarketDraft[],
): BundleCreateReadiness {
  if (drafts.length === 0) {
    return { canCreate: false, blockedHint: null };
  }

  for (const d of drafts) {
    if (!d.question?.trim()) {
      return { canCreate: false, blockedHint: "Market needs a question." };
    }
    if (!draftHasYesNoConditions(d)) {
      return {
        canCreate: false,
        blockedHint: "Resolution needs YES and NO conditions.",
      };
    }
    const g = gateDraftExpiry(d);
    if (!g.ok) {
      return { canCreate: false, blockedHint: g.hint };
    }
  }
  return { canCreate: true, blockedHint: null };
}

/** For grouped markets: one shared expiry — use latest valid instant across rows. */
export function alignGroupDraftExpiries(drafts: MarketDraft[]): MarketDraft[] {
  if (drafts.length <= 1) return drafts;
  let bestMs = -1;
  let bestIso = "";
  for (const d of drafts) {
    const ms = parseInstantUtcMs(d.expiry.trim());
    if (ms != null && ms > bestMs) {
      bestMs = ms;
      bestIso = new Date(ms).toISOString();
    }
  }
  if (!bestIso) return drafts;
  return drafts.map((d) => ({ ...d, expiry: bestIso }));
}

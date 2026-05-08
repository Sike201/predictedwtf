import { resolveMarketDraftExpiry } from "@/lib/market/draft-expiry-resolve";
import {
  formatMarketEndTimeIsoForDatabase,
  parseInstantUtcMs,
  resolveMarketExpiryInputForDatabase,
} from "@/lib/market/utc-instant";
import type { MarketDraft } from "@/lib/types/market";

/** Parsed Grok JSON (single-market payload or legacy validation shape). */
export interface GrokValidationJson {
  error?: string;
  message?: string;
  question?: string;
  yesCondition?: string;
  noCondition?: string;
  endTimeUtc?: string;
  warning?: string | null;
  /** Human-readable outcome row label for grouped events (stored in DB). */
  outcomeLabel?: string;
  outcome_label?: string;
  /** Legacy snake_case / old schema (still accepted if model returns them). */
  yes_condition?: string;
  no_condition?: string;
  end_time_utc?: string;
  valid?: boolean;
  title?: string;
  description?: string;
  expiry_iso?: string;
  subject?: string;
  resolution_source?: string;
  rules?: string[];
  image_requirements?: string;
  ambiguity_flags?: string[];
  missing_information?: string[];
  verifiability_score?: number;
  needs_revision?: boolean;
}

function pickYesCondition(p: GrokValidationJson): string {
  return (p.yesCondition ?? p.yes_condition ?? "").trim();
}

function pickNoCondition(p: GrokValidationJson): string {
  return (p.noCondition ?? p.no_condition ?? "").trim();
}

function pickEndTimeRaw(p: GrokValidationJson): string {
  return (p.endTimeUtc ?? p.end_time_utc ?? p.expiry_iso ?? "").trim();
}

function pickQuestion(p: GrokValidationJson, fallback: string): string {
  return (p.question ?? p.title ?? "").trim() || fallback;
}

function pickWarning(p: GrokValidationJson): string | null {
  const w = p.warning;
  if (w == null) return null;
  const t = typeof w === "string" ? w.trim() : "";
  return t.length > 0 ? t : null;
}

function expiryForDraftFromGrok(
  expiryRaw: string,
  latestUserPrompt: string,
  grokTitle: string,
  fallback: MarketDraft,
): string {
  const raw = expiryRaw.trim();
  const phraseBlock = [latestUserPrompt, grokTitle, fallback.question]
    .filter(Boolean)
    .join("\n");
  const fb = fallback.expiry.trim();
  const resolvedRaw = resolveMarketDraftExpiry({
    expiryRaw: raw,
    phraseBlock,
    fallbackIso: fb || new Date(Date.now() + 365 * 864e5).toISOString(),
  });
  const titleBlock = phraseBlock;
  const resolved = resolveMarketExpiryInputForDatabase({
    draftExpiry: resolvedRaw,
    title: titleBlock,
  });
  try {
    const formatted = formatMarketEndTimeIsoForDatabase(resolved.finalInput);
    const ms = parseInstantUtcMs(formatted);
    if (ms == null) {
      const fbMs = parseInstantUtcMs(fb);
      return fbMs != null ? new Date(fbMs).toISOString() : formatted;
    }
    return new Date(ms).toISOString();
  } catch {
    const fbMs = parseInstantUtcMs(fb);
    return fbMs != null ? new Date(fbMs).toISOString() : fb;
  }
}

export function grokValidationToMarketDraft(
  parsed: GrokValidationJson,
  fallback: MarketDraft,
  latestUserPrompt: string,
): MarketDraft {
  const title = pickQuestion(parsed, fallback.question);
  const description =
    parsed.description?.trim() ||
    "Binary YES/NO market. Outcome follows the conditions below.";
  const expiry = expiryForDraftFromGrok(
    pickEndTimeRaw(parsed),
    latestUserPrompt,
    title,
    fallback,
  );

  const yes = pickYesCondition(parsed);
  const no = pickNoCondition(parsed);
  const warning = pickWarning(parsed);

  const ruleLines = [
    yes && `YES: ${yes}`,
    no && `NO: ${no}`,
    ...(Array.isArray(parsed.rules) ? parsed.rules.map((r) => r?.trim()).filter(Boolean) : []),
  ].filter(Boolean) as string[];

  const resolutionRules =
    ruleLines.length > 0 ? ruleLines.join("\n\n") : fallback.resolutionRules;

  const reasoningParts = [
    warning && `Note: ${warning}`,
    parsed.subject?.trim() && `Subject: ${parsed.subject.trim()}`,
    typeof parsed.verifiability_score === "number" &&
      `Verifiability (legacy score): ${parsed.verifiability_score}/100`,
    parsed.image_requirements?.trim() &&
      `Cover image should show: ${parsed.image_requirements.trim()}`,
    Array.isArray(parsed.ambiguity_flags) &&
      parsed.ambiguity_flags.length > 0 &&
      `Flags: ${parsed.ambiguity_flags.join("; ")}`,
  ].filter(Boolean) as string[];

  const suggestedRules =
    yes && no
      ? [yes, no]
      : Array.isArray(parsed.rules) && parsed.rules.length > 0
        ? parsed.rules
        : fallback.suggestedRules;

  const out: MarketDraft = {
    question: title,
    description,
    expiry,
    resolutionRules,
    resolutionSource:
      parsed.resolution_source?.trim() ||
      "Public information as interpreted by the market resolver.",
    aiReasoning:
      reasoningParts.length > 0 ? reasoningParts.join("\n") : fallback.aiReasoning,
    suggestedRules: suggestedRules.length > 0 ? suggestedRules : fallback.suggestedRules,
  };

  if (parsed.image_requirements?.trim()) {
    out.imageRequirements = parsed.image_requirements.trim();
  }

  return out;
}

/** User-visible note when the model sets a non-null warning. */
export function formatAssistantNoteFromWarning(warning: string | null): string | null {
  if (!warning?.trim()) return null;
  return warning.trim();
}

import type { MarketDraft } from "@/lib/types/market";

/** Parsed Grok JSON from MARKET_VALIDATION_SYSTEM_PROMPT. */
export interface GrokValidationJson {
  valid?: boolean;
  title?: string;
  description?: string;
  expiry_iso?: string;
  subject?: string;
  resolution_source?: string;
  yes_condition?: string;
  no_condition?: string;
  rules?: string[];
  image_requirements?: string;
  ambiguity_flags?: string[];
  missing_information?: string[];
  verifiability_score?: number;
  needs_revision?: boolean;
}

function normalizeExpiry(expiryIso: string | undefined): string {
  const s = expiryIso?.trim();
  if (!s) return new Date(Date.now() + 365 * 864e5).toISOString();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T23:59:59.000Z`;
  try {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? new Date(Date.now() + 365 * 864e5).toISOString() : d.toISOString();
  } catch {
    return new Date(Date.now() + 365 * 864e5).toISOString();
  }
}

export function grokValidationToMarketDraft(
  parsed: GrokValidationJson,
  fallback: MarketDraft,
): MarketDraft {
  const title = parsed.title?.trim() || fallback.question;
  const description = parsed.description?.trim() || fallback.description;
  const expiry = normalizeExpiry(parsed.expiry_iso);

  const ruleLines = [
    parsed.yes_condition?.trim() && `YES: ${parsed.yes_condition.trim()}`,
    parsed.no_condition?.trim() && `NO: ${parsed.no_condition.trim()}`,
    ...(Array.isArray(parsed.rules) ? parsed.rules.map((r) => r?.trim()).filter(Boolean) : []),
  ].filter(Boolean) as string[];

  const resolutionRules =
    ruleLines.length > 0 ? ruleLines.join("\n\n") : fallback.resolutionRules;

  const reasoningParts = [
    parsed.subject?.trim() && `Subject: ${parsed.subject.trim()}`,
    typeof parsed.verifiability_score === "number" &&
      `Verifiability: ${parsed.verifiability_score}/100`,
    parsed.image_requirements?.trim() &&
      `Cover image should show: ${parsed.image_requirements.trim()}`,
    Array.isArray(parsed.ambiguity_flags) &&
      parsed.ambiguity_flags.length > 0 &&
      `Flags: ${parsed.ambiguity_flags.join("; ")}`,
  ].filter(Boolean) as string[];

  const suggestedRules =
    Array.isArray(parsed.rules) && parsed.rules.length > 0
      ? parsed.rules
      : [
          parsed.yes_condition?.trim(),
          parsed.no_condition?.trim(),
        ].filter(Boolean) as string[];

  const out: MarketDraft = {
    question: title,
    description,
    expiry,
    resolutionRules,
    resolutionSource:
      parsed.resolution_source?.trim() || fallback.resolutionSource,
    aiReasoning: reasoningParts.length > 0 ? reasoningParts.join("\n") : fallback.aiReasoning,
    suggestedRules: suggestedRules.length > 0 ? suggestedRules : fallback.suggestedRules,
  };

  if (parsed.image_requirements?.trim()) {
    out.imageRequirements = parsed.image_requirements.trim();
  }

  return out;
}

export function buildInvalidAssistantMessage(parsed: GrokValidationJson): string {
  const lines: string[] = [];
  if (Array.isArray(parsed.missing_information)) {
    for (const m of parsed.missing_information) {
      const t = m?.trim();
      if (t) lines.push(t);
    }
  }
  if (Array.isArray(parsed.ambiguity_flags)) {
    for (const a of parsed.ambiguity_flags) {
      const t = a?.trim();
      if (t) lines.push(t);
    }
  }
  if (lines.length > 0) return lines.join("\n\n");
  return "This market isn’t specific enough for objective resolution. Add a clear YES/NO, a precise calendar deadline, and a verifiable public source.";
}

import type { GrokValidationJson } from "@/lib/market/validation-result";
import { slugifyEventGroupKey } from "@/lib/market/group-feed-markets";

export type ChatTurnForApi = { role: "user" | "assistant"; content: string };

/** Exact reply for grouped / create-all turns (system-enforced). */
export const SILENT_GROUP_ASSISTANT_REPLY = "Got it — here are the markets.";

const DEFAULT_CHAT_FALLBACK =
  "Here’s a starter draft from your message — review it below and add a cover image.";

const MULTI_LEGACY_REDIRECT =
  "That could be a few separate YES/NO markets. Pick a specific name or team (e.g. “Network School”), say “first one” if I listed options, or say “create all” for every binary at once.";

/** High-confidence “open winner” phrasing — used for offline fallback only. */
export function looksLikeOpenWinnerTopic(prompt: string): boolean {
  const t = prompt.trim();
  if (!t) return false;
  const lower = t.toLowerCase();
  if (/\btop\s*\d+\b/.test(lower)) return true;
  if (/\bwho\s+will\s+win\b/.test(lower)) return true;
  if (/\bwho\s+wins\b/.test(lower)) return true;
  if (/\bwho('s|\s+is)\s+(going to|gonna)\s+win\b/.test(lower)) return true;
  if (/\bpick\s+(the\s+)?winner\b/.test(lower)) return true;
  if (/\bwhich\s+one\s+(wins|will win)\b/.test(lower)) return true;
  if (
    /\bwhich\s+(team|player|project|chain|token|protocol|company)\s+(will|wins|wins\?)\b/.test(
      lower,
    )
  )
    return true;
  if (/\bbest\s+team\b/.test(lower)) return true;
  if (/\bwinner\s+of\b/.test(lower)) return true;
  return false;
}

export interface CreateAssistantTurnParsed {
  assistantMessage: string;
  marketPayloads: GrokValidationJson[];
  eventTitle: string | null;
  /** True when type was market_group or multiple markets delivered in one grouped turn. */
  isMarketGroup: boolean;
  /** Stable slug shared by all rows (hyphenated); may be model-supplied or derived from eventTitle. */
  eventGroupKey: string | null;
  outcomeType: string | null;
  groupExpiryUtc: string | null;
}

/** Template assistant reply when XAI is not configured and the prompt looks multi-candidate. */
export function fallbackConversationalOpenWinnerTurn(
  prompt: string,
): CreateAssistantTurnParsed {
  const cue = prompt.replace(/\?+$/, "").trim() || "this event";
  return {
    assistantMessage: `That could be a few YES/NO markets. Want to start with one of these?

• Will Network School win ${cue}?
• Will a Superteam win ${cue}?
• Will Evan win ${cue}?

Pick one, name a team or person, or say “create all” for every option.`,
    marketPayloads: [],
    eventTitle: null,
    isMarketGroup: false,
    eventGroupKey: null,
    outcomeType: null,
    groupExpiryUtc: null,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function coerceMarketEntry(v: unknown): GrokValidationJson | null {
  if (!isRecord(v)) return null;
  return v as GrokValidationJson;
}

/**
 * Normalize Grok (or legacy) JSON into assistant text + market payloads.
 */
export function parseCreateAssistantTurn(rawUnknown: unknown): CreateAssistantTurnParsed {
  if (!isRecord(rawUnknown)) {
    return {
      assistantMessage: DEFAULT_CHAT_FALLBACK,
      marketPayloads: [],
      eventTitle: null,
      isMarketGroup: false,
      eventGroupKey: null,
      outcomeType: null,
      groupExpiryUtc: null,
    };
  }

  const err = String(rawUnknown.error ?? "").trim();
  if (err === "multi_outcome_detected") {
    return {
      assistantMessage: MULTI_LEGACY_REDIRECT,
      marketPayloads: [],
      eventTitle: null,
      isMarketGroup: false,
      eventGroupKey: null,
      outcomeType: null,
      groupExpiryUtc: null,
    };
  }

  const typeRaw = String(rawUnknown.type ?? "").trim();
  const isTypedGroup = typeRaw === "market_group";

  let eventGroupKey: string | null =
    typeof rawUnknown.eventGroupKey === "string" && rawUnknown.eventGroupKey.trim()
      ? rawUnknown.eventGroupKey.trim()
      : typeof rawUnknown.event_group_key === "string" &&
          rawUnknown.event_group_key.trim()
        ? rawUnknown.event_group_key.trim()
        : null;

  let outcomeType: string | null =
    typeof rawUnknown.outcomeType === "string" && rawUnknown.outcomeType.trim()
      ? rawUnknown.outcomeType.trim()
      : typeof rawUnknown.outcome_type === "string" &&
          rawUnknown.outcome_type.trim()
        ? rawUnknown.outcome_type.trim()
        : null;

  let groupExpiryUtc: string | null =
    typeof rawUnknown.expiryUtc === "string" && rawUnknown.expiryUtc.trim()
      ? rawUnknown.expiryUtc.trim()
      : typeof rawUnknown.expiry_utc === "string" && rawUnknown.expiry_utc.trim()
        ? rawUnknown.expiry_utc.trim()
        : null;

  let eventTitle: string | null =
    typeof rawUnknown.eventTitle === "string" && rawUnknown.eventTitle.trim()
      ? rawUnknown.eventTitle.trim()
      : null;

  let assistantMessage =
    typeof rawUnknown.assistantMessage === "string"
      ? rawUnknown.assistantMessage.trim()
      : "";

  let marketPayloads: GrokValidationJson[] = [];
  if (Array.isArray(rawUnknown.markets)) {
    for (const m of rawUnknown.markets) {
      const coerced = coerceMarketEntry(m);
      if (coerced) marketPayloads.push(coerced);
    }
  }

  const looksLikeSinglePayload =
    !isTypedGroup &&
    marketPayloads.length === 0 &&
    (typeof rawUnknown.question === "string" ||
      typeof rawUnknown.title === "string");

  if (looksLikeSinglePayload) {
    marketPayloads = [rawUnknown as GrokValidationJson];
  }

  if (groupExpiryUtc) {
    marketPayloads = marketPayloads.map((p) => {
      const cur = (p.endTimeUtc ?? p.end_time_utc ?? "").trim();
      if (cur) return p;
      return { ...p, endTimeUtc: groupExpiryUtc, end_time_utc: groupExpiryUtc };
    });
  }

  let isMarketGroup = isTypedGroup;
  if (!isMarketGroup && marketPayloads.length > 1) {
    isMarketGroup = true;
    assistantMessage = SILENT_GROUP_ASSISTANT_REPLY;
    if (!eventTitle) {
      eventTitle = "Markets";
    }
  }

  if (isTypedGroup) {
    assistantMessage = SILENT_GROUP_ASSISTANT_REPLY;
    if (!eventTitle) {
      eventTitle = "Markets";
    }
  }

  if (isMarketGroup && eventTitle && !eventGroupKey) {
    eventGroupKey = slugifyEventGroupKey(eventTitle);
  }

  if (isMarketGroup && !outcomeType) {
    outcomeType = "winner";
  }

  if (!assistantMessage) {
    assistantMessage =
      marketPayloads.length > 0
        ? "Locked in — review the draft below and add a cover image."
        : DEFAULT_CHAT_FALLBACK;
  }

  return {
    assistantMessage,
    marketPayloads,
    eventTitle,
    isMarketGroup,
    eventGroupKey,
    outcomeType,
    groupExpiryUtc,
  };
}

function isUsableMarketPayload(p: GrokValidationJson): boolean {
  const q = (p.question ?? p.title ?? "").trim();
  const y = (p.yesCondition ?? p.yes_condition ?? "").trim();
  const n = (p.noCondition ?? p.no_condition ?? "").trim();
  return Boolean(q && y && n);
}

/** Drop incomplete market objects from the model. */
export function filterUsableMarketPayloads(
  payloads: GrokValidationJson[],
): GrokValidationJson[] {
  return payloads.filter(isUsableMarketPayload);
}

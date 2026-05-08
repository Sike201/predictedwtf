/**
 * Resolve market draft expiry when the model or user omits an explicit calendar year.
 * Policy: no four-digit year in the phrase → use current UTC calendar year for month/day,
 * then roll forward year-by-year until the instant is clearly in the future.
 */

import {
  normalizeTimestampInputToUtcForParse,
  parseInstantUtcMs,
} from "@/lib/market/utc-instant";

export const DATE_PARSE_LOG_PREFIX = "[date-parse]";

const FUTURE_BUFFER_MS = 60 * 60 * 1000; /* 1 hour */
const MAX_YEAR_BUMPS = 6;

const MONTH_ALIASES: ReadonlyArray<{ names: string[]; index: number }> = [
  { names: ["january", "jan"], index: 0 },
  { names: ["february", "feb"], index: 1 },
  { names: ["march", "mar"], index: 2 },
  { names: ["april", "apr"], index: 3 },
  { names: ["may"], index: 4 },
  { names: ["june", "jun"], index: 5 },
  { names: ["july", "jul"], index: 6 },
  { names: ["august", "aug"], index: 7 },
  { names: ["september", "sept", "sep"], index: 8 },
  { names: ["october", "oct"], index: 9 },
  { names: ["november", "nov"], index: 10 },
  { names: ["december", "dec"], index: 11 },
];

function monthAliasPattern(): string {
  const parts = MONTH_ALIASES.flatMap((m) => m.names);
  return `(?:${parts.join("|")})`;
}

function resolveMonthIndex(token: string): number | null {
  const t = token.toLowerCase().replace(/\.$/, "").trim();
  for (const row of MONTH_ALIASES) {
    if (row.names.some((n) => n === t)) return row.index;
  }
  return null;
}

/** First standalone `19xx` / `20xx` in text (market prompts rarely contain unrelated years). */
export function extractExplicitFourDigitYear(text: string): number | null {
  const m = text.match(/\b(19|20)\d{2}\b/);
  if (!m) return null;
  const y = Number(m[0]);
  return Number.isFinite(y) ? y : null;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function utcLastDayOfMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

function replaceUtcYearPreservingClock(d: Date, year: number): Date {
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const h = d.getUTCHours();
  const min = d.getUTCMinutes();
  const s = d.getUTCSeconds();
  const ms = d.getUTCMilliseconds();
  let candidate = Date.UTC(year, m, day, h, min, s, ms);
  let out = new Date(candidate);
  if (out.getUTCMonth() !== m) {
    const last = utcLastDayOfMonth(year, m);
    candidate = Date.UTC(year, m, last, h, min, s, ms);
    out = new Date(candidate);
  }
  return out;
}

function bumpUntilFuture(d: Date, now: Date): Date {
  let x = new Date(d.getTime());
  let n = 0;
  while (x.getTime() <= now.getTime() + FUTURE_BUFFER_MS && n < MAX_YEAR_BUMPS) {
    x = replaceUtcYearPreservingClock(x, x.getUTCFullYear() + 1);
    n += 1;
  }
  return x;
}

export type NaturalDateParts =
  | { kind: "month_day"; month0: number; day: number; explicitYear: number | null }
  | { kind: "month_end"; month0: number; explicitYear: number | null };

/** Exported for tests — extract month/day or month-only from English prose. */
export function tryParseNaturalCalendarDate(text: string): NaturalDateParts | null {
  const t = text.trim();
  if (!t) return null;
  const MONTH = monthAliasPattern();

  const withYearAfterDay = new RegExp(
    `\\b(?:before|by|until|on|no\\s+later\\s+than)\\s+(?:the\\s+)?(${MONTH})\\s+(\\d{1,2})(?:st|nd|rd|th)?[,\\s]+((?:19|20)\\d{2})\\b`,
    "i",
  );
  const withYearBeforeMonth = new RegExp(
    `\\b((?:19|20)\\d{2})[,\\s]+(${MONTH})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`,
    "i",
  );

  let m = t.match(withYearAfterDay);
  if (m) {
    const mo = resolveMonthIndex(m[1] ?? "");
    const day = Number(m[2]);
    const y = Number(m[3]);
    if (mo != null && day >= 1 && day <= 31 && Number.isFinite(y))
      return { kind: "month_day", month0: mo, day, explicitYear: y };
  }
  m = t.match(withYearBeforeMonth);
  if (m) {
    const y = Number(m[1]);
    const mo = resolveMonthIndex(m[2] ?? "");
    const day = Number(m[3]);
    if (mo != null && day >= 1 && day <= 31 && Number.isFinite(y))
      return { kind: "month_day", month0: mo, day, explicitYear: y };
  }

  const cueMonthDay = new RegExp(
    `\\b(?:before|by|until|on|no\\s+later\\s+than)\\s+(?:the\\s+)?(${MONTH})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`,
    "i",
  );
  m = t.match(cueMonthDay);
  if (m) {
    const mo = resolveMonthIndex(m[1] ?? "");
    const day = Number(m[2]);
    if (mo != null && day >= 1 && day <= 31)
      return { kind: "month_day", month0: mo, day, explicitYear: null };
  }

  const mdLoose = new RegExp(
    `\\b(${MONTH})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`,
    "i",
  );
  m = t.match(mdLoose);
  if (m) {
    const mo = resolveMonthIndex(m[1] ?? "");
    const day = Number(m[2]);
    if (mo != null && day >= 1 && day <= 31)
      return { kind: "month_day", month0: mo, day, explicitYear: null };
  }

  const dm = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH})\\b`,
    "i",
  );
  m = t.match(dm);
  if (m) {
    const day = Number(m[1]);
    const mo = resolveMonthIndex(m[2] ?? "");
    if (mo != null && day >= 1 && day <= 31)
      return { kind: "month_day", month0: mo, day, explicitYear: null };
  }

  const monthYear = new RegExp(
    `\\b(${MONTH})\\s+((?:19|20)\\d{2})\\b`,
    "i",
  );
  m = t.match(monthYear);
  if (m) {
    const mo = resolveMonthIndex(m[1] ?? "");
    const y = Number(m[2]);
    if (mo != null && Number.isFinite(y)) {
      const last = utcLastDayOfMonth(y, mo);
      return { kind: "month_day", month0: mo, day: last, explicitYear: y };
    }
  }

  const monthOnlyCue = new RegExp(
    `\\b(?:before|by|until|in|during|for)\\s+(?:the\\s+)?(?:month\\s+of\\s+)?(${MONTH})(?!\\s+\\d)\\b`,
    "i",
  );
  const mc = t.match(monthOnlyCue);
  if (mc) {
    const mo = resolveMonthIndex(mc[1] ?? "");
    const globalYear = extractExplicitFourDigitYear(t);
    if (mo != null)
      return { kind: "month_end", month0: mo, explicitYear: globalYear };
  }

  return null;
}

function partsToYmd(parts: NaturalDateParts, defaultYear: number): string {
  if (parts.kind === "month_end") {
    const y = parts.explicitYear ?? defaultYear;
    const last = utcLastDayOfMonth(y, parts.month0);
    return `${y}-${pad2(parts.month0 + 1)}-${pad2(last)}`;
  }
  const y = parts.explicitYear ?? defaultYear;
  const last = utcLastDayOfMonth(y, parts.month0);
  const day = Math.min(parts.day, last);
  return `${y}-${pad2(parts.month0 + 1)}-${pad2(day)}`;
}

function logParse(payload: {
  phraseSample: string;
  expiryRaw: string;
  explicitYear: number | null;
  inferredYear: number | null;
  parsedMonthDay: string | null;
  source: string;
  final: string;
}): void {
  console.info(DATE_PARSE_LOG_PREFIX, JSON.stringify(payload));
}

function effectivePhraseForLogging(phraseBlock: string): string {
  const oneLine = phraseBlock.replace(/\s+/g, " ").trim();
  return oneLine.length > 240 ? `${oneLine.slice(0, 240)}…` : oneLine;
}

function isLikelyDateOnlyExpiryPayload(raw: string): boolean {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return true;
  const n = normalizeTimestampInputToUtcForParse(s);
  return /^\d{4}-\d{2}-\d{2}T23:59:59(\.000)?Z$/.test(n);
}

/**
 * Returns an ISO string suitable for {@link formatMarketEndTimeIsoForDatabase} /
 * {@link resolveMarketExpiryInputForDatabase} (date-only `YYYY-MM-DD` or full ISO).
 */
export function resolveMarketDraftExpiry(params: {
  expiryRaw: string;
  phraseBlock: string;
  fallbackIso: string;
  now?: Date;
}): string {
  const now = params.now ?? new Date();
  const phraseBlock = params.phraseBlock.trim();
  const raw = params.expiryRaw.trim();
  const fallbackMs = parseInstantUtcMs(params.fallbackIso.trim());
  const safeFallback =
    fallbackMs != null && fallbackMs > now.getTime() + 60_000
      ? new Date(fallbackMs).toISOString()
      : new Date(now.getTime() + 365 * 864e5).toISOString();

  const globalExplicitYear = extractExplicitFourDigitYear(phraseBlock);
  const policyYear = now.getUTCFullYear();

  const finish = (
    intermediate: string,
    meta: {
      source: string;
      explicitYear: number | null;
      inferredYear: number | null;
      parsedMonthDay: string | null;
    },
  ): string => {
    const normalized = normalizeTimestampInputToUtcForParse(intermediate.trim());
    const ms0 = parseInstantUtcMs(normalized);
    let inferredYearLog = meta.inferredYear;
    let isoOut = intermediate;
    if (ms0 != null) {
      let d = new Date(ms0);
      d = bumpUntilFuture(d, now);
      isoOut = d.toISOString();
      const yf = new Date(isoOut).getUTCFullYear();
      if (Number.isFinite(yf)) inferredYearLog = yf;
    }
    logParse({
      phraseSample: effectivePhraseForLogging(phraseBlock),
      expiryRaw: raw,
      explicitYear: meta.explicitYear,
      inferredYear: inferredYearLog,
      parsedMonthDay: meta.parsedMonthDay,
      source: meta.source,
      final: isoOut,
    });
    return isoOut;
  };

  /* Model / payload supplied a parseable timestamp */
  if (raw) {
    const normalizedIn = normalizeTimestampInputToUtcForParse(raw);
    const parsedMs = parseInstantUtcMs(normalizedIn);
    if (parsedMs != null) {
      const d = new Date(parsedMs);
      const md = `${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
      let targetYear: number;
      let explicit: number | null;
      if (globalExplicitYear != null) {
        targetYear = globalExplicitYear;
        explicit = globalExplicitYear;
      } else {
        targetYear = policyYear;
        explicit = null;
      }
      let rebuilt = replaceUtcYearPreservingClock(d, targetYear);
      const dateOnlyOut = `${rebuilt.getUTCFullYear()}-${pad2(rebuilt.getUTCMonth() + 1)}-${pad2(rebuilt.getUTCDate())}`;
      const outIntermediate = isLikelyDateOnlyExpiryPayload(raw)
        ? dateOnlyOut
        : rebuilt.toISOString();
      return finish(outIntermediate, {
        source: "model_iso_rebaseline",
        explicitYear: explicit,
        inferredYear: rebuilt.getUTCFullYear(),
        parsedMonthDay: md,
      });
    }
  }

  /* No usable ISO — derive from natural language in the phrase */
  const natural = tryParseNaturalCalendarDate(phraseBlock);
  if (natural) {
    const ymd = partsToYmd(natural, policyYear);
    const inferredY = Number(ymd.slice(0, 4));
    const mdLog =
      natural.kind === "month_end"
        ? `${pad2(natural.month0 + 1)}-EOY`
        : `${pad2(natural.month0 + 1)}-${pad2(natural.day)}`;
    return finish(ymd, {
      source: "phrase_natural",
      explicitYear: natural.explicitYear ?? globalExplicitYear,
      inferredYear: inferredY,
      parsedMonthDay: mdLog,
    });
  }

  /* Last resort: keep fallback (already dynamic, never a stale constant year) */
  logParse({
    phraseSample: effectivePhraseForLogging(phraseBlock),
    expiryRaw: raw,
    explicitYear: globalExplicitYear,
    inferredYear: globalExplicitYear ?? policyYear,
    parsedMonthDay: null,
    source: "fallback_iso",
    final: safeFallback,
  });
  return safeFallback;
}

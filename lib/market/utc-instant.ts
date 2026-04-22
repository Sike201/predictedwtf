/**
 * Parse and format market end times as **unambiguous UTC instants** (epoch ms).
 * - No local-timeZone assumptions: naive `YYYY-MM-DDTHH:mm` is treated as **UTC** at persistence/read.
 * - Empty strings do not block fallback to the paired column (`"" ?? x` in JS is `""`).
 */

const NAIVE_HAS_TZ = /(?:[zZ]|[+-][0-9]{2}:[0-9]{2})$/;

/**
 * `YYYY-MM-DDTHH:mm` (and optional seconds/ms) with **no** offset → interpret as **UTC** (append `Z`).
 * PostgreSQL `timestamptz` text sometimes uses a space: `2026-04-22 12:30:00+00` — normalize to ISO.
 */
export function normalizeTimestampInputToUtcForParse(s: string): string {
  let t = s.trim();
  if (!t) return t;
  if (/^\d{4}-\d{2}-\d{2} \d/.test(t)) {
    t = t.replace(/ /, "T");
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    return `${t}T23:59:59.000Z`;
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(t) && !NAIVE_HAS_TZ.test(t)) {
    if (/^\d{4}-\d{2}-\d{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?$/.test(t)) {
      return `${t}Z`;
    }
  }
  return t;
}

export function nonEmptyTimestampString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

/**
 * `resolve_after` if non-empty, else `expiry_ts` if non-empty.
 * (Plain `a ?? b` is wrong when `a === ""`.)
 */
export function pickActiveResolveOrExpiryRaw(
  record: Pick<Record<string, unknown>, "resolve_after" | "expiry_ts">,
): string | null {
  return (
    nonEmptyTimestampString((record as { resolve_after?: unknown }).resolve_after) ??
    nonEmptyTimestampString((record as { expiry_ts?: unknown }).expiry_ts) ??
    null
  );
}

/**
 * One instant in UTC epoch ms, or `null` if missing / unparseable.
 * Accepts: ISO (with/without Z), epoch seconds (9–11 digit strings), ms numbers, `Date`, Postgres text.
 */
export function parseInstantUtcMs(input: unknown): number | null {
  if (input == null) return null;
  if (input instanceof Date) {
    const t = input.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof input === "number" && Number.isFinite(input)) {
    if (input <= 0) return null;
    if (input < 1e12) return Math.round(input * 1000);
    return Math.round(input);
  }
  let s0 = String(input).trim();
  if (!s0 || s0 === "null" || s0 === "undefined") return null;
  // ISO-8601 / Postgres timestamptz text **must** be parsed before the all-digit epoch
  // short-path — otherwise a 10-char digit blob can be misread as Unix seconds
  // (e.g. compact "2026042212" would incorrectly become epoch ms).
  if (/^\d{4}-/.test(s0) || s0.includes(" ")) {
    s0 = normalizeTimestampInputToUtcForParse(s0);
    const ms = Date.parse(s0);
    if (Number.isFinite(ms)) return ms;
    return null;
  }
  if (/^\d{9,11}$/.test(s0)) {
    return Number(s0) * 1000;
  }
  s0 = normalizeTimestampInputToUtcForParse(s0);
  const ms2 = Date.parse(s0);
  if (Number.isFinite(ms2)) return ms2;
  return null;
}

/**
 * For lifecycle: the instant when trading ends / resolver may act — same field priority as the DB.
 */
export function parseResolveAfterEpochMs(
  record: Pick<Record<string, unknown>, "resolve_after" | "expiry_ts">,
): number | null {
  const raw = pickActiveResolveOrExpiryRaw(record);
  if (raw == null) return null;
  return parseInstantUtcMs(raw);
}

export function parseExpiryEpochMs(
  record: Pick<Record<string, unknown>, "expiry_ts">,
): number | null {
  const raw = nonEmptyTimestampString((record as { expiry_ts?: unknown }).expiry_ts);
  if (raw == null) return null;
  return parseInstantUtcMs(raw);
}

const DATE_ONLY_YMD = /^\d{4}-\d{2}-\d{2}$/;

export function isDateOnlyUtcCalendarInput(s: string): boolean {
  return DATE_ONLY_YMD.test(s.trim());
}

/** True when the instant is the calendar end-of-day we assign for date-only inputs (23:59:59.000Z). */
export function isUtcEndOfDay235959FromDateOnlyExpansion(iso: string): boolean {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  const d = new Date(t);
  return (
    d.getUTCHours() === 23 &&
    d.getUTCMinutes() === 59 &&
    d.getUTCSeconds() === 59 &&
    d.getUTCMilliseconds() === 0
  );
}

/**
 * Picks the first "HH:MM UTC" (24h) mention in the title / prompt text.
 * Does not read timezone offsets other than the UTC label.
 */
export function extractUtcTimeHmFromText(text: string): { h: number; m: number } | null {
  // "before 12:55 UTC", "at 9:05 UTC", "12:50 UTC on April 22"
  const m = text.match(
    /\b([01]?\d|2[0-3]):([0-5][0-9])\s*UTC\b/i,
  );
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isInteger(h) || h < 0 || h > 23) return null;
  if (!Number.isInteger(min) || min < 0 || min > 59) return null;
  return { h, m: min };
}

/**
 * Merges a **date-only** `YYYY-MM-DD` or a **synthetic** EoD `…T23:59:59.000Z` row with a UTC
 * clock time from the market title (e.g. "before 12:55 UTC") so we do not lose hour/minute.
 */
export function resolveMarketExpiryInputForDatabase(params: {
  draftExpiry: string;
  /** User question, cleaned title, or both (newlines ok) for time extraction */
  title: string;
}): {
  finalInput: string;
  usedTitleUtcTime: boolean;
  titleDerivedCutoff: string | null;
  /** True when `params.draftExpiry` was date-only before merge */
  draftWasDateOnly: boolean;
} {
  const raw = params.draftExpiry.trim();
  const tText = params.title;
  const hm = extractUtcTimeHmFromText(tText);
  const pad = (n: number) => n.toString().padStart(2, "0");

  const ymdFromIsoPrefix = (iso: string): string | null => {
    const p = iso.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(p) ? p : null;
  };

  if (!raw) {
    return {
      finalInput: raw,
      usedTitleUtcTime: false,
      titleDerivedCutoff: null,
      draftWasDateOnly: false,
    };
  }

  if (isDateOnlyUtcCalendarInput(raw) && hm) {
    const ymd = raw.trim();
    const z = `${ymd}T${pad(hm.h)}:${pad(hm.m)}:00.000Z`;
    return {
      finalInput: z,
      usedTitleUtcTime: true,
      titleDerivedCutoff: z,
      draftWasDateOnly: true,
    };
  }

  if (isUtcEndOfDay235959FromDateOnlyExpansion(raw) && hm) {
    const ymd = ymdFromIsoPrefix(raw);
    if (ymd) {
      const z = `${ymd}T${pad(hm.h)}:${pad(hm.m)}:00.000Z`;
      return {
        finalInput: z,
        usedTitleUtcTime: true,
        titleDerivedCutoff: z,
        draftWasDateOnly: false,
      };
    }
  }

  return {
    finalInput: raw,
    usedTitleUtcTime: false,
    titleDerivedCutoff: null,
    draftWasDateOnly: isDateOnlyUtcCalendarInput(raw),
  };
}

const EXPIRY_WRITE = "[predicted][market-expiry-write]";

/**
 * For DB writes from create flow — always outputs ISO 8601 with `Z` when possible.
 * Date-only `YYYY-MM-DD` → `T23:59:59.000Z` (end of that UTC calendar day).
 * If the market is time-specific, pass a full datetime or pre-merge with {@link resolveMarketExpiryInputForDatabase}.
 */
export function formatMarketEndTimeIsoForDatabase(expiry: string): string {
  const s = expiry.trim();
  if (!s) {
    return new Date(Date.now() + 365 * 864e5).toISOString();
  }
  if (isDateOnlyUtcCalendarInput(s)) {
    return `${s}T23:59:59.000Z`;
  }
  const normalized = normalizeTimestampInputToUtcForParse(s);
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) {
    return new Date(Date.now() + 365 * 864e5).toISOString();
  }
  return d.toISOString();
}

export function logMarketExpiryWrite(params: {
  slug: string;
  draft_expiry_input: string;
  parsed_before_format: string;
  interpreted_as_date_only: boolean;
  used_title_utc_time: boolean;
  title_derived_cutoff: string | null;
  final_expiry_ts: string;
  final_resolve_after: string;
}): void {
  console.info(
    EXPIRY_WRITE,
    JSON.stringify({
      ...params,
    }),
  );
}

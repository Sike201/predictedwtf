/**
 * Smoke tests for implicit-year expiry resolution.
 * Run: npx tsx scripts/verify-draft-expiry-resolve.ts
 */
import assert from "node:assert/strict";
import {
  resolveMarketDraftExpiry,
  tryParseNaturalCalendarDate,
} from "../lib/market/draft-expiry-resolve";

const fallback = new Date(Date.now() + 400 * 864e5).toISOString();

function run() {
  const mayNow = new Date("2026-05-07T12:00:00.000Z");

  const staleModel = resolveMarketDraftExpiry({
    expiryRaw: "2024-05-10T23:59:59.000Z",
    phraseBlock: "Will BTC hit 150k before May 10?",
    fallbackIso: fallback,
    now: mayNow,
  });
  assert.match(staleModel, /^2026-05-10T/);

  const december = resolveMarketDraftExpiry({
    expiryRaw: "",
    phraseBlock: "Will OpenAI release GPT-6 by December?",
    fallbackIso: fallback,
    now: mayNow,
  });
  assert.match(december, /^2026-12-31T/);

  const decNow = new Date("2026-12-15T12:00:00.000Z");
  const januarySoon = resolveMarketDraftExpiry({
    expiryRaw: "",
    phraseBlock: "before January 5",
    fallbackIso: fallback,
    now: decNow,
  });
  assert.match(januarySoon, /^2027-01-05T/);

  const explicitYear = resolveMarketDraftExpiry({
    expiryRaw: "2024-06-01T23:59:59.000Z",
    phraseBlock: "Will France win before June 1 2026?",
    fallbackIso: fallback,
    now: mayNow,
  });
  assert.match(explicitYear, /^2026-06-01T/);

  const nat = tryParseNaturalCalendarDate(
    "Will France win before June 1?",
  );
  assert.ok(nat?.kind === "month_day" && nat.month0 === 5 && nat.day === 1);

  console.info("[verify-draft-expiry-resolve] ok");
}

run();

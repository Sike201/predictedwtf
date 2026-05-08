/**
 * Smoke-check outcome reconciliation for grouped draft edits.
 * Run: npx tsx scripts/verify-draft-outcome-reconcile.ts
 */

import assert from "node:assert/strict";
import {
  isNoneOfListedOutcomeDraft,
  NONE_OF_THEM_OUTCOME_LABEL,
} from "../lib/market/group-feed-markets";
import { reconcileGroupedDraftOutcomeMutations } from "../lib/market/draft-outcome-reconcile";
import type { MarketDraft } from "../lib/types/market";

function row(label: string, extra?: Partial<MarketDraft>): MarketDraft {
  return {
    question: `Will ${label} win FIFA?`,
    description: "Test",
    expiry: "2099-01-01T00:00:00.000Z",
    resolutionRules: `YES if ${label} wins.\nNO otherwise.`,
    resolutionSource: "Official",
    aiReasoning: "",
    suggestedRules: [],
    outcomeLabel: label,
    eventGroupKey: "fifa-winner",
    eventTitle: "FIFA Winner",
    outcomeType: "winner",
    groupOrder: 0,
    ...extra,
  };
}

const france = row("France", { groupOrder: 0 });
const spain = row("Spain", { groupOrder: 1 });
const england = row("England", { groupOrder: 2 });
const prev = [france, spain, england];

const llmStale = [
  { ...france, question: france.question },
  { ...spain, question: spain.question },
  { ...england, question: england.question },
];

const r1 = reconcileGroupedDraftOutcomeMutations({
  userPrompt: "Remove England",
  previousDrafts: prev,
  llmDrafts: llmStale,
});
assert.equal(r1.drafts.length, 2);
assert.ok(
  !r1.drafts.some((d) => (d.outcomeLabel ?? "").includes("England")),
  "England must be gone",
);
assert.ok(r1.acknowledgment?.includes("England"), "ack mentions England");

const r2 = reconcileGroupedDraftOutcomeMutations({
  userPrompt: "only keep France and Spain",
  previousDrafts: prev,
  llmDrafts: llmStale,
});
assert.equal(r2.drafts.length, 2);

const r3 = reconcileGroupedDraftOutcomeMutations({
  userPrompt: "Replace Spain with Portugal",
  previousDrafts: prev,
  llmDrafts: [
    { ...france },
    {
      ...spain,
      outcomeLabel: "Portugal",
      question: "Will Portugal win FIFA?",
      resolutionRules: "YES if Portugal wins.\nNO otherwise.",
    },
    { ...england },
  ],
});
assert.ok(r3.drafts.some((d) => (d.outcomeLabel ?? "") === "Portugal"));
assert.ok(!r3.drafts.some((d) => (d.outcomeLabel ?? "") === "Spain"));

const may8 = row("May 8", {
  groupOrder: 0,
  eventGroupKey: "daily-pool",
  eventTitle: "Daily pool",
});
const may9 = row("May 9", {
  groupOrder: 1,
  eventGroupKey: "daily-pool",
  eventTitle: "Daily pool",
});
const may10 = row("May 10", {
  groupOrder: 2,
  eventGroupKey: "daily-pool",
  eventTitle: "Daily pool",
});
const noneBin: MarketDraft = {
  question: "Will none of the listed options win the daily pool?",
  description: "None bin",
  expiry: "2099-01-01T00:00:00.000Z",
  resolutionRules: "YES if no listed day wins.",
  resolutionSource: "Official",
  aiReasoning: "",
  suggestedRules: [],
  outcomeLabel: NONE_OF_THEM_OUTCOME_LABEL,
  eventGroupKey: "daily-pool",
  eventTitle: "Daily pool",
  outcomeType: "winner",
  groupOrder: 3,
};
const prevDates = [may8, may9, may10, noneBin];
const llmStaleDates = prevDates.map((d) => ({ ...d }));

const r4 = reconcileGroupedDraftOutcomeMutations({
  userPrompt: "remove the none of the listed option",
  previousDrafts: prevDates,
  llmDrafts: llmStaleDates,
});
assert.equal(r4.drafts.length, 3);
assert.ok(
  !r4.drafts.some(isNoneOfListedOutcomeDraft),
  "none-of-listed bin must be removed",
);
assert.ok(r4.drafts.every((d) => !d.question.toLowerCase().includes("none of")));

const r5 = reconcileGroupedDraftOutcomeMutations({
  userPrompt: "delete none",
  previousDrafts: prevDates,
  llmDrafts: llmStaleDates,
});
assert.equal(r5.drafts.length, 3);
assert.ok(!r5.drafts.some(isNoneOfListedOutcomeDraft));

console.info("[verify-draft-outcome-reconcile] ok");

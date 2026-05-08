/**
 * Grouped market merge with existing DB rows (no Supabase).
 * Run: npx tsx scripts/verify-grouped-market-merge.ts
 */
import assert from "node:assert/strict";
import {
  mergeProposedGroupedDraftsWithExistingMembers,
  normalizeEventTitleForGroupDedup,
  normalizeOutcomeKeyForGroupedMerge,
  outcomeKeyFromDraftForMerge,
} from "../lib/market/grouped-market-merge";
import {
  NONE_OF_THEM_OUTCOME_LABEL,
  normalizeOutcomeLabel,
} from "../lib/market/group-feed-markets";
import type { MarketDraft } from "../lib/types/market";
import type { MarketRecord } from "../lib/types/market-record";

function row(partial: Partial<MarketRecord> & Pick<MarketRecord, "slug">): MarketRecord {
  const base = {
    id: partial.id ?? partial.slug,
    slug: partial.slug,
    title: partial.title ?? partial.slug,
    description: partial.description ?? "",
    category: partial.category ?? "predicted",
    creator_wallet: partial.creator_wallet ?? "x",
    resolver_wallet: partial.resolver_wallet ?? "y",
    resolution_source: partial.resolution_source ?? "Official",
    resolution_rules: partial.resolution_rules ?? "YES: win\n\nNO: else",
    yes_condition: partial.yes_condition ?? "YES if wins.",
    no_condition: partial.no_condition ?? "NO otherwise.",
    expiry_ts: partial.expiry_ts ?? "2099-01-01T00:00:00.000Z",
    resolve_after: partial.resolve_after ?? partial.expiry_ts ?? "2099-01-01T00:00:00.000Z",
    resolution_status: partial.resolution_status ?? "active",
    resolved_outcome: partial.resolved_outcome ?? null,
    resolved_at: partial.resolved_at ?? null,
    yes_mint: partial.yes_mint ?? null,
    no_mint: partial.no_mint ?? null,
    pool_address: partial.pool_address ?? null,
    status: partial.status ?? "live",
    created_tx: partial.created_tx ?? null,
    created_at: partial.created_at ?? new Date().toISOString(),
    event_group_key: partial.event_group_key ?? null,
    event_title: partial.event_title ?? null,
    outcome_label: partial.outcome_label ?? null,
    outcome_type: partial.outcome_type ?? null,
    group_order: partial.group_order ?? null,
  } satisfies MarketRecord;
  return base;
}

function draft(
  outcomeLabel: string,
  extra?: Partial<MarketDraft>,
): MarketDraft {
  return {
    question: `Will ${outcomeLabel} win SparkIdeas Hackathon?`,
    description: "Test",
    expiry: "2099-06-01T00:00:00.000Z",
    resolutionRules: `YES: ${outcomeLabel} wins.\n\nNO: otherwise.`,
    resolutionSource: "Official",
    aiReasoning: "",
    suggestedRules: [],
    outcomeLabel,
    eventGroupKey: "sparkideas-hackathon-winner",
    eventTitle: "SparkIdeas Hackathon — Winner",
    outcomeType: "winner",
    groupOrder: 0,
    ...extra,
  };
}

const cuddly = row({
  slug: "cuddly-sparkideas",
  outcome_label: "Cuddly",
  group_order: 0,
  event_group_key: "sparkideas-hackathon-winner",
  event_title: "SparkIdeas Hackathon — Winner",
});

const evan = row({
  slug: "evan-sparkideas",
  outcome_label: "Evan",
  group_order: 1,
  event_group_key: "sparkideas-hackathon-winner",
  event_title: "SparkIdeas Hackathon — Winner",
});

const matt = row({
  slug: "matt-sparkideas",
  outcome_label: "Matt",
  group_order: 2,
  event_group_key: "sparkideas-hackathon-winner",
  event_title: "SparkIdeas Hackathon — Winner",
});

const noneRow = row({
  slug: "none-sparkideas",
  outcome_label: NONE_OF_THEM_OUTCOME_LABEL,
  group_order: 3,
  event_group_key: "sparkideas-hackathon-winner",
  event_title: "SparkIdeas Hackathon — Winner",
});

const existing = [cuddly, evan, matt];

const proposed = [
  draft("Cuddly"),
  draft("Evan"),
  draft("Matt"),
  draft("Tobias"),
];

const m1 = mergeProposedGroupedDraftsWithExistingMembers({
  proposedDrafts: proposed,
  existingMembers: existing,
});
assert.equal(m1.draftsToCreate.length, 1);
assert.equal(m1.reusedCount, 3);
assert.equal(m1.newCount, 1);
assert.ok(m1.draftsToCreate[0]!.outcomeLabel === "Tobias");
assert.ok(m1.mergeNotice?.includes("already exist"));
assert.ok(m1.mergeNotice?.includes("will be added"));

const m2 = mergeProposedGroupedDraftsWithExistingMembers({
  proposedDrafts: proposed.slice(0, 3),
  existingMembers: existing,
});
assert.equal(m2.newCount, 0);
assert.ok(m2.mergeNotice?.includes("already exist"));

const a = normalizeEventTitleForGroupDedup("SparkIdeas Hackathon — Winner");
const b = normalizeEventTitleForGroupDedup("The Next SparkIdeas Hackathon Winner!");
assert.equal(a, b);

const proposedNoneDup = [
  ...proposed,
  draft(NONE_OF_THEM_OUTCOME_LABEL, {
    question: `Will none of the listed options win SparkIdeas Hackathon?`,
  }),
];

const m3 = mergeProposedGroupedDraftsWithExistingMembers({
  proposedDrafts: proposedNoneDup,
  existingMembers: [...existing, noneRow],
});
const noneK = normalizeOutcomeLabel(NONE_OF_THEM_OUTCOME_LABEL);
const noneDrafts = m3.draftsToCreate.filter(
  (d) => outcomeKeyFromDraftForMerge(d) === noneK,
);
assert.equal(noneDrafts.length, 0);

assert.equal(
  normalizeOutcomeKeyForGroupedMerge("8th May"),
  normalizeOutcomeKeyForGroupedMerge("May 8"),
);
assert.equal(
  normalizeOutcomeKeyForGroupedMerge("may 9"),
  normalizeOutcomeKeyForGroupedMerge("9th may"),
);

console.info("[verify-grouped-market-merge] ok");

import type { MarketDraft } from "@/lib/types/market";

/**
 * MVP stub — replace with real model + validation via API route.
 */
export function extractMarketFromPrompt(userText: string): MarketDraft {
  const trimmed = userText.trim() || "Untitled market";
  const hasJune2027 = /june\s+2027|2027-06/i.test(trimmed);
  const expiry = hasJune2027
    ? "2027-06-30T23:59:59.000Z"
    : new Date(Date.now() + 86400000 * 365).toISOString();

  const rules = [
    "Resolver verifies the outcome using primary public sources cited below.",
    "Ambiguous phrasing defaults to NO unless YES is clearly satisfied.",
    "Disputes follow the on-chain arbitration policy in protocol params.",
  ];

  return {
    question: trimmed,
    description:
      "Binary market settled on observable public facts. Fees may apply on trade and redemption.",
    expiry,
    resolutionRules: rules.join(" "),
    resolutionSource: "Primary sources (official accounts, timestamps, archives).",
    aiReasoning:
      "The proposition is scoped to a measurable event with a public paper trail. Expiry is aligned with your date clause or defaults to 12 months. Verified Twitter/X API or archive snapshots can confirm the tweet text.",
    suggestedRules: [
      "YES if a post on @username contains the exact substring before expiry; NO otherwise.",
      "Deletes after posting do not count unless archived.",
      "Typos must match character-for-character for short phrases.",
    ],
  };
}

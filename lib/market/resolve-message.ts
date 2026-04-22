import type { OutcomeSide } from "@/lib/types/market";

/** Ed25519 message bytes — must match client `signMessage` input exactly. */
const PREFIX = "predicted:resolve:v1|";

export function buildMarketResolveMessageV1(
  slug: string,
  winningOutcome: OutcomeSide,
): string {
  return `${PREFIX}${slug.trim()}|${winningOutcome}`;
}

export function parseMarketResolveMessageV1(
  message: string,
): { slug: string; winningOutcome: OutcomeSide } | null {
  if (!message.startsWith(PREFIX)) return null;
  const rest = message.slice(PREFIX.length);
  const lastBar = rest.lastIndexOf("|");
  if (lastBar < 0) return null;
  const slug = rest.slice(0, lastBar).trim();
  const side = rest.slice(lastBar + 1).trim().toLowerCase();
  if (side !== "yes" && side !== "no") return null;
  if (!slug) return null;
  return { slug, winningOutcome: side };
}

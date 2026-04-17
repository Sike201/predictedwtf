/** Display helpers: pool prices as whole cents (prediction-market style). */

export function probabilityToCentsInt(p: number): number {
  return Math.round(Math.max(0, Math.min(1, p)) * 100);
}

/** e.g. 67c */
export function formatProbabilityAsWholeCents(p: number): string {
  return `${probabilityToCentsInt(p)}c`;
}

/**
 * e.g. 63.8c for avg entry — one decimal when needed.
 */
export function formatUsdPerShareAsCents(priceUsd: number): string {
  if (!Number.isFinite(priceUsd) || priceUsd < 0) return "—";
  const cents = priceUsd * 100;
  const rounded = Math.round(cents * 10) / 10;
  if (Number.isInteger(rounded)) return `${rounded}c`;
  return `${rounded.toFixed(1)}c`;
}

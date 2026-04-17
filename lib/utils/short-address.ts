/**
 * Shorten a Solana base58 address for display (e.g. `4JpP…jQUZ`).
 * @param chars - visible chars at start/end when length allows
 */
export function shortAddress(
  address: string,
  chars: { start?: number; end?: number } = {},
): string {
  const start = chars.start ?? 4;
  const end = chars.end ?? 4;
  const s = address.trim();
  if (s.length <= start + end + 1) return s;
  return `${s.slice(0, start)}…${s.slice(-end)}`;
}

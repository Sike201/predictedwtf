/** Supabase / PostgREST may return `double precision` as number or string. */
export function coerceUsdVolumeFromDb(raw: unknown): number {
  if (raw == null) return 0;
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? Math.max(0, raw) : 0;
  }
  if (typeof raw === "string") {
    const t = raw.trim();
    if (t === "") return 0;
    const n = Number(t);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }
  return 0;
}

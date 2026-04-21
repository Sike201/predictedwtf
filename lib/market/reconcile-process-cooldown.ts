/**
 * In-process guard: avoid overlapping heavy `fetchPoolTotalSwapVolumeUsdWithStats` runs
 * for the same slug within a short window (bursts from homepage + hover + detail).
 *
 * Note: Not shared across serverless instances; DB TTL (`last_stats_updated_at`) remains
 * the cross-instance dedupe. This reduces duplicate work within a warm Node process.
 */
export const RECONCILE_PROCESS_COOLDOWN_MS = 90 * 1_000;

const lastHeavyReconcileStartMs = new Map<string, number>();

/**
 * Claim a slot before starting the paginated on-chain volume scan. `force` bypasses cooldown.
 * On success, the same slug is suppressed for {@link RECONCILE_PROCESS_COOLDOWN_MS}.
 */
export function tryAcquireHeavyReconcileSlot(
  slug: string,
  force: boolean,
): { acquired: boolean; remainingMs?: number } {
  if (force) {
    return { acquired: true };
  }
  const now = Date.now();
  const last = lastHeavyReconcileStartMs.get(slug);
  if (
    last != null &&
    now - last < RECONCILE_PROCESS_COOLDOWN_MS
  ) {
    return {
      acquired: false,
      remainingMs: RECONCILE_PROCESS_COOLDOWN_MS - (now - last),
    };
  }
  lastHeavyReconcileStartMs.set(slug, now);
  return { acquired: true };
}

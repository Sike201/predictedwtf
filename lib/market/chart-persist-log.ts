/** Server + client logs for chart DB writes (grep: `[predicted][chart-persist]`). */
export const CHART_PERSIST_LOG = "[predicted][chart-persist]";

export type ChartPersistEvent =
  | "recordAfterTrade_called"
  | "api_post_enter"
  | "market_lookup_ok"
  | "snapshot_upsert_ok"
  | "snapshot_upsert_skip"
  | "snapshot_upsert_fail";

export function logChartPersist(
  event: ChartPersistEvent,
  payload: Record<string, unknown>,
): void {
  console.info(`${CHART_PERSIST_LOG} ${event}`, payload);
}

/** Structured logs for the chart ↔ `market_price_history` pipeline (grep: `[predicted][chart-snapshot]`). */
export const CHART_SNAPSHOT_LOG = "[predicted][chart-snapshot]";

export type ChartSnapshotEvent =
  | "recordAfterTrade_called"
  | "api_enter"
  | "snapshot_upsert_ok"
  | "snapshot_upsert_skip"
  | "snapshot_upsert_fail"
  | "row_count_for_market"
  | "market_lookup";

export function logChartSnapshot(
  event: ChartSnapshotEvent,
  payload: Record<string, unknown>,
): void {
  console.info(CHART_SNAPSHOT_LOG, { event, ...payload });
}

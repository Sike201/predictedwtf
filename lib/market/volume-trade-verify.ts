/**
 * Dev / API payload: result of incremental volume handling after a trade snapshot.
 * (Types only — safe to import from client bundles.)
 */
export type VolumeTradeVerify = {
  txSignature: string;
  isNewSnapshotRow: boolean;
  volumeDeltaParsedUsd: number;
  previousLastKnownVolumeUsd: number | null;
  newLastKnownVolumeUsd: number | null;
  dbIncrementAttempted: boolean;
  /** False when increment was attempted but failed; true when not attempted or succeeded. */
  dbIncrementSucceeded: boolean;
  dbIncrementError?: string;
  /** New history row + swap notion > 0 + DB increment succeeded */
  incrementalVolumeApplied: boolean;
  skipReason?: string;
  serverProcessingMs: number;
};

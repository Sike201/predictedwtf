import {
  nonEmptyTimestampString,
  parseExpiryEpochMs,
  parseInstantUtcMs,
  parseResolveAfterEpochMs,
} from "@/lib/market/utc-instant";
import type { MarketRecord } from "@/lib/types/market-record";
import type { MarketLifecycleStatus, MarketPhase } from "@/lib/types/market";

const LOG = "[predicted][market-status]";
const TIME_DEBUG = "[predicted][market-time-debug]";

type LifecycleGlobal = {
  __predictedLifecycleLogged?: {
    resolving: Set<string>;
  };
};

function lifecycleLogged(): { resolving: Set<string> } {
  const g = globalThis as unknown as LifecycleGlobal;
  if (!g.__predictedLifecycleLogged) {
    g.__predictedLifecycleLogged = { resolving: new Set() };
  }
  return g.__predictedLifecycleLogged;
}

export { parseResolveAfterEpochMs } from "@/lib/market/utc-instant";

export function isPastResolveAfter(
  record: Pick<MarketRecord, "resolve_after" | "expiry_ts">,
  nowMs: number = Date.now(),
): boolean {
  const t = parseResolveAfterEpochMs(record);
  if (t == null || !Number.isFinite(t) || t <= 0) return false;
  return nowMs >= t;
}

/**
 * - DB `resolved` → `resolved` / `resolved`.
 * - Not `live` → `raising` (never "resolving" from the clock before tradeable).
 * - `live` and `now < resolveAfter` (effective instant) → `trading` (defensive `now < r` first).
 * - `live`, `active`, `now >= resolveAfter` → `resolving`.
 * - Missing/unparseable end time → `trading` (never default to "resolving").
 * All `resolveAfter` / `expiry` instants are compared as **UTC epoch ms**; see `utc-instant.ts`.
 */
export function computeMarketLifecycle(
  record: MarketRecord,
  nowMs: number = Date.now(),
  slug: string = record.slug,
): { lifecycle: MarketLifecycleStatus; phase: MarketPhase } {
  const db = record.resolution_status ?? "active";
  const status = record.status;

  if (db === "resolved") {
    return { lifecycle: "resolved", phase: "resolved" };
  }

  if (status !== "live") {
    return { lifecycle: "active", phase: "raising" };
  }

  const r = parseResolveAfterEpochMs(record);
  if (r == null) {
    return { lifecycle: "active", phase: "trading" };
  }
  if (nowMs < r) {
    return { lifecycle: "active", phase: "trading" };
  }
  if (db === "active") {
    return { lifecycle: "resolving", phase: "resolving" };
  }
  return { lifecycle: "active", phase: "trading" };
}

function msToIso(ms: number | null): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function logMarketTimeDebug(
  record: MarketRecord,
  result: { lifecycle: MarketLifecycleStatus; phase: MarketPhase },
  nowMs: number,
): void {
  const raRaw = (record as { resolve_after?: unknown }).resolve_after;
  const exRaw = (record as { expiry_ts?: unknown }).expiry_ts;
  const crRaw = (record as { created_at?: unknown }).created_at;
  const raStr = nonEmptyTimestampString(raRaw);
  const parsedExpMs = parseExpiryEpochMs(
    record as Pick<MarketRecord, "expiry_ts">,
  );
  const parsedExpIso = msToIso(parsedExpMs);
  const raOnlyMs = raStr != null ? parseInstantUtcMs(raStr) : null;
  const raOnlyIso = msToIso(raOnlyMs);
  const pastEx =
    parsedExpMs != null && nowMs >= parsedExpMs && Number.isFinite(parsedExpMs);
  const effectiveR = parseResolveAfterEpochMs(
    record as Pick<MarketRecord, "resolve_after" | "expiry_ts">,
  );
  const pastR =
    effectiveR != null &&
    nowMs >= effectiveR &&
    Number.isFinite(effectiveR);

  console.info(
    TIME_DEBUG,
    JSON.stringify({
      slug: record.slug,
      title: record.title,
      created_at_raw: crRaw,
      expiry_ts_raw: exRaw,
      resolve_after_raw: raRaw,
      now_iso: new Date(nowMs).toISOString(),
      now_epoch_ms: nowMs,
      parsed_expiry_iso: parsedExpIso,
      parsed_expiry_epoch_ms: parsedExpMs,
      parsed_resolve_after_iso: raOnlyIso,
      parsed_resolve_after_epoch_ms: raOnlyMs,
      db_resolution_status: record.resolution_status ?? "active",
      computed_lifecycle: result.lifecycle,
      computed_phase: result.phase,
      isPastExpiry: pastEx,
      isPastResolveAfter: pastR,
    }),
  );
}

/**
 * After computing, emit lifecycle logs.
 * Call from `marketRecordToMarket` only.
 */
export function logMarketLifecycleTransition(
  record: MarketRecord,
  result: { lifecycle: MarketLifecycleStatus; phase: MarketPhase },
  slug: string = record.slug,
  nowMs: number = Date.now(),
): void {
  const { lifecycle, phase } = result;
  const db = record.resolution_status ?? "active";
  const past = isPastResolveAfter(record, nowMs);
  const resolveAfterMs = parseResolveAfterEpochMs(record);

  logMarketTimeDebug(record, result, nowMs);

  console.info(LOG, "status_computed", {
    slug,
    now: nowMs,
    dbMarketStatus: record.status,
    resolveAfterRaw: record.resolve_after,
    expiryTsRaw: record.expiry_ts,
    resolveAfterEpochMs: resolveAfterMs,
    dbResolutionStatus: db,
    pastResolveAfter: past,
    computedLifecycle: lifecycle,
    computedPhase: phase,
  });

  if (lifecycle === "resolving" && !lifecycleLogged().resolving.has(slug)) {
    lifecycleLogged().resolving.add(slug);
    console.info(LOG, "entered_resolving", { slug });
  }
}

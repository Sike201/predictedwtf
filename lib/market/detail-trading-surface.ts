import {
  nonEmptyTimestampString,
  parseExpiryEpochMs,
  parseInstantUtcMs,
  parseResolveAfterEpochMs,
} from "@/lib/market/utc-instant";
import type { MarketRecord } from "@/lib/types/market-record";
import type { Market, MarketLifecycleStatus, MarketPhase } from "@/lib/types/market";

const TRACE = "[predicted][market-phase-trace]";
const TIME = "[predicted][market-time-debug]";
const UI_STATE = "[predicted][ui-state-trace]";

/**
 * Browser: single JSON line describing **what the detail page actually renders** vs raw RSC `market`.
 * Gated to development to avoid console noise in production.
 */
export function logUiStateTraceClient(params: {
  rawMarket: Market;
  displayMarket: Market;
  tr: EffectiveDetailTrading;
  nowMs: number;
}): void {
  if (process.env.NODE_ENV !== "development" || typeof window === "undefined")
    return;
  const { rawMarket, displayMarket, tr, nowMs } = params;
  const endMs = tr.endMs;
  const endIso =
    endMs != null && Number.isFinite(endMs) ? new Date(endMs).toISOString() : null;
  console.info(
    UI_STATE,
    JSON.stringify({
      slug: displayMarket.id,
      component: "MarketDetailView",
      now_iso: new Date(nowMs).toISOString(),
      sourceObjectName_forHeaderTradingResolver: "displayMarket (useMemo: raw market + tr.effectivePhase + tr.effectiveResolutionStatus)",
      rawRsc: {
        phase: rawMarket.phase,
        resolutionStatus: rawMarket.resolution.status,
        resolveAfter_raw: rawMarket.resolution.resolveAfter,
        expiry_raw: rawMarket.expiry,
      },
      displayed: {
        phase: displayMarket.phase,
        resolutionStatus: displayMarket.resolution.status,
      },
      tradingOpen: tr.effectiveTradingOpen,
      effectiveIsResolving: tr.effectiveIsResolving,
      futureEndOverride: tr.futureEndOverride,
      parsedActiveEndMs: endMs,
      parsedActiveEndIso: endIso,
      wiring: {
        MarketDetailHeader: "prop market=displayMarket",
        TradingPanel: "prop market=displayMarket",
        MarketResolverPanel: "prop market=displayMarket",
        MarketChartBlock: "prop market=displayMarket",
        MarketDetailTabs: "prop market=displayMarket",
        YourPositionPanel: "prop market=displayMarket",
      },
    }),
  );
}

export type EffectiveDetailTrading = {
  effectivePhase: MarketPhase;
  effectiveResolutionStatus: MarketLifecycleStatus;
  effectiveTradingOpen: boolean;
  effectiveIsResolving: boolean;
  endMs: number | null;
  /** true when the future-end guard overrode an incorrect resolving / phase */
  futureEndOverride: boolean;
};

/**
 * Re-derives `phase` / `tradingOpen` from raw ISO on the market using the same UTC
 * parser as the server, so a bad SSR snapshot can’t keep “resolving” when the
 * end instant is still in the future.
 */
export function getEffectiveDetailTrading(
  market: Market,
  nowMs: number = Date.now(),
): EffectiveDetailTrading {
  if (market.resolution.status === "resolved") {
    return {
      effectivePhase: market.phase,
      effectiveResolutionStatus: "resolved",
      effectiveTradingOpen: false,
      effectiveIsResolving: false,
      endMs: null,
      futureEndOverride: false,
    };
  }
  const recordLike: Pick<MarketRecord, "resolve_after" | "expiry_ts"> = {
    resolve_after: market.resolution.resolveAfter,
    expiry_ts: market.expiry,
  };
  const endMs = parseResolveAfterEpochMs(
    recordLike as Pick<Record<string, unknown>, "resolve_after" | "expiry_ts">,
  );
  if (endMs == null) {
    const isR = market.resolution.status === "resolving";
    return {
      effectivePhase: market.phase,
      effectiveResolutionStatus: market.resolution.status,
      effectiveTradingOpen:
        market.kind === "binary" &&
        market.phase === "trading" &&
        market.resolution.status === "active",
      effectiveIsResolving: isR,
      endMs: null,
      futureEndOverride: false,
    };
  }
  if (nowMs < endMs) {
    return {
      effectivePhase: "trading",
      effectiveResolutionStatus: "active",
      effectiveTradingOpen: market.kind === "binary",
      effectiveIsResolving: false,
      endMs,
      futureEndOverride:
        market.resolution.status === "resolving" || market.phase === "resolving",
    };
  }
  return {
    effectivePhase: market.phase,
    effectiveResolutionStatus: market.resolution.status,
    effectiveTradingOpen:
      market.kind === "binary" &&
      market.phase === "trading" &&
      market.resolution.status === "active",
    effectiveIsResolving: market.resolution.status === "resolving",
    endMs,
    futureEndOverride: false,
  };
}

function msToIso(ms: number | null): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

/** Server / RSC: one JSON line in **server** stdout (not the browser). */
export function logMarketTraceServer(params: {
  where: string;
  record: MarketRecord;
  market: Market;
  nowMs: number;
}): void {
  const { where, record, market, nowMs } = params;
  const ra = record.resolve_after;
  const ex = record.expiry_ts;
  const raS = nonEmptyTimestampString(ra);
  const parsedExp = parseExpiryEpochMs(record);
  const parsedRa = raS != null ? parseInstantUtcMs(raS) : null;
  const end = parseResolveAfterEpochMs(
    record as Pick<Record<string, unknown>, "resolve_after" | "expiry_ts">,
  );
  const eff = getEffectiveDetailTrading(market, nowMs);
  const payload = {
    source: where,
    slug: record.slug,
    title: record.title,
    created_at_raw: record.created_at,
    expiry_ts_raw: ex,
    resolve_after_raw: ra,
    now_iso: new Date(nowMs).toISOString(),
    now_epoch_ms: nowMs,
    parsed_expiry_iso: msToIso(parsedExp),
    parsed_resolve_after_iso: msToIso(parsedRa),
    /** `pick(resolve_after) ?? expiry` — ISO for grep; `parse_end_ms` is the same instant */
    active_end_parsed_iso: end != null ? new Date(end).toISOString() : null,
    computed_lifecycle: market.resolution.status,
    computed_phase: market.phase,
    market_phase_after_adapter: market.phase,
    market_resolution_status_after_adapter: market.resolution.status,
    tradingOpen_naive:
      market.phase === "trading" &&
      market.kind === "binary" &&
      market.resolution.status !== "resolved" &&
      market.resolution.status !== "resolving",
    tradingOpen_effective: eff.effectiveTradingOpen,
    futureEndOverride: eff.futureEndOverride,
    parse_end_ms: end,
  };
  console.info(TRACE, JSON.stringify(payload));
  console.info(
    TIME,
    JSON.stringify({
      ...payload,
      parsed_expiry_epoch_ms: parsedExp,
      parsed_resolve_after_epoch_ms: parsedRa,
      isPastExpiry: parsedExp != null && nowMs >= parsedExp,
      isPastResolveAfter: end != null && nowMs >= end,
    }),
  );
}

/** Client: one JSON line in **browser** console. */
export function logMarketTraceClient(params: { where: string; market: Market }): void {
  const nowMs = Date.now();
  const { where, market } = params;
  const recordLike: Pick<MarketRecord, "resolve_after" | "expiry_ts"> = {
    resolve_after: market.resolution.resolveAfter,
    expiry_ts: market.expiry,
  };
  const ra = market.resolution.resolveAfter;
  const ex = market.expiry;
  const raS = nonEmptyTimestampString(ra);
  const parsedExp = parseExpiryEpochMs(
    recordLike as Pick<Record<string, unknown>, "expiry_ts">,
  );
  const parsedRa = raS != null ? parseInstantUtcMs(raS) : null;
  const end = parseResolveAfterEpochMs(
    recordLike as Pick<Record<string, unknown>, "resolve_after" | "expiry_ts">,
  );
  const eff = getEffectiveDetailTrading(market, nowMs);
  const payload = {
    source: where,
    slug: market.id,
    title: market.question,
    created_at_raw: "from_market_createdAt",
    market_createdAt_ms: market.createdAt,
    market_createdAt_iso: new Date(market.createdAt).toISOString(),
    expiry_ts_raw: ex,
    resolve_after_raw: ra,
    now_iso: new Date(nowMs).toISOString(),
    now_epoch_ms: nowMs,
    parsed_expiry_iso: msToIso(parsedExp),
    parsed_resolve_after_iso: msToIso(parsedRa),
    computed_lifecycle: market.resolution.status,
    computed_phase: market.phase,
    market_phase_from_props: market.phase,
    market_resolution_status_from_props: market.resolution.status,
    tradingOpen_naive:
      market.phase === "trading" &&
      market.kind === "binary" &&
      market.resolution.status !== "resolved" &&
      market.resolution.status !== "resolving",
    tradingOpen_effective: eff.effectiveTradingOpen,
    futureEndOverride: eff.futureEndOverride,
    parse_end_ms: end,
  };
  console.info(TRACE, JSON.stringify(payload));
  console.info(
    TIME,
    JSON.stringify({
      ...payload,
      parsed_expiry_epoch_ms: parsedExp,
      parsed_resolve_after_epoch_ms: parsedRa,
      isPastExpiry: parsedExp != null && nowMs >= parsedExp,
      isPastResolveAfter: end != null && nowMs >= end,
    }),
  );
}

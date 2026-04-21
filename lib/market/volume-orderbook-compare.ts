import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";

import type { OnchainPoolActivityEntry } from "@/lib/solana/fetch-pool-onchain-activity";
import { fetchSingleTxTradeVolumeUsd } from "@/lib/solana/fetch-pool-onchain-activity";
import { getSupabaseAdmin } from "@/lib/supabase/server-client";

const SWAP_ROW = /^(BUY|SELL) (YES|NO)$/;

/**
 * Order book row `summary` is already a USDC string (e.g. "$12.40"); used for log parity only.
 */
function parseUsdFromOrderbookSummary(summary: string): number | null {
  const m = summary.replace(/,/g, "").match(/\$?\s*([\d.]+)/);
  if (!m?.[1]) return null;
  const n = Number.parseFloat(m[1]!);
  return Number.isFinite(n) ? n : null;
}

export type VolumeOrderbookSampleLog = {
  txSignature: string;
  appearsInOrderbookActivity: true;
  orderbookLabel: string;
  orderbookSummaryNotionalParsedUsd: number | null;
  /** Same path as incremental volume (`fetchSingleTxTradeVolumeUsd`). */
  volumePipelineUsd: number;
  volumePipelineSource: string;
  /** Regex: BUY/SELL YES/NO — what the order book stats filter uses. */
  orderbookCountsAsSwapRow: boolean;
  /** `market_price_history` contains this tx for this market. */
  dbHasPriceSnapshotRow: boolean | null;
};

/**
 * Dev-only: one recent on-chain row vs the volume parser + optional DB snapshot row.
 */
export async function compareVolumePipelineToOrderbookEntry(params: {
  connection: Connection;
  marketId: string;
  yesMint: PublicKey;
  noMint: PublicKey;
  /** Typically newest activity row (same list as order book UI). */
  sample: OnchainPoolActivityEntry;
}): Promise<VolumeOrderbookSampleLog> {
  const { connection, marketId, yesMint, noMint, sample } = params;
  const txSignature = sample.signature;

  const volume = await fetchSingleTxTradeVolumeUsd(connection, {
    signature: txSignature,
    yesMint,
    noMint,
  });

  let dbHasPriceSnapshotRow: boolean | null = null;
  const sb = getSupabaseAdmin();
  if (sb) {
    const { data } = await sb
      .from("market_price_history")
      .select("tx_signature")
      .eq("market_id", marketId)
      .eq("tx_signature", txSignature)
      .maybeSingle();
    dbHasPriceSnapshotRow = Boolean(data);
  }

  const orderbookCountsAsSwapRow = SWAP_ROW.test(sample.label);
  const summaryN = parseUsdFromOrderbookSummary(sample.summary);

  return {
    txSignature,
    appearsInOrderbookActivity: true,
    orderbookLabel: sample.label,
    orderbookSummaryNotionalParsedUsd: summaryN,
    volumePipelineUsd: volume.volumeUsd,
    volumePipelineSource: volume.source,
    orderbookCountsAsSwapRow,
    dbHasPriceSnapshotRow,
  };
}

export function logVolumeVsOrderbookDev(
  payload: VolumeOrderbookSampleLog & { skipReasonIfNotCounted?: string },
): void {
  const heuristicIncludedInTotalVolume =
    payload.dbHasPriceSnapshotRow === true &&
    payload.volumePipelineUsd > 0 &&
    payload.volumePipelineSource !== "no_parsed_tx" &&
    payload.volumePipelineSource !== "tx_meta_err";

  const skipReasonIfNotCounted =
    payload.skipReasonIfNotCounted ??
    (heuristicIncludedInTotalVolume
      ? undefined
      : payload.dbHasPriceSnapshotRow === false
        ? "no_market_price_history_row — POST /api/market/price-history did not persist this tx"
        : payload.volumePipelineUsd <= 0
          ? `volume_parser_delta_zero (${payload.volumePipelineSource})`
          : "unknown");

  console.info("[predicted][volume-vs-orderbook]", {
    txSignature: payload.txSignature,
    appearsInOrderbook: payload.appearsInOrderbookActivity,
    orderbookNotionalUsd: payload.orderbookSummaryNotionalParsedUsd,
    orderbookLabel: payload.orderbookLabel,
    volumeParserDeltaUsd: payload.volumePipelineUsd,
    volumeParserSource: payload.volumePipelineSource,
    includedInTotalVolume_heuristic: heuristicIncludedInTotalVolume,
    skipReasonIfNotCounted,
    dbHasPriceSnapshotRow: payload.dbHasPriceSnapshotRow,
  });
}

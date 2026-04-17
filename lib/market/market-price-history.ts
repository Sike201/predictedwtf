import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";

import { deriveMarketProbabilityFromPoolState } from "@/lib/market/derive-market-probability";
import { readOmnipairPoolState } from "@/lib/solana/read-omnipair-pool-state";
import { getSupabaseAdmin } from "@/lib/supabase/server-client";

const LP = "[predicted][market-price-history]";

export type MarketPriceHistoryPoint = {
  t: number;
  p: number;
  reserveYes: string;
  reserveNo: string;
  txSignature: string;
};

async function resolveSnapshotTimeMs(
  connection: Connection,
  txSignature: string,
): Promise<number> {
  try {
    const tx = await connection.getTransaction(txSignature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    const bt = tx?.blockTime;
    if (typeof bt === "number" && Number.isFinite(bt)) {
      return bt * 1000;
    }
  } catch {
    /* fall through */
  }
  return Date.now();
}

/**
 * Reads Omnipair vault reserves and upserts `(market_id, tx_signature)`.
 * `yes_price` is the YES spot from reserves (same as deriveMarketProbabilityFromPoolState).
 */
export async function recordMarketPriceSnapshotFromChain(params: {
  marketId: string;
  txSignature: string;
  connection: Connection;
  pairAddress: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = getSupabaseAdmin();
  if (!sb) {
    return { ok: false, error: "Supabase not configured." };
  }

  const { marketId, txSignature, connection, pairAddress, yesMint, noMint } =
    params;

  let state;
  try {
    state = await readOmnipairPoolState(connection, {
      pairAddress,
      yesMint,
      noMint,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${LP} read pool failed`, marketId, msg);
    return { ok: false, error: msg };
  }

  const derived = deriveMarketProbabilityFromPoolState({
    reserveYes: state.reserveYes,
    reserveNo: state.reserveNo,
  });
  if (!derived) {
    return { ok: false, error: "Could not derive YES price from pool reserves." };
  }

  const snapshotMs = await resolveSnapshotTimeMs(connection, txSignature);
  const snapshotIso = new Date(snapshotMs).toISOString();

  const reserveYesStr = state.reserveYes.toString();
  const reserveNoStr = state.reserveNo.toString();
  const yesPrice = derived.yesProbability;

  const row = {
    market_id: marketId,
    tx_signature: txSignature,
    snapshot_ts: snapshotIso,
    reserve_yes: reserveYesStr,
    reserve_no: reserveNoStr,
    yes_price: yesPrice,
  };

  const { error } = await sb.from("market_price_history").upsert(row, {
    onConflict: "market_id,tx_signature",
  });

  if (error) {
    console.error(`${LP} upsert failed`, marketId, error.message);
    return { ok: false, error: error.message };
  }

  if (process.env.NODE_ENV === "development") {
    console.info(`${LP} recorded`, {
      txSignature,
      snapshot_ts: snapshotIso,
      reserveYes: reserveYesStr,
      reserveNo: reserveNoStr,
      yesPrice,
    });
  } else {
    console.info(`${LP} recorded`, {
      marketId: marketId.slice(0, 8),
      tx: txSignature.slice(0, 8),
      yesPrice,
    });
  }

  return { ok: true };
}

export async function fetchMarketPriceHistoryPoints(
  slug: string,
): Promise<MarketPriceHistoryPoint[]> {
  const sb = getSupabaseAdmin();
  if (!sb) return [];

  const { data: market, error: mErr } = await sb
    .from("markets")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  if (mErr || !market) {
    if (mErr) console.error(`${LP} market lookup failed`, slug, mErr.message);
    return [];
  }

  const { data, error } = await sb
    .from("market_price_history")
    .select("tx_signature, snapshot_ts, reserve_yes, reserve_no, yes_price")
    .eq("market_id", market.id)
    .order("snapshot_ts", { ascending: true });

  if (error) {
    console.error(`${LP} fetch failed`, slug, error.message);
    return [];
  }

  const rows = (data ?? []) as Array<{
    tx_signature: string;
    snapshot_ts: string;
    reserve_yes: string;
    reserve_no: string;
    yes_price: number;
  }>;

  return rows.map((r) => ({
    t: Date.parse(r.snapshot_ts),
    p: r.yes_price,
    reserveYes: r.reserve_yes,
    reserveNo: r.reserve_no,
    txSignature: r.tx_signature,
  }));
}

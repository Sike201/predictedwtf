import { getSupabaseAdmin } from "@/lib/supabase/server-client";

/**
 * Exactly once per (marketId, txSignature): insert a credit row, then add USD to
 * `markets.last_known_volume_usd`. Caller increments only when `isFirstClaim` is true.
 */
export async function tryInsertTradeVolumeCreditRow(params: {
  marketId: string;
  txSignature: string;
  volumeUsd: number;
}): Promise<
  | { ok: true; isFirstClaim: true }
  | { ok: true; isFirstClaim: false }
  | { ok: false; error: string }
> {
  if (!Number.isFinite(params.volumeUsd) || params.volumeUsd <= 0) {
    return { ok: true, isFirstClaim: false };
  }
  const sb = getSupabaseAdmin();
  if (!sb) {
    return { ok: false, error: "Supabase not configured" };
  }
  const { error } = await sb.from("market_tx_volume_credits").insert({
    market_id: params.marketId,
    tx_signature: params.txSignature,
    volume_usd: params.volumeUsd,
  });
  if (!error) {
    return { ok: true, isFirstClaim: true };
  }
  const code = (error as { code?: string })?.code;
  const msg = error.message ?? "";
  if (code === "23505" || /duplicate key|unique/i.test(msg)) {
    return { ok: true, isFirstClaim: false };
  }
  return { ok: false, error: msg };
}

export async function deleteTradeVolumeCreditRow(params: {
  marketId: string;
  txSignature: string;
}): Promise<void> {
  const sb = getSupabaseAdmin();
  if (!sb) return;
  await sb
    .from("market_tx_volume_credits")
    .delete()
    .eq("market_id", params.marketId)
    .eq("tx_signature", params.txSignature);
}

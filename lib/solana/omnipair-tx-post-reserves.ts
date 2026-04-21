import { PublicKey } from "@solana/web3.js";
import type { ParsedTransactionWithMeta } from "@solana/web3.js";

import type { DerivedOmnipairLayout } from "@/lib/solana/omnipair-pda";

/** Full account key list for parsed txs (legacy + v0 with loaded addresses). */
export function resolveParsedTxAccountKeys(
  tx: ParsedTransactionWithMeta,
): PublicKey[] {
  const msg = tx.transaction.message as unknown as {
    staticAccountKeys?: PublicKey[];
    accountKeys?: Array<PublicKey | { pubkey: PublicKey }>;
  };
  const meta = tx.meta;
  if (msg.staticAccountKeys?.length) {
    const loaded = meta?.loadedAddresses;
    if (loaded?.writable?.length || loaded?.readonly?.length) {
      return [
        ...msg.staticAccountKeys,
        ...(loaded.writable ?? []).map((s) => new PublicKey(s)),
        ...(loaded.readonly ?? []).map((s) => new PublicKey(s)),
      ];
    }
    return [...msg.staticAccountKeys];
  }
  if (msg.accountKeys?.length) {
    return msg.accountKeys.map((k) =>
      k instanceof PublicKey ? k : k.pubkey,
    );
  }
  return [];
}

/**
 * Post-transaction reserve vault balances from tx meta (post-token balances).
 * Use for backfill — NOT current `readOmnipairPoolState` (that is post-latest only).
 */
export function extractPostTxOmnipairVaultReserves(
  tx: ParsedTransactionWithMeta,
  layout: Pick<
    DerivedOmnipairLayout,
    "reserve0Vault" | "reserve1Vault" | "token0Mint" | "token1Mint"
  >,
): { reserve0: bigint; reserve1: bigint } | null {
  const keys = resolveParsedTxAccountKeys(tx);
  if (keys.length === 0) return null;

  const idx0 = keys.findIndex((k) => k.equals(layout.reserve0Vault));
  const idx1 = keys.findIndex((k) => k.equals(layout.reserve1Vault));
  if (idx0 < 0 || idx1 < 0) return null;

  const post = tx.meta?.postTokenBalances ?? [];
  const t0 = layout.token0Mint.toBase58();
  const t1 = layout.token1Mint.toBase58();

  const bal0 = post.find(
    (b) => b.accountIndex === idx0 && b.mint === t0,
  );
  const bal1 = post.find(
    (b) => b.accountIndex === idx1 && b.mint === t1,
  );
  const a0 = bal0?.uiTokenAmount?.amount;
  const a1 = bal1?.uiTokenAmount?.amount;
  if (a0 == null || a1 == null || a0 === "" || a1 === "") return null;

  try {
    return { reserve0: BigInt(a0), reserve1: BigInt(a1) };
  } catch {
    return null;
  }
}

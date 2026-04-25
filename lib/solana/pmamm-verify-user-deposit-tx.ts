import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";

function firstSignerPubkey(
  tx: NonNullable<Awaited<ReturnType<Connection["getTransaction"]>>>,
): PublicKey {
  const msg = tx.transaction.message;
  const keys =
    "staticAccountKeys" in msg && Array.isArray(msg.staticAccountKeys)
      ? msg.staticAccountKeys
      : // legacy parsed path
        (
          msg as unknown as {
            accountKeys: Array<PublicKey | { pubkey: PublicKey }>;
          }
        ).accountKeys;
  if (!keys?.length) {
    throw new Error("Could not read transaction accounts.");
  }
  const k0 = keys[0]!;
  return k0 instanceof PublicKey ? k0 : k0.pubkey;
}

function allAccountKeys(
  tx: NonNullable<Awaited<ReturnType<Connection["getTransaction"]>>>,
): PublicKey[] {
  const msg = tx.transaction.message;
  if ("staticAccountKeys" in msg && Array.isArray(msg.staticAccountKeys)) {
    return [...msg.staticAccountKeys];
  }
  const raw = (
    msg as unknown as {
      accountKeys: Array<PublicKey | { pubkey: PublicKey }>;
    }
  ).accountKeys;
  return (raw ?? []).map((k) => (k instanceof PublicKey ? k : k.pubkey));
}

/**
 * Confirms the deposit tx succeeded, was paid by the creator, and touches the market + pmAMM program.
 */
export async function assertPmammDepositTxFromCreator(params: {
  connection: Connection;
  signature: string;
  marketPda: PublicKey;
  creator: PublicKey;
  pmammProgramId: PublicKey;
}): Promise<void> {
  const tx = await params.connection.getTransaction(params.signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!tx?.meta || tx.meta.err) {
    throw new Error("Deposit transaction failed or was not found.");
  }
  const feePayer = firstSignerPubkey(tx);
  if (!feePayer.equals(params.creator)) {
    throw new Error(
      "Deposit transaction fee payer must be the connected creator wallet.",
    );
  }
  const keys = allAccountKeys(tx);
  if (!keys.some((k) => k.equals(params.marketPda))) {
    throw new Error("Deposit transaction does not include this market account.");
  }
  if (!keys.some((k) => k.equals(params.pmammProgramId))) {
    throw new Error("Deposit transaction does not invoke the pmAMM program.");
  }
}

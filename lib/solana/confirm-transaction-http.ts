import type {
  BlockheightBasedTransactionConfirmationStrategy,
  Commitment,
  Connection,
  RpcResponseAndContext,
  SignatureStatus,
  TransactionError,
} from "@solana/web3.js";
import {
  TransactionExpiredBlockheightExceededError,
  TransactionExpiredTimeoutError,
} from "@solana/web3.js";

type SignatureResult = { err: TransactionError | null };

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Mirrors `@solana/web3.js` `getTransactionConfirmationPromise` commitment checks. */
function signatureStatusSatisfiesCommitment(
  value: Pick<SignatureStatus, "err" | "confirmationStatus">,
  commitment: Commitment,
): boolean {
  if (value.err) return false;
  const s = value.confirmationStatus;
  switch (commitment) {
    case "confirmed":
    case "single":
    case "singleGossip":
      return s !== "processed";
    case "finalized":
    case "max":
    case "root":
      return s === "finalized";
    case "processed":
    case "recent":
    default:
      return true;
  }
}

type PollStrategy = {
  signature: string;
  lastValidBlockHeight?: number;
  abortSignal?: AbortSignal;
};

/**
 * Confirms a transaction using only HTTP RPC (`getSignatureStatuses` / `getBlockHeight`).
 * Use this in Next.js / Node when WebSocket `signatureSubscribe` fails (e.g. broken `bufferutil`
 * with `ws`, producing `bufferUtil.mask is not a function`).
 */
export async function confirmTransactionWithHttpPolling(
  connection: Connection,
  strategy: PollStrategy,
  commitment: Commitment,
): Promise<RpcResponseAndContext<SignatureResult>> {
  const { signature, lastValidBlockHeight, abortSignal } = strategy;
  const hasExpiry = lastValidBlockHeight !== undefined;
  const start = Date.now();
  /** No blockhash expiry: match legacy timeout (~30s for confirmed). */
  const maxWaitMs = hasExpiry ? 120_000 : 30_000;

  while (Date.now() - start < maxWaitMs) {
    if (abortSignal?.aborted) {
      throw abortSignal.reason;
    }

    if (hasExpiry) {
      const bh = await connection.getBlockHeight(commitment).catch(() => -1);
      if (bh > lastValidBlockHeight!) {
        const late = await connection.getSignatureStatuses([signature], {
          searchTransactionHistory: true,
        });
        const v = late.value[0];
        if (
          v &&
          signatureStatusSatisfiesCommitment(v, commitment) &&
          !v.err
        ) {
          return { context: late.context, value: { err: v.err } };
        }
        throw new TransactionExpiredBlockheightExceededError(signature);
      }
    }

    const res = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const v = res.value[0];
    if (v) {
      if (v.err) {
        throw v.err;
      }
      if (signatureStatusSatisfiesCommitment(v, commitment)) {
        return { context: res.context, value: { err: v.err } };
      }
    }

    await sleep(400);
  }

  throw new TransactionExpiredTimeoutError(signature, maxWaitMs / 1000);
}

/**
 * Replaces `connection.confirmTransaction` for strategies we handle so SPL Token / pipeline code
 * never opens an RPC WebSocket subscription in the server bundle.
 */
export function applyHttpPollingConfirmTransaction(connection: Connection): void {
  const fallback = connection.confirmTransaction.bind(connection);

  connection.confirmTransaction = (async (strategy, commitment?) => {
    const c = (commitment ?? connection.commitment ?? "confirmed") as Commitment;

    if (typeof strategy === "string") {
      return confirmTransactionWithHttpPolling(
        connection,
        { signature: strategy },
        c,
      );
    }

    if (
      strategy &&
      typeof strategy === "object" &&
      "lastValidBlockHeight" in strategy &&
      "signature" in strategy
    ) {
      const s = strategy as BlockheightBasedTransactionConfirmationStrategy;
      return confirmTransactionWithHttpPolling(
        connection,
        {
          signature: s.signature,
          lastValidBlockHeight: s.lastValidBlockHeight,
          abortSignal: s.abortSignal,
        },
        c,
      );
    }

    return fallback(strategy, commitment);
  }) as Connection["confirmTransaction"];
}

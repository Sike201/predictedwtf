import {
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

import { isPipelineStageError } from "@/lib/market/pipeline-errors";
import {
  isNativeSolInsufficientMessage,
  isSplTokenInsufficientFundsMessage,
} from "@/lib/market/tx-user-message";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import {
  MPL_TOKEN_METADATA_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@/lib/solana/omnipair-constants";

function wellKnownLabel(pk: PublicKey): string | null {
  try {
    if (pk.equals(SystemProgram.programId)) return "System program";
    if (pk.equals(TOKEN_PROGRAM_ID)) return "SPL Token program";
    if (pk.equals(ASSOCIATED_TOKEN_PROGRAM_ID))
      return "Associated Token program";
    if (pk.equals(TOKEN_2022_PROGRAM_ID)) return "Token-2022 program";
    if (pk.equals(MPL_TOKEN_METADATA_PROGRAM_ID))
      return "Metaplex Token Metadata program";
    if (pk.equals(SYSVAR_RENT_PUBKEY)) return "Sysvar Rent";
  } catch {
    /* ignore */
  }
  return null;
}

/** Compare to env. */
function omnipairLabel(pk: PublicKey): string | null {
  const env = process.env.NEXT_PUBLIC_OMNIPAIR_PROGRAM_ID?.trim();
  if (env) {
    try {
      if (pk.equals(new PublicKey(env)))
        return "Omnipair program (NEXT_PUBLIC_OMNIPAIR_PROGRAM_ID)";
    } catch {
      return "Omnipair program id (INVALID NEXT_PUBLIC_OMNIPAIR_PROGRAM_ID — not a valid pubkey)";
    }
  }
  return null;
}

/** Full label for logs / UI. */
export function labelProgramId(pk: PublicKey): string {
  return (
    wellKnownLabel(pk) ??
    omnipairLabel(pk) ??
    `custom / unknown program (${pk.toBase58()})`
  );
}

function noteInstructionProgramEnvContext(ixProgramId: PublicKey): void {
  if (wellKnownLabel(ixProgramId)) return;
  const env = process.env.NEXT_PUBLIC_OMNIPAIR_PROGRAM_ID?.trim();
  if (!env) {
    console.warn(
      `[predicted][tx-programs] ix program ${ixProgramId.toBase58()} — NEXT_PUBLIC_OMNIPAIR_PROGRAM_ID is unset; deploy Omnipair and set it or txs will fail.`,
    );
    return;
  }
  try {
    const expected = new PublicKey(env);
    if (!ixProgramId.equals(expected)) {
      console.warn(
        `[predicted][tx-programs] ix program ${ixProgramId.toBase58()} does not match NEXT_PUBLIC_OMNIPAIR_PROGRAM_ID=${expected.toBase58()}`,
      );
    }
  } catch {
    console.warn(
      "[predicted][tx-programs] NEXT_PUBLIC_OMNIPAIR_PROGRAM_ID is not valid base58.",
    );
  }
}

/** Legacy transaction: each instruction’s program id and account metas. */
export function logTransactionInstructions(
  tx: Transaction,
  tag: string,
): void {
  console.info(`[predicted][tx-programs] ${tag} legacy tx instructions=${tx.instructions.length}`);
  tx.instructions.forEach((ix, i) => {
    const pid = ix.programId;
    noteInstructionProgramEnvContext(pid);
    console.info(
      `[predicted][tx-programs] [${tag}] ix[${i}] programId=${pid.toBase58()} (${labelProgramId(pid)}) keys=${ix.keys.length}`,
    );
    ix.keys.forEach((k, j) => {
      console.info(
        `[predicted][tx-programs] [${tag}] ix[${i}] key[${j}] ${k.pubkey.toBase58()} signer=${k.isSigner} writable=${k.isWritable}`,
      );
    });
  });
}

function logVersionedPrograms(vtx: VersionedTransaction, tag: string): void {
  const msg = vtx.message;
  const staticKeys = msg.staticAccountKeys;
  const ci = msg.compiledInstructions;
  console.info(
    `[predicted][tx-programs] ${tag} v0 compiledInstructions=${ci.length}`,
  );
  ci.forEach((ix, i) => {
    const prog =
      staticKeys[ix.programIdIndex] ??
      new PublicKey("11111111111111111111111111111111");
    noteInstructionProgramEnvContext(prog);
    const label = labelProgramId(prog);
    console.info(
      `[predicted][tx-programs] [${tag}] ix[${i}] programId=${prog.toBase58()} (${label}) accountKeyIndexes=${ix.accountKeyIndexes.length} dataLen=${ix.data.length}`,
    );
    ix.accountKeyIndexes.forEach((idx, j) => {
      const pk = staticKeys[idx];
      if (!pk) {
        console.info(
          `[predicted][tx-programs] [${tag}] ix[${i}] key[${j}] <lookup/ALT index ${idx}>`,
        );
        return;
      }
      console.info(
        `[predicted][tx-programs] [${tag}] ix[${i}] key[${j}] ${pk.toBase58()}`,
      );
    });
  });
}

/**
 * Best-effort decode + log program ids for any serialized tx (legacy or v0).
 * Used by `Connection.sendRawTransaction` instrumentation.
 */
export function tryLogSerializedTransaction(
  raw: Buffer | Uint8Array | number[],
  tag: string,
): void {
  const buf = Buffer.isBuffer(raw)
    ? raw
    : Buffer.from(raw instanceof Uint8Array ? raw : Uint8Array.from(raw));
  try {
    const legacy = Transaction.from(buf);
    logTransactionInstructions(legacy, `${tag} (deserialize=legacy)`);
    return;
  } catch {
    /* try v0 */
  }
  try {
    const vtx = VersionedTransaction.deserialize(buf);
    logVersionedPrograms(vtx, `${tag} (deserialize=v0)`);
  } catch (e) {
    console.warn(
      "[predicted][tx-programs]",
      tag,
      "could not deserialize tx for program trace:",
      e,
    );
  }
}

const SYSTEM_NATIVE = "11111111111111111111111111111111";
const VOTE_PROGRAM = "Vote111111111111111111111111111111111111111";

export function collectSolanaErrorDiagnostics(error: unknown): string {
  const parts: string[] = [];
  let cur: unknown = error;
  for (let d = 0; d < 10 && cur; d += 1) {
    if (cur instanceof Error) {
      parts.push(cur.message);
      const se = cur as Error & { logs?: string[]; transactionLogs?: string[] };
      if (Array.isArray(se.logs)) parts.push(...se.logs);
      if (Array.isArray(se.transactionLogs)) parts.push(...se.transactionLogs);
      cur = cur.cause;
    } else {
      parts.push(String(cur));
      break;
    }
  }
  return parts.join("\n");
}

/** Prefer program ids that are unlikely to be system/token when reporting “missing program”. */
export function extractMissingProgramIdFromSolanaError(
  error: unknown,
): string | undefined {
  if (isPipelineStageError(error) && error.missingProgramId) {
    return error.missingProgramId;
  }
  const blob = collectSolanaErrorDiagnostics(error);

  if (isSplTokenInsufficientFundsMessage(blob)) return undefined;
  if (isNativeSolInsufficientMessage(blob)) return undefined;

  const skipInvokeProgram = new Set<string>([
    SYSTEM_NATIVE,
    VOTE_PROGRAM,
    TOKEN_PROGRAM_ID.toBase58(),
    ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
    TOKEN_2022_PROGRAM_ID.toBase58(),
    MPL_TOKEN_METADATA_PROGRAM_ID.toBase58(),
  ]);

  const invokePrograms: string[] = [];
  const reInvoke =
    /Program ([1-9A-HJ-NP-Za-km-z]{32,44}) invoke/gi;
  let m: RegExpExecArray | null;
  while ((m = reInvoke.exec(blob)) !== null) {
    invokePrograms.push(m[1]!);
  }
  if (invokePrograms.length > 0) {
    for (let i = invokePrograms.length - 1; i >= 0; i -= 1) {
      const p = invokePrograms[i]!;
      if (!skipInvokeProgram.has(p)) return p;
    }
  }

  if (/does not exist|unknown program|program.*not found/i.test(blob)) {
    const seen = new Set<string>();
    let match: RegExpExecArray | null;
    const re = /\b([1-9A-HJ-NP-Za-km-z]{32,44})\b/g;
    while ((match = re.exec(blob)) !== null) {
      const id = match[1]!;
      if (seen.has(id)) continue;
      seen.add(id);
      try {
        new PublicKey(id);
      } catch {
        continue;
      }
      if (id === SYSTEM_NATIVE) continue;
      if (id === TOKEN_PROGRAM_ID.toBase58()) continue;
      if (id === ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()) continue;
      if (id === MPL_TOKEN_METADATA_PROGRAM_ID.toBase58()) continue;
      if (id === TOKEN_2022_PROGRAM_ID.toBase58()) continue;
      return id;
    }
  }

  return undefined;
}

export function formatMissingDeployedProgramMessage(programId: string): string {
  return `Missing deployed program: ${programId}`;
}

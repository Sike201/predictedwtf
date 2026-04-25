import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  TokenAccountNotFoundError,
  TokenInvalidAccountOwnerError,
} from "@solana/spl-token";
import type { Commitment } from "@solana/web3.js";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  type Signer,
} from "@solana/web3.js";

import { formatUnknownError, PipelineStageError } from "@/lib/market/pipeline-errors";
import { resolveSplTokenProgramForMint } from "@/lib/solana/omnipair-leverage-common";
import { sendAndConfirmTransactionWithSigners } from "@/lib/solana/send-transaction";

export const OUTCOME_MINT_DECIMALS = 9;

/** ~0.0005 SOL — two idempotent ATA creates need rent + fees on devnet. */
const MIN_PAYER_LAMPORTS_FOR_ATA_STEP = 500_000n;

/** Post-create ATA visibility checks — best-effort; pipeline continues if create tx confirmed. */
const ATA_READ_RETRIES = 15;
/** Backoff between read attempts (ms): 300, 600, 1000, … */
const ATA_READ_BACKOFF_MS: number[] = [
  300, 600, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000,
  6500,
];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function readCommitmentForAttempt(attempt: number): Commitment {
  return attempt >= 10 ? "finalized" : "confirmed";
}

function backoffBeforeNextAttempt(attempt: number): Promise<void> {
  const ms =
    ATA_READ_BACKOFF_MS[Math.min(attempt - 1, ATA_READ_BACKOFF_MS.length - 1)] ??
    3000;
  return sleep(ms);
}

function serializeErrorDetails(
  e: unknown,
): { name: string; message: string; stackFirstLine: string; raw: string } {
  if (e instanceof Error) {
    const lines = e.stack?.split("\n") ?? [];
    const stackFirstLine =
      lines.length > 1
        ? lines[1]!.trim()
        : (lines[0]?.trim() ?? "");
    return {
      name: e.name,
      message: e.message,
      stackFirstLine,
      raw: e.stack?.slice(0, 400) ?? e.message,
    };
  }
  return {
    name: "NonError",
    message: String(e),
    stackFirstLine: "",
    raw: String(e),
  };
}

type OutcomeAtaLeg = {
  role: "yes" | "no";
  mint: PublicKey;
  program: PublicKey;
  ata: PublicKey;
};

type SplTokenAccount = Awaited<ReturnType<typeof getAccount>>;

/**
 * After an ATA-creation tx, RPC may lag before reads are consistent — retry with backoff.
 * If the create tx already succeeded on-chain, a persistent null read returns null (caller uses derived ATA).
 */
async function readOutcomeAtaAfterCreate(
  connection: Connection,
  leg: OutcomeAtaLeg,
  mintAuthority: PublicKey,
  context: {
    baseCtx: Record<string, string>;
    ataCreateTxSignature: string;
    ixAtaPda: string;
    createTxVerifiedOk: boolean;
  },
): Promise<SplTokenAccount | null> {
  const { ataCreateTxSignature, ixAtaPda, baseCtx, createTxVerifiedOk } =
    context;
  const readPda = leg.ata.toBase58();
  if (ixAtaPda !== readPda) {
    console.error(
      "[predicted][outcome-mints] ATA PDA mismatch (ix vs read)",
      ixAtaPda,
      readPda,
    );
  }
  let lastErr: unknown;
  let sawNonVisibilityFailure = false;

  for (let attempt = 1; attempt <= ATA_READ_RETRIES; attempt++) {
    const commitment = readCommitmentForAttempt(attempt);
    try {
      let info = await connection.getAccountInfo(leg.ata, commitment);
      if (info === null) {
        const parsedCtx = await connection.getParsedAccountInfo(
          leg.ata,
          commitment,
        );
        if (
          parsedCtx.value !== null &&
          parsedCtx.value.owner.equals(leg.program)
        ) {
          info = await connection.getAccountInfo(leg.ata, commitment);
        }
      }

      if (info === null) {
        lastErr = new Error(
          "getAccountInfo/getParsedAccountInfo: account not yet visible on RPC",
        );
        if (attempt < ATA_READ_RETRIES) await backoffBeforeNextAttempt(attempt);
        continue;
      }
      if (!info.owner.equals(leg.program)) {
        sawNonVisibilityFailure = true;
        lastErr = new Error(
          `getAccountInfo owner ${info.owner.toBase58()} !== leg.program ${leg.program.toBase58()}`,
        );
        if (attempt < ATA_READ_RETRIES) await backoffBeforeNextAttempt(attempt);
        continue;
      }
      let acc: SplTokenAccount;
      try {
        acc = await getAccount(
          connection,
          leg.ata,
          commitment,
          leg.program,
        );
      } catch (parseErr) {
        lastErr = parseErr;
        sawNonVisibilityFailure = true;
        const d = serializeErrorDetails(parseErr);
        console.warn(
          "[predicted][outcome-mints] getAccount parse failed but accountInfo exists, retrying",
          {
            leg: leg.role,
            attempt,
            commitment,
            dataLen: String(info.data.length),
            ...d,
          },
        );
        if (attempt < ATA_READ_RETRIES) await backoffBeforeNextAttempt(attempt);
        continue;
      }
      if (!acc.mint.equals(leg.mint) || !acc.owner.equals(mintAuthority)) {
        sawNonVisibilityFailure = true;
        lastErr = new Error("parsed ATA mint/owner mismatch");
        if (attempt < ATA_READ_RETRIES) await backoffBeforeNextAttempt(attempt);
        continue;
      }
      console.info(
        "[predicted][outcome-mints] post-create ATA read ok",
        JSON.stringify({
          leg: leg.role,
          ata: readPda,
          ixAtaPda,
          readMatchesIx: readPda === ixAtaPda,
          ataReadAttemptCount: attempt,
          ataCreateTxSignature,
          commitment,
        }),
      );
      return acc;
    } catch (e) {
      lastErr = e;
      sawNonVisibilityFailure = true;
      if (attempt < ATA_READ_RETRIES) await backoffBeforeNextAttempt(attempt);
    }
  }

  if (
    createTxVerifiedOk &&
    !sawNonVisibilityFailure &&
    lastErr instanceof Error &&
    lastErr.message.includes("not yet visible on RPC")
  ) {
    console.info(
      "[predicted][outcome-ata] create tx confirmed; RPC read delayed, continuing with derived ATA",
      JSON.stringify({
        leg: leg.role,
        ata: readPda,
        ixAtaPda,
        ataReadAttempts: String(ATA_READ_RETRIES),
        ataCreateTxSignature,
      }),
    );
    return null;
  }

  const d = serializeErrorDetails(lastErr);
  outcomeAtaFailure(
    `After create, could not read ${leg.role} ATA after ${ATA_READ_RETRIES} attempts. Last: ${d.message}`,
    lastErr,
    {
      ...baseCtx,
      failingLeg: leg.role,
      ataReadAttempts: String(ATA_READ_RETRIES),
      ixAtaPda,
      readAtaPda: readPda,
      ataAtaPdaMatch: String(ixAtaPda === readPda),
      ataCreateTxSignature,
      lastErrorName: d.name,
      lastErrorMessage: d.message,
      lastErrorStackLine: d.stackFirstLine,
      rawError: d.raw,
    },
  );
}

export type OutcomeMintSignatures = {
  yesMintTx: string | null;
  noMintTx: string | null;
};

export type CreateOutcomeMintsResult = {
  yesMint: PublicKey;
  noMint: PublicKey;
  /** Engine authority ATAs (used before depositing into the pool). */
  authorityYesAta: PublicKey;
  authorityNoAta: PublicKey;
  signatures: OutcomeMintSignatures;
};

/** Latest tx signature touching `address` (e.g. mint account after `createMint`). */
export async function getLatestSignatureForAddress(
  connection: Connection,
  address: PublicKey,
): Promise<string | null> {
  const sigs = await connection.getSignaturesForAddress(address, { limit: 1 });
  return sigs[0]?.signature ?? null;
}

/** Single SPL outcome mint (wrapped outcome token). */
export async function mintOutcomeToken(params: {
  connection: Connection;
  payer: Signer;
  mintAuthority: PublicKey;
}): Promise<PublicKey> {
  const { connection, payer, mintAuthority } = params;
  console.info(
    "[predicted][outcome-mints] createMint — SPL Token",
    TOKEN_PROGRAM_ID.toBase58(),
    "(transaction logged via Connection.sendRawTransaction)",
  );
  return createMint(
    connection,
    payer,
    mintAuthority,
    null,
    OUTCOME_MINT_DECIMALS,
  );
}

/** ATAs for engine authority for existing YES/NO mints. */
/** Mint outcome tokens to engine ATAs for Omnipair `initialize` bootstrap. */
export async function mintBootstrapOutcomeTokens(params: {
  connection: Connection;
  payer: Keypair;
  yesMint: PublicKey;
  noMint: PublicKey;
  authorityYesAta: PublicKey;
  authorityNoAta: PublicKey;
  amountPerMint: bigint;
}): Promise<{ signature: string }> {
  const {
    connection,
    payer,
    yesMint,
    noMint,
    authorityYesAta,
    authorityNoAta,
    amountPerMint,
  } = params;
  console.info(
    "[predicted][outcome-mints] mintTo bootstrap — program",
    TOKEN_PROGRAM_ID.toBase58(),
    "(SPL Token); full ix layout is logged by Connection.sendRawTransaction",
  );
  const ixY = createMintToInstruction(
    yesMint,
    authorityYesAta,
    payer.publicKey,
    amountPerMint,
  );
  const ixN = createMintToInstruction(
    noMint,
    authorityNoAta,
    payer.publicKey,
    amountPerMint,
  );
  const tx = new Transaction().add(ixY, ixN);
  const signature = await sendAndConfirmTransactionWithSigners(
    connection,
    tx,
    [payer],
  );
  return { signature };
}

function outcomeAtaFailure(
  message: string,
  cause: unknown,
  ctx: Record<string, string>,
): never {
  const rawError =
    Object.prototype.hasOwnProperty.call(ctx, "rawError") && ctx.rawError !== ""
      ? ctx.rawError
      : formatUnknownError(cause);
  throw new PipelineStageError("FAILED_AT_OUTCOME_ATA", message, {
    cause,
    outcomeAtaContext: {
      ...ctx,
      rawError,
    },
  });
}

/**
 * Ensures the idempotent ATA tx is present and did not error on-chain.
 * `sendAndConfirmTransactionWithSigners` already confirmed the signature; this checks status + `meta.err`.
 */
async function assertAtaCreateTransactionSucceeded(
  connection: Connection,
  ataCreateSig: string,
  baseCtx: Record<string, string>,
): Promise<void> {
  const [st] = (
    await connection.getSignatureStatuses([ataCreateSig], {
      searchTransactionHistory: true,
    })
  ).value;

  if (st?.err != null) {
    outcomeAtaFailure(
      `ATA create transaction failed (signature status err): ${JSON.stringify(st.err)}`,
      new Error("ata_create_tx_signature_err"),
      {
        ...baseCtx,
        ataCreateTxSignature: ataCreateSig,
        signatureErr: JSON.stringify(st.err),
      },
    );
  }

  let txMeta = await connection.getTransaction(ataCreateSig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (txMeta == null) {
    await sleep(400);
    txMeta = await connection.getTransaction(ataCreateSig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
  }
  if (txMeta == null) {
    await sleep(600);
    txMeta = await connection.getTransaction(ataCreateSig, {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    });
  }
  if (txMeta == null) {
    outcomeAtaFailure(
      "ATA create transaction confirmed but getTransaction returned null (cannot verify on-chain success).",
      new Error("ata_create_tx_meta_missing"),
      { ...baseCtx, ataCreateTxSignature: ataCreateSig },
    );
  }
  if (txMeta.meta?.err != null) {
    outcomeAtaFailure(
      `ATA create transaction failed on-chain: ${JSON.stringify(txMeta.meta.err)}`,
      new Error("ata_create_tx_execution_err"),
      {
        ...baseCtx,
        ataCreateTxSignature: ataCreateSig,
        metaErr: JSON.stringify(txMeta.meta.err),
      },
    );
  }

  console.info(
    "[predicted][outcome-mints] ATA idempotent create tx settled",
    JSON.stringify({
      ataCreateTxSignature: ataCreateSig,
      confirmationStatus: st?.confirmationStatus ?? "unknown",
      slot: txMeta.slot != null ? String(txMeta.slot) : "unknown",
      err: null,
    }),
  );
}

/**
 * Load or idempotently create engine-owned ATAs for YES/NO outcome mints.
 * Resolves SPL Token vs Token-2022 per mint from chain, derives ATAs with matching program,
 * and uses idempotent create so an existing ATA never fails the flow.
 */
export async function getAuthorityAtasForOutcomeMints(params: {
  connection: Connection;
  /** Market engine keypair — must sign ATA creation. */
  payer: Keypair;
  mintAuthority: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
}): Promise<{ authorityYesAta: PublicKey; authorityNoAta: PublicKey }> {
  const { connection, payer, mintAuthority, yesMint, noMint } = params;

  let yesProg: PublicKey;
  let noProg: PublicKey;
  try {
    yesProg = await resolveSplTokenProgramForMint(connection, yesMint);
    noProg = await resolveSplTokenProgramForMint(connection, noMint);
  } catch (e) {
    outcomeAtaFailure(
      "Could not read outcome mint program owner (SPL vs Token-2022).",
      e,
      {
        yesMint: yesMint.toBase58(),
        noMint: noMint.toBase58(),
        mintAuthority: mintAuthority.toBase58(),
        payer: payer.publicKey.toBase58(),
      },
    );
  }

  const authorityYesAta = getAssociatedTokenAddressSync(
    yesMint,
    mintAuthority,
    false,
    yesProg,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const authorityNoAta = getAssociatedTokenAddressSync(
    noMint,
    mintAuthority,
    false,
    noProg,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const baseCtx: Record<string, string> = {
    yesMint: yesMint.toBase58(),
    noMint: noMint.toBase58(),
    yesTokenProgram: yesProg.toBase58(),
    noTokenProgram: noProg.toBase58(),
    mintAuthority: mintAuthority.toBase58(),
    mintAuthorityIsPayer: String(mintAuthority.equals(payer.publicKey)),
    payer: payer.publicKey.toBase58(),
    classicSPLProgram: TOKEN_PROGRAM_ID.toBase58(),
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
    authorityYesAta: authorityYesAta.toBase58(),
    authorityNoAta: authorityNoAta.toBase58(),
  };

  console.info(
    "[predicted][outcome-mints] OUTCOME_ATA derived addresses",
    JSON.stringify(baseCtx),
  );

  const lamports = BigInt(
    await connection.getBalance(payer.publicKey, "confirmed"),
  );
  if (lamports < MIN_PAYER_LAMPORTS_FOR_ATA_STEP) {
    outcomeAtaFailure(
      `Engine payer SOL too low to create ATAs (have ${lamports} lamports, need at least ${MIN_PAYER_LAMPORTS_FOR_ATA_STEP}). Fund the market engine wallet on devnet.`,
      new Error("insufficient_lamports"),
      { ...baseCtx, payerLamports: lamports.toString() },
    );
  }

  const legs: OutcomeAtaLeg[] = [
    { role: "yes", mint: yesMint, program: yesProg, ata: authorityYesAta },
    { role: "no", mint: noMint, program: noProg, ata: authorityNoAta },
  ];

  const needCreate: { leg: OutcomeAtaLeg; reason: string }[] = [];

  for (const leg of legs) {
    const { role, mint, program, ata } = leg;
    try {
      const acc = await getAccount(
        connection,
        ata,
        "confirmed",
        program,
      );
      if (!acc.mint.equals(mint)) {
        outcomeAtaFailure(
          `ATA ${ata.toBase58()} (${role}) is already in use for a different mint. Expected ${mint.toBase58()}.`,
          new Error("ata_mint_collision"),
          { ...baseCtx, failingLeg: role },
        );
      }
      if (!acc.owner.equals(mintAuthority)) {
        outcomeAtaFailure(
          `ATA ${ata.toBase58()} (${role}) has wrong owner (expected engine ${mintAuthority.toBase58()}).`,
          new Error("ata_owner_mismatch"),
          { ...baseCtx, failingLeg: role },
        );
      }
      console.info("[predicted][outcome-mints] ATA already valid", {
        role,
        ata: ata.toBase58(),
      });
    } catch (e) {
      if (e instanceof PipelineStageError) throw e;
      if (e instanceof TokenAccountNotFoundError) {
        needCreate.push({ leg, reason: "token_account_not_found" });
        console.info("[predicted][outcome-mints] ATA missing, will create", {
          role,
          ata: ata.toBase58(),
        });
        continue;
      }
      if (e instanceof TokenInvalidAccountOwnerError) {
        needCreate.push({ leg, reason: "invalid_account_owner" });
        console.info(
          "[predicted][outcome-mints] unallocated or wrong program at ATA; idempotent create",
          { role, ata: ata.toBase58() },
        );
        continue;
      }
      outcomeAtaFailure(
        `Failed to read ${role} engine ATA: ${formatUnknownError(e)}`,
        e,
        { ...baseCtx, failingLeg: role },
      );
    }
  }

  if (needCreate.length > 0) {
    const tx = new Transaction();
    for (const { leg } of needCreate) {
      tx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          payer.publicKey,
          leg.ata,
          mintAuthority,
          leg.mint,
          leg.program,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
      );
    }
    let ataCreateSig: string;
    try {
      console.info(
        "[predicted][outcome-mints] sending idempotent ATA tx",
        needCreate.map((n) => n.leg.role).join("+"),
        "count=",
        needCreate.length,
      );
      ataCreateSig = await sendAndConfirmTransactionWithSigners(
        connection,
        tx,
        [payer],
        "confirmed",
      );
    } catch (e) {
      outcomeAtaFailure(
        `Idempotent ATA transaction failed: ${formatUnknownError(e)}`,
        e,
        {
          ...baseCtx,
          createLegs: needCreate.map((n) => n.leg.role).join(","),
        },
      );
    }

    await assertAtaCreateTransactionSucceeded(
      connection,
      ataCreateSig,
      baseCtx,
    );

    for (const { leg } of needCreate) {
      const ixAtaPda = leg.ata.toBase58();
      console.info(
        "[predicted][outcome-mints] post-create read — create ix ATA vs read",
        JSON.stringify({
          ixAtaPda,
          readPathAtaPda: leg.ata.toBase58(),
          match: String(ixAtaPda === leg.ata.toBase58()),
        }),
      );
      await readOutcomeAtaAfterCreate(connection, leg, mintAuthority, {
        baseCtx,
        ataCreateTxSignature: ataCreateSig,
        ixAtaPda,
        createTxVerifiedOk: true,
      });
    }
  }

  return {
    authorityYesAta,
    authorityNoAta,
  };
}

/**
 * Creates YES / NO SPL mints (9 decimals) and ATAs owned by the market engine authority.
 * Payer + mint authority = engine wallet.
 */
export async function createOutcomeMints(params: {
  connection: Connection;
  payer: Keypair;
  mintAuthority: PublicKey;
}): Promise<CreateOutcomeMintsResult> {
  const { connection, payer, mintAuthority } = params;
  const yesMint = await mintOutcomeToken({ connection, payer, mintAuthority });
  const noMint = await mintOutcomeToken({ connection, payer, mintAuthority });
  const { authorityYesAta, authorityNoAta } =
    await getAuthorityAtasForOutcomeMints({
      connection,
      payer,
      mintAuthority,
      yesMint,
      noMint,
    });
  const yesMintTx = await getLatestSignatureForAddress(connection, yesMint);
  const noMintTx = await getLatestSignatureForAddress(connection, noMint);
  return {
    yesMint,
    noMint,
    authorityYesAta,
    authorityNoAta,
    signatures: { yesMintTx, noMintTx },
  };
}

/** Emergency dev-only mock — only when `MOCK_CHAIN=1`. */
export function createMockOutcomeMints(): Omit<
  CreateOutcomeMintsResult,
  "signatures"
> & {
  signatures: OutcomeMintSignatures;
} {
  return {
    yesMint: Keypair.generate().publicKey,
    noMint: Keypair.generate().publicKey,
    authorityYesAta: Keypair.generate().publicKey,
    authorityNoAta: Keypair.generate().publicKey,
    signatures: { yesMintTx: null, noMintTx: null },
  };
}

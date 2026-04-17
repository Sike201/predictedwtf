import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMintToInstruction,
  createMint,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  type Signer,
} from "@solana/web3.js";

import { sendAndConfirmTransactionWithSigners } from "@/lib/solana/send-transaction";

export const OUTCOME_MINT_DECIMALS = 9;

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

export async function getAuthorityAtasForOutcomeMints(params: {
  connection: Connection;
  payer: Signer;
  mintAuthority: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
}): Promise<{ authorityYesAta: PublicKey; authorityNoAta: PublicKey }> {
  const { connection, payer, mintAuthority, yesMint, noMint } = params;
  console.info(
    "[predicted][outcome-mints] getOrCreateAssociatedTokenAccount — SPL Token",
    TOKEN_PROGRAM_ID.toBase58(),
    "Associated Token",
    ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
  );
  const yesAta = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    yesMint,
    mintAuthority,
  );
  const noAta = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    noMint,
    mintAuthority,
  );
  return {
    authorityYesAta: yesAta.address,
    authorityNoAta: noAta.address,
  };
}

/**
 * Creates YES / NO SPL mints (9 decimals) and ATAs owned by the market engine authority.
 * Payer + mint authority = engine wallet.
 */
export async function createOutcomeMints(params: {
  connection: Connection;
  payer: Signer;
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

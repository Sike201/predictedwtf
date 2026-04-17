import {
  Keypair,
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type Connection,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddress,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import { anchorDiscriminator } from "@/lib/solana/anchor-util";
import {
  MPL_TOKEN_METADATA_PROGRAM_ID,
  OMNIPAIR_PROTOCOL_VERSION,
  PAIR_CREATION_FEE_LAMPORTS,
  TOKEN_2022_PROGRAM_ID,
} from "@/lib/solana/omnipair-constants";
import {
  buildInitializeAndBootstrapArgs,
  serializeInitializeAndBootstrapArgs,
} from "@/lib/solana/omnipair-initialize-args";
import {
  DEFAULT_OMNIPAIR_POOL_PARAMS,
  type OmnipairParamsHashInput,
} from "@/lib/solana/omnipair-params-hash";
import {
  deriveOmnipairLayout,
  getCollateralVaultPDA,
  getEventAuthorityPDA,
  getGlobalFutarchyAuthorityPDA,
  getLpTokenMetadataPDA,
  getPairPDA,
  getReserveVaultPDA,
  orderMints,
} from "@/lib/solana/omnipair-pda";
import {
  PipelineStageError,
  formatUnknownError,
} from "@/lib/market/pipeline-errors";
import { extractMissingProgramIdFromSolanaError } from "@/lib/solana/trace-transaction-programs";
import { requireOmnipairProgramId } from "@/lib/solana/omnipair-program";
import { buildOmnipairPreInitializeTransaction } from "@/lib/solana/omnipair-pre-init";
import { sendAndConfirmTransactionWithSigners } from "@/lib/solana/send-transaction";
import { logLegacyTransactionMetricsBeforeSend } from "@/lib/solana/tx-metrics";

const IX_NAME = "initialize";

export type InitOmnipairMarketParams = {
  connection: Connection;
  payer: Keypair;
  yesMint: PublicKey;
  noMint: PublicKey;
  /** Engine ATAs for YES and NO outcome mints (funded before this ix). */
  authorityYesAta: PublicKey;
  authorityNoAta: PublicKey;
  /** Token amounts to bootstrap (token0 and token1, same units as mint decimals). */
  bootstrapPerSide: bigint;
  /** Overrides default pool economics; must stay consistent with on-chain Futarchy deployment. */
  poolParams?: OmnipairParamsHashInput;
};

export type InitOmnipairMarketResult = {
  programId: PublicKey;
  pairAddress: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
  token0Mint: PublicKey;
  token1Mint: PublicKey;
  vaultA: PublicKey;
  vaultB: PublicKey;
  lpMint: PublicKey;
  rateModel: PublicKey;
  collateralYes: PublicKey;
  collateralNo: PublicKey;
  futarchyAuthority: PublicKey;
  /** Tx1: WSOL ATA (if needed) + LP mint account. */
  preInitializeSignature: string;
  /** Tx2: mint YES/NO bootstrap amounts to engine authority ATAs (required before Initialize pulls liquidity). */
  bootstrapLiquiditySignature: string;
  /**
   * Tx3: Omnipair `initialize` only.
   * @alias initSignature — same value; kept for callers using `initSignature`.
   */
  initializeSignature: string;
  initSignature: string;
};

/** WSOL mint — matches `spl-token` `NATIVE_MINT` / wrapped SOL. */
const WSOL_MINT = NATIVE_MINT;

/**
 * LP metadata for Omnipair `initialize` / `InitializeAndBootstrapArgs`
 * (`programs/omnipair/src/instructions/liquidity/initialize.rs`, `validate`).
 *
 * Accepted `lp_name` format on-chain (dev / default build):
 * - `lp_name.len() <= 32` (`ErrorCode::InvalidLpName`)
 * - `lp_name.is_ascii()` — every byte is ASCII (`InvalidLpName`)
 *
 * `lp_symbol`: `len() <= 10` and `is_ascii()` (`InvalidLpSymbol`).
 *
 * `lp_uri`: `len() <= 200`, `starts_with("http")` (`InvalidLpUri`).
 *
 * Separate rule on `feature = "production"`: LP *mint* pubkey’s last 4 base58 chars must be `"omLP"`
 * — applies to the mint address, not the metadata name string.
 *
 * Here we derive a deterministic ASCII name from canonical token0/token1 mint order (`orderMints`;
 * token0 is lexicographically smaller than token1),
 * so we never exceed 32 bytes or inject non-ASCII from user copy.
 */
export function buildOmnipairLpTokenMetadata(
  token0Mint: PublicKey,
  token1Mint: PublicKey,
): { lpName: string; lpSymbol: string; lpUri: string } {
  const t0 = token0Mint.toBase58();
  const t1 = token1Mint.toBase58();
  const lpName = `${t0.slice(0, 8)}/${t1.slice(0, 7)} omLP`;
  if (lpName.length > 32) {
    throw new Error(
      `Omnipair lp_name exceeds 32 chars (got ${lpName.length}) — omnipair-rs initialize validation.`,
    );
  }
  const lpSymbol = `o${t0.slice(0, 4)}${t1.slice(0, 4)}`.slice(0, 10);
  const lpUri = "https://predicted.wtf/omnipair/pool";
  if (lpUri.length > 200 || !lpUri.startsWith("http")) {
    throw new Error("Omnipair lp_uri must start with http and be <= 200 chars.");
  }
  return { lpName, lpSymbol, lpUri };
}

function loadTeamTreasuryWallet(): PublicKey {
  const raw = process.env.OMNIPAIR_TEAM_TREASURY?.trim();
  if (!raw) {
    throw new Error(
      "Set OMNIPAIR_TEAM_TREASURY (team treasury wallet; must match FutarchyAuthority.recipients.team_treasury on devnet).",
    );
  }
  return new PublicKey(raw);
}

/**
 * Ensure `team_treasury_wsol_account` exists before Omnipair `initialize`.
 * If missing, the market engine authority (`payer`) pays rent for the ATA creation ix.
 */
async function ensureTeamTreasuryWsolAta(
  connection: Connection,
  payer: Keypair,
  teamTreasury: PublicKey,
): Promise<{
  ata: PublicKey;
  alreadyExisted: boolean;
  createIx: TransactionInstruction | null;
}> {
  const ata = await getAssociatedTokenAddress(
    WSOL_MINT,
    teamTreasury,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const existing = await connection.getAccountInfo(ata);
  const alreadyExisted = existing !== null;

  console.info(
    "[predicted][omnipair-init] OMNIPAIR_TEAM_TREASURY (treasury wallet)",
    teamTreasury.toBase58(),
  );
  console.info(
    "[predicted][omnipair-init] team_treasury_wsol_account (WSOL ATA)",
    ata.toBase58(),
  );
  console.info(
    "[predicted][omnipair-init] WSOL mint",
    WSOL_MINT.toBase58(),
  );

  if (alreadyExisted) {
    console.info(
      "[predicted][omnipair-init] WSOL ATA: already initialized (no create ix)",
    );
    return { ata, alreadyExisted: true, createIx: null };
  }

  console.info(
    "[predicted][omnipair-init] WSOL ATA: not found — will create ATA (payer = market engine authority)",
    payer.publicKey.toBase58(),
  );

  const createIx = createAssociatedTokenAccountInstruction(
    payer.publicKey,
    ata,
    teamTreasury,
    WSOL_MINT,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  return { ata, alreadyExisted: false, createIx };
}

/**
 * Mock / dry-run layout using the same PDAs as production (`omnipair-rs` seeds).
 * `lpMint` is only a placeholder public key unless provided.
 */
export function deriveOmnipairMarketAccounts(
  programId: PublicKey,
  yesMint: PublicKey,
  noMint: PublicKey,
  lpMintPlaceholder?: PublicKey,
  poolParams?: OmnipairParamsHashInput,
): Omit<
  InitOmnipairMarketResult,
  | "programId"
  | "preInitializeSignature"
  | "bootstrapLiquiditySignature"
  | "initializeSignature"
  | "initSignature"
> {
  const L = deriveOmnipairLayout(
    programId,
    yesMint,
    noMint,
    poolParams ?? DEFAULT_OMNIPAIR_POOL_PARAMS,
  );
  const [futarchyAuthority] = getGlobalFutarchyAuthorityPDA(programId);
  const [cYes] = getCollateralVaultPDA(programId, L.pairAddress, yesMint);
  const [cNo] = getCollateralVaultPDA(programId, L.pairAddress, noMint);
  return {
    pairAddress: L.pairAddress,
    yesMint,
    noMint,
    token0Mint: L.token0Mint,
    token1Mint: L.token1Mint,
    vaultA: L.reserve0Vault,
    vaultB: L.reserve1Vault,
    lpMint: lpMintPlaceholder ?? Keypair.generate().publicKey,
    rateModel: Keypair.generate().publicKey,
    collateralYes: cYes,
    collateralNo: cNo,
    futarchyAuthority,
  };
}

/**
 * Omnipair `initialize` — `InitializeAndBootstrap` in omnipair-rs
 * `programs/omnipair/src/instructions/liquidity/initialize.rs`.
 */
export async function initializeOmnipairMarket(
  params: InitOmnipairMarketParams,
): Promise<InitOmnipairMarketResult> {
  const {
    connection,
    payer,
    yesMint,
    noMint,
    authorityYesAta,
    authorityNoAta,
    bootstrapPerSide,
  } = params;

  const execute = process.env.OMNIPAIR_EXECUTE_INIT === "true";
  if (!execute) {
    throw new Error(
      "OMNIPAIR_EXECUTE_INIT must be true for on-chain pool initialization.",
    );
  }

  const programId = requireOmnipairProgramId();
  console.info(
    "[predicted][omnipair-init] deploying against Omnipair program id",
    programId.toBase58(),
    "(NEXT_PUBLIC_OMNIPAIR_PROGRAM_ID)",
  );
  const poolParams = params.poolParams ?? DEFAULT_OMNIPAIR_POOL_PARAMS;

  const [token0Mint, token1Mint] = orderMints(yesMint, noMint);
  const deployerToken0Ata = token0Mint.equals(yesMint)
    ? authorityYesAta
    : authorityNoAta;
  const deployerToken1Ata = token1Mint.equals(yesMint)
    ? authorityYesAta
    : authorityNoAta;

  const paramsHash = deriveOmnipairLayout(
    programId,
    yesMint,
    noMint,
    poolParams,
  ).paramsHash;
  const [pairAddress] = getPairPDA(
    programId,
    token0Mint,
    token1Mint,
    paramsHash,
  );
  const [futarchyAuthority] = getGlobalFutarchyAuthorityPDA(programId);
  const [reserve0Vault] = getReserveVaultPDA(programId, pairAddress, token0Mint);
  const [reserve1Vault] = getReserveVaultPDA(programId, pairAddress, token1Mint);
  const [collateral0Vault] = getCollateralVaultPDA(
    programId,
    pairAddress,
    token0Mint,
  );
  const [collateral1Vault] = getCollateralVaultPDA(
    programId,
    pairAddress,
    token1Mint,
  );

  const teamTreasury = loadTeamTreasuryWallet();
  const {
    ata: teamTreasuryWsolAta,
    alreadyExisted: treasuryWsolAtaAlreadyExisted,
    createIx: createTreasuryWsolAtaIx,
  } = await ensureTeamTreasuryWsolAta(connection, payer, teamTreasury);

  const rateModelKp = Keypair.generate();
  const lpMintKp = Keypair.generate();
  const lpMetadata = getLpTokenMetadataPDA(lpMintKp.publicKey);
  const deployerLpAta = getAssociatedTokenAddressSync(
    lpMintKp.publicKey,
    payer.publicKey,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const { lpName, lpSymbol, lpUri } = buildOmnipairLpTokenMetadata(
    token0Mint,
    token1Mint,
  );
  console.info("[predicted][omnipair-init] LP metadata (on-chain validation)", {
    lpName,
    lpSymbol,
    lpUri,
    lpNameLen: lpName.length,
    lpSymbolLen: lpSymbol.length,
    lpUriLen: lpUri.length,
  });

  const bootstrapArgs = buildInitializeAndBootstrapArgs({
    pool: poolParams,
    version: OMNIPAIR_PROTOCOL_VERSION,
    amount0In: bootstrapPerSide,
    amount1In: bootstrapPerSide,
    minLiquidityOut: 0n,
    lpName,
    lpSymbol,
    lpUri,
  });

  const ixDataBody = serializeInitializeAndBootstrapArgs(bootstrapArgs);
  const discriminator = anchorDiscriminator(IX_NAME);
  const ixData = Buffer.concat([discriminator, ixDataBody]);

  /** Anchor `#[event_cpi]` on `InitializeAndBootstrap` — see omnipair-rs `initialize.rs`. */
  const { publicKey: eventAuthority } = getEventAuthorityPDA(programId);

  const keys = [
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: token0Mint, isSigner: false, isWritable: false },
    { pubkey: token1Mint, isSigner: false, isWritable: false },
    { pubkey: pairAddress, isSigner: false, isWritable: true },
    { pubkey: futarchyAuthority, isSigner: false, isWritable: false },
    { pubkey: rateModelKp.publicKey, isSigner: true, isWritable: true },
    { pubkey: lpMintKp.publicKey, isSigner: true, isWritable: true },
    { pubkey: lpMetadata, isSigner: false, isWritable: true },
    { pubkey: deployerLpAta, isSigner: false, isWritable: true },
    { pubkey: reserve0Vault, isSigner: false, isWritable: true },
    { pubkey: reserve1Vault, isSigner: false, isWritable: true },
    { pubkey: collateral0Vault, isSigner: false, isWritable: true },
    { pubkey: collateral1Vault, isSigner: false, isWritable: true },
    { pubkey: deployerToken0Ata, isSigner: false, isWritable: true },
    { pubkey: deployerToken1Ata, isSigner: false, isWritable: true },
    { pubkey: teamTreasury, isSigner: false, isWritable: false },
    { pubkey: teamTreasuryWsolAta, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: MPL_TOKEN_METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
    {
      pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,
      isSigner: false,
      isWritable: false,
    },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    /** Self-CPI `emit!` / event stack (Anchor `event_cpi`). */
    { pubkey: eventAuthority, isSigner: false, isWritable: false },
    { pubkey: programId, isSigner: false, isWritable: false },
  ];

  const initializeAccountLabels = [
    "deployer",
    "token0_mint",
    "token1_mint",
    "pair",
    "futarchy_authority",
    "rate_model",
    "lp_mint",
    "lp_token_metadata",
    "deployer_lp_token_account",
    "reserve_vault_0",
    "reserve_vault_1",
    "collateral_vault_0",
    "collateral_vault_1",
    "deployer_token0_account",
    "deployer_token1_account",
    "team_treasury",
    "team_treasury_wsol_account",
    "system_program",
    "token_program",
    "token_2022_program",
    "token_metadata_program",
    "associated_token_program",
    "rent",
    "event_authority",
    "program",
  ] as const;
  console.info(
    "[predicted][omnipair-init] initialize accounts (ordered, matches omnipair-rs InitializeAndBootstrap + event_cpi):",
  );
  keys.forEach((meta, i) => {
    const label = initializeAccountLabels[i] ?? `[${i}]`;
    console.info(
      `[predicted][omnipair-init]   [${i}] ${label}`,
      meta.pubkey.toBase58(),
      `signer=${meta.isSigner} writable=${meta.isWritable}`,
    );
  });
  console.info("[predicted][omnipair-init] labels — pair", pairAddress.toBase58());
  console.info(
    "[predicted][omnipair-init] labels — reserve vault 0 (token0)",
    reserve0Vault.toBase58(),
  );
  console.info(
    "[predicted][omnipair-init] labels — reserve vault 1 (token1)",
    reserve1Vault.toBase58(),
  );
  console.info(
    "[predicted][omnipair-init] labels — collateral vault 0 (token0)",
    collateral0Vault.toBase58(),
  );
  console.info(
    "[predicted][omnipair-init] labels — collateral vault 1 (token1)",
    collateral1Vault.toBase58(),
  );
  console.info(
    "[predicted][omnipair-init] labels — futarchy authority",
    futarchyAuthority.toBase58(),
  );
  console.info(
    "[predicted][omnipair-init] labels — team treasury WSOL account",
    teamTreasuryWsolAta.toBase58(),
  );
  console.info(
    "[predicted][omnipair-init] labels — event authority",
    eventAuthority.toBase58(),
  );
  console.info(
    "[predicted][omnipair-init] labels — lp mint",
    lpMintKp.publicKey.toBase58(),
  );
  console.info(
    "[predicted][omnipair-init] labels — token program",
    TOKEN_PROGRAM_ID.toBase58(),
  );
  console.info(
    "[predicted][omnipair-init] labels — associated token program",
    ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
  );
  console.info(
    "[predicted][omnipair-init] labels — system program",
    SystemProgram.programId.toBase58(),
  );

  const initIx = new TransactionInstruction({
    keys,
    programId,
    data: ixData,
  });

  console.info("[predicted][omnipair-init] instructionName", IX_NAME);
  console.info(
    "[predicted][omnipair-init] discriminator (sha256 global:initialize)[0..8] hex",
    discriminator.toString("hex"),
  );
  console.info(
    "[predicted][omnipair-init] serialized instruction args byte length",
    ixDataBody.length,
  );
  console.info(
    "[predicted][omnipair-init] total ix data length",
    ixData.length,
  );

  console.info("[predicted][omnipair-init] YES mint", yesMint.toBase58());
  console.info("[predicted][omnipair-init] NO mint", noMint.toBase58());
  console.info("[predicted][omnipair-init] token0", token0Mint.toBase58());
  console.info("[predicted][omnipair-init] token1", token1Mint.toBase58());
  console.info(
    "[predicted][omnipair-init] paramsHash (hex)",
    paramsHash.toString("hex"),
  );
  console.info("[predicted][omnipair-init] pair PDA", pairAddress.toBase58());
  console.info(
    "[predicted][omnipair-init] futarchy authority (global PDA)",
    futarchyAuthority.toBase58(),
  );
  console.info(
    "[predicted][omnipair-init] PAIR_CREATION_FEE_LAMPORTS",
    PAIR_CREATION_FEE_LAMPORTS.toString(),
  );

  let preInitializeSignature: string;
  try {
    const preInitTx = await buildOmnipairPreInitializeTransaction({
      connection,
      payer,
      lpMintKp,
      createTreasuryWsolAtaIx,
    });
    await logLegacyTransactionMetricsBeforeSend(
      "[omnipair] tx1 pre-initialize accounts (WSOL ATA optional + LP mint account)",
      connection,
      preInitTx,
      payer.publicKey,
    );
    console.info(
      "[predicted][omnipair-init] BEFORE sendAndConfirm tx1 (pre-initialize accounts)",
    );
    preInitializeSignature = await sendAndConfirmTransactionWithSigners(
      connection,
      preInitTx,
      [payer, lpMintKp],
    );
    console.info(
      "[predicted][omnipair-init] tx1 signature (pre-initialize accounts)",
      preInitializeSignature,
    );
    console.info(
      "[predicted][omnipair-init] team treasury WSOL ATA outcome:",
      treasuryWsolAtaAlreadyExisted
        ? "already existed before tx1"
        : "created in tx1 (fee paid by market engine authority)",
    );
  } catch (e) {
    const msg = formatUnknownError(e);
    console.error("[predicted][omnipair-init] tx1 pre-initialize failed:", msg, e);
    throw new PipelineStageError("FAILED_AT_OMNIPAIR_PRE_INIT", msg, {
      cause: e,
      missingProgramId: extractMissingProgramIdFromSolanaError(e),
    });
  }

  let bootstrapLiquiditySignature: string;
  try {
    const ixY = createMintToInstruction(
      yesMint,
      authorityYesAta,
      payer.publicKey,
      bootstrapPerSide,
    );
    const ixN = createMintToInstruction(
      noMint,
      authorityNoAta,
      payer.publicKey,
      bootstrapPerSide,
    );
    const bootstrapTx = new Transaction().add(ixY, ixN);
    await logLegacyTransactionMetricsBeforeSend(
      "[omnipair] tx2 bootstrap liquidity (mint YES + NO to engine authority ATAs — required before Initialize pulls liquidity)",
      connection,
      bootstrapTx,
      payer.publicKey,
    );
    console.info(
      "[predicted][omnipair-init] BEFORE sendAndConfirm tx2 (bootstrap mint)",
    );
    bootstrapLiquiditySignature = await sendAndConfirmTransactionWithSigners(
      connection,
      bootstrapTx,
      [payer],
    );
    console.info(
      "[predicted][omnipair-init] tx2 signature (bootstrap liquidity / mint)",
      bootstrapLiquiditySignature,
    );
  } catch (e) {
    const msg = formatUnknownError(e);
    console.error(
      "[predicted][omnipair-init] tx2 bootstrap liquidity (mint) failed:",
      msg,
      e,
    );
    throw new PipelineStageError("FAILED_AT_LIQUIDITY_SEED", msg, {
      cause: e,
      missingProgramId: extractMissingProgramIdFromSolanaError(e),
    });
  }

  let initializeSignature: string;
  try {
    const initOnlyTx = new Transaction().add(initIx);
    await logLegacyTransactionMetricsBeforeSend(
      "[omnipair] tx3 Omnipair Initialize (only)",
      connection,
      initOnlyTx,
      payer.publicKey,
    );
    console.info(
      "[predicted][omnipair-init] BEFORE sendAndConfirm tx3 (Omnipair Initialize)",
    );
    initializeSignature = await sendAndConfirmTransactionWithSigners(
      connection,
      initOnlyTx,
      [payer, rateModelKp, lpMintKp],
    );
    console.info(
      "[predicted][omnipair-init] tx3 signature (Omnipair Initialize)",
      initializeSignature,
    );
  } catch (e) {
    const msg = formatUnknownError(e);
    console.error("[predicted][omnipair-init] tx3 Omnipair initialize failed:", msg, e);
    throw new PipelineStageError("FAILED_AT_OMNIPAIR_INIT", msg, {
      cause: e,
      missingProgramId: extractMissingProgramIdFromSolanaError(e),
    });
  }

  return {
    programId,
    pairAddress,
    yesMint,
    noMint,
    token0Mint,
    token1Mint,
    vaultA: reserve0Vault,
    vaultB: reserve1Vault,
    lpMint: lpMintKp.publicKey,
    rateModel: rateModelKp.publicKey,
    collateralYes: getCollateralVaultPDA(programId, pairAddress, yesMint)[0],
    collateralNo: getCollateralVaultPDA(programId, pairAddress, noMint)[0],
    futarchyAuthority,
    preInitializeSignature,
    bootstrapLiquiditySignature,
    initializeSignature,
    initSignature: initializeSignature,
  };
}

/**
 * pmAMM Anchor client (`Program#methods` only — no manual instruction payloads).
 * The checked-in `lib/engines/idl/pm_amm.json` must correspond to **`NEXT_PUBLIC_PMAMM_PROGRAM_ID`**
 * (prefer copying from `contracts/pm-amm-anchor/target/idl/` after anchor build/deploy).
 */
import {
  Program,
  AnchorProvider,
  BN,
  type Idl,
} from "@coral-xyz/anchor";
import BNconstructor from "bn.js";
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  Transaction,
  SYSVAR_RENT_PUBKEY,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import pmAmmIdl from "@/lib/engines/idl/pm_amm.json";
import {
  requirePmammProgramId,
  getPmammCollateralMint,
  PMAMM_PROGRAM_NOT_ON_CLUSTER_MESSAGE,
} from "./pmamm-config";
import {
  derivePmammMarketPdas,
  derivePmammLpPda,
  pmammMetadataPda,
  PMAMM_TOKEN_METADATA_PROGRAM_ID,
} from "./pmamm-pda";
import { devnetTxExplorerUrl } from "@/lib/utils/solana-explorer";
import { getSolanaRpcUrl } from "@/lib/solana/rpc-url";

const CU_LIMIT = 1_400_000;

function connectionEndpointHint(connection: Connection): string {
  const c = connection as Connection & {
    rpcEndpoint?: string;
    _rpcEndpoint?: string;
    commitment?: unknown;
  };
  return (
    c.rpcEndpoint ?? c._rpcEndpoint ?? "(Connection endpoint unknown — see NEXT_PUBLIC_SOLANA_RPC_URL)"
  );
}

/** Log RPC/cluster before InitializeMarket simulate/send (tasks 1 & 6). */
export function logPmammInitializeMarketClusterContext(opts: {
  programId: PublicKey;
  connection: Connection;
}): void {
  const { programId, connection } = opts;
  const envRpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ?? null;
  const network = process.env.NEXT_PUBLIC_NETWORK?.trim() ?? null;
  const rpcResolved = getSolanaRpcUrl();
  const endpoint = connectionEndpointHint(connection);
  const cm = connection as Connection & { commitment?: unknown };
  const commitmentUsed =
    typeof cm.commitment === "string"
      ? cm.commitment
      : "confirmed";

  if (
    rpcResolved.includes("mainnet-beta") ||
    rpcResolved.includes("api.mainnet")
  ) {
    console.warn(
      "[predicted][pmamm] RPC looks like mainnet — pmAMM is expected on devnet for this flow; wrong cluster causes ProgramAccountNotFound.",
    );
  }
  if (rpcResolved.includes("127.0.0.1") || rpcResolved.includes("localhost")) {
    console.warn(
      "[predicted][pmamm] Local RPC — deploy pmAMM to this validator or use devnet RPC + deployed program id.",
    );
  }

  const clusterParam = network?.toLowerCase().includes("main")
    ? "mainnet-beta"
    : "devnet";

  console.info("[predicted][pmamm] init_market_cluster_context", {
    NEXT_PUBLIC_PMAMM_PROGRAM_ID: programId.toBase58(),
    NEXT_PUBLIC_NETWORK: network,
    NEXT_PUBLIC_SOLANA_RPC_URL: envRpc,
    rpcUrlResolvedFromEnv: rpcResolved,
    connectionEndpointLogged: endpoint,
    commitmentUsed,
    verifyExplorerSolana: `https://explorer.solana.com/address/${programId.toBase58()}?cluster=${clusterParam}`,
    verifyCliSuggested: `solana program show ${programId.toBase58()} --url ${rpcResolved}`,
  });
}

/**
 * Loads the bpf program account (`getProgramAccounts`/`getAccountInfo(programId)`).
 * If missing, InitializeMarket will fail with ProgramAccountNotFound — fail fast instead.
 */
export async function ensurePmammProgramLoaderAccountExists(
  connection: Connection,
  programId: PublicKey,
): Promise<void> {
  const info = await connection.getAccountInfo(programId, "confirmed");
  if (info != null) return;
  throw new Error(PMAMM_PROGRAM_NOT_ON_CLUSTER_MESSAGE);
}

/** Checked-in Anchor IDL (must match bytecode at `NEXT_PUBLIC_PMAMM_PROGRAM_ID`). */
export const PMAMM_IDL_RELATIVE_SOURCE_PATH = "lib/engines/idl/pm_amm.json";

function noopWallet(pubkey: PublicKey) {
  return {
    publicKey: pubkey,
    signTransaction: async (tx: Transaction) => tx,
    signAllTransactions: async (txs: Transaction[]) => txs,
  };
}

export function createPmammProgram(
  connection: Connection,
  walletPubkey: PublicKey,
): Program<Idl> {
  const programId = requirePmammProgramId();
  const idlFileAddr = (
    pmAmmIdl as unknown as {
      address?: string;
      metadata?: { name?: string };
    }
  ).address?.trim();
  if (idlFileAddr && idlFileAddr !== programId.toBase58()) {
    console.warn(
      "[predicted][pmamm] NEXT_PUBLIC_PMAMM_PROGRAM_ID differs from lib/engines/idl/pm_amm.json `address`; runtime uses env (risk of Anchor 102 if IDL bytecode skew). Copy target/idl from your deploy.",
      { envProgramId: programId.toBase58(), idlAddressField: idlFileAddr },
    );
  }
  const idl = {
    ...(pmAmmIdl as Idl),
    address: programId.toBase58(),
  };
  const provider = new AnchorProvider(
    connection,
    noopWallet(walletPubkey) as never,
    AnchorProvider.defaultOptions(),
  );
  return new Program(idl, provider);
}

type PmammMarketAccountData = {
  collateralMint: PublicKey;
  vault: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
  reserveYes: bigint;
  reserveNo: bigint;
  totalLpShares: bigint;
  endTs: bigint;
  resolved: boolean;
};

export async function fetchPmammMarketAccount(
  program: Program<Idl>,
  marketPda: PublicKey,
): Promise<PmammMarketAccountData> {
  type Fetched = {
    collateralMint: PublicKey;
    vault: PublicKey;
    yesMint: PublicKey;
    noMint: PublicKey;
    reserveYes: { toString: () => string };
    reserveNo: { toString: () => string };
    totalLpShares: { toString: () => string };
    endTs: { toString: () => string };
    resolved: boolean;
  };
  const raw = program as unknown as {
    account: { market: { fetch: (p: PublicKey) => Promise<Fetched> } };
  };
  const a = await raw.account.market.fetch(marketPda);
  return {
    collateralMint: a.collateralMint,
    vault: a.vault,
    yesMint: a.yesMint,
    noMint: a.noMint,
    reserveYes: BigInt(a.reserveYes.toString()),
    reserveNo: BigInt(a.reserveNo.toString()),
    totalLpShares: BigInt(a.totalLpShares.toString()),
    endTs: BigInt(a.endTs.toString()),
    resolved: a.resolved,
  };
}

/** Read-only pool snapshot for UI pricing (client-safe). */
export async function readPmammMarketPoolSnapshot(
  connection: Connection,
  marketPda: PublicKey,
): Promise<{
  reserveYes: bigint;
  reserveNo: bigint;
  totalLpShares: bigint;
  endTs: bigint;
  resolved: boolean;
}> {
  const program = createPmammProgram(connection, SystemProgram.programId);
  const a = await fetchPmammMarketAccount(program, marketPda);
  return {
    reserveYes: a.reserveYes,
    reserveNo: a.reserveNo,
    totalLpShares: a.totalLpShares,
    endTs: a.endTs,
    resolved: a.resolved,
  };
}

export function pmammExplorerUrl(signature: string): string {
  return devnetTxExplorerUrl(signature);
}

async function latestBlockhash(connection: Connection) {
  return connection.getLatestBlockhash("confirmed");
}

async function baseTx(
  connection: Connection,
  feePayer: PublicKey,
  instructions: TransactionInstruction[],
): Promise<Transaction> {
  const { blockhash, lastValidBlockHeight } = await latestBlockhash(connection);
  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: CU_LIMIT }));
  for (const ix of instructions) tx.add(ix);
  tx.recentBlockhash = blockhash;
  (tx as Transaction & { lastValidBlockHeight?: number }).lastValidBlockHeight =
    lastValidBlockHeight;
  tx.feePayer = feePayer;
  return tx;
}

async function maybeUsdcAtaIx(
  connection: Connection,
  payer: PublicKey,
  owner: PublicKey,
  usdcMint: PublicKey,
): Promise<TransactionInstruction | null> {
  const ata = getAssociatedTokenAddressSync(
    usdcMint,
    owner,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const info = await connection.getAccountInfo(ata, "confirmed");
  if (info) return null;
  return createAssociatedTokenAccountIdempotentInstruction(
    payer,
    ata,
    owner,
    usdcMint,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
}

/** Server: build initialize_market (sign with authority keypair before send). */
export async function pmammBuildInitializeMarketTransaction(params: {
  connection: Connection;
  authority: PublicKey;
  marketId: BN;
  endTs: BN;
  name: string;
}): Promise<{
  transaction: Transaction;
  marketPda: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
  vault: PublicKey;
}> {
  const programId = requirePmammProgramId();
  logPmammInitializeMarketClusterContext({
    programId,
    connection: params.connection,
  });
  await ensurePmammProgramLoaderAccountExists(params.connection, programId);

  const collateralMint = getPmammCollateralMint();
  const { marketPda, yesMint, noMint, vault } = derivePmammMarketPdas(
    params.marketId,
    programId,
  );
  const program = createPmammProgram(params.connection, params.authority);
  const ix = await program.methods
    .initializeMarket(params.marketId, params.endTs, params.name)
    .accounts({
      authority: params.authority,
      market: marketPda,
      collateralMint,
      yesMint,
      noMint,
      vault,
      yesMetadata: pmammMetadataPda(yesMint),
      noMetadata: pmammMetadataPda(noMint),
      tokenMetadataProgram: PMAMM_TOKEN_METADATA_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();

  const args = [params.marketId, params.endTs, params.name];
  console.log({
    args,
    argTypes: args.map((a) => typeof a),
    isBN: args.map((a) => BNconstructor.isBN(a)),
  });

  const tx = await baseTx(params.connection, params.authority, [ix]);
  return { transaction: tx, marketPda, yesMint, noMint, vault };
}

/** Engine-signed deposit after init (treasury must hold USDC). */
export async function pmammBuildDepositLiquidityEngineTransaction(params: {
  connection: Connection;
  signer: PublicKey;
  marketPda: PublicKey;
  amountAtoms: BN;
}): Promise<Transaction> {
  const programId = requirePmammProgramId();
  const program = createPmammProgram(params.connection, params.signer);
  const acc = await fetchPmammMarketAccount(program, params.marketPda);
  const collateralMint = acc.collateralMint as PublicKey;
  const vault = acc.vault as PublicKey;
  const lpPosition = derivePmammLpPda(
    params.marketPda,
    params.signer,
    programId,
  );
  const userCollateral = getAssociatedTokenAddressSync(
    collateralMint,
    params.signer,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const pre: TransactionInstruction[] = [];
  const ataIx = await maybeUsdcAtaIx(
    params.connection,
    params.signer,
    params.signer,
    collateralMint,
  );
  if (ataIx) pre.push(ataIx);
  const ix = await program.methods
    .depositLiquidity(params.amountAtoms)
    .accounts({
      signer: params.signer,
      market: params.marketPda,
      collateralMint,
      vault,
      userCollateral,
      lpPosition,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
  pre.push(ix);
  return baseTx(params.connection, params.signer, pre);
}

export async function pmammBuildBuyWithUsdcTransaction(params: {
  connection: Connection;
  user: PublicKey;
  marketPda: PublicKey;
  side: "yes" | "no";
  usdcAmountAtoms: BN;
  minOut: BN;
}): Promise<Transaction> {
  const program = createPmammProgram(params.connection, params.user);
  const acc = await fetchPmammMarketAccount(program, params.marketPda);
  const { collateralMint, yesMint, noMint, vault } = acc;
  const userCollateral = getAssociatedTokenAddressSync(
    collateralMint,
    params.user,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const userYes = getAssociatedTokenAddressSync(
    yesMint,
    params.user,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const userNo = getAssociatedTokenAddressSync(
    noMint,
    params.user,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const direction =
    params.side === "yes" ? { usdcToYes: {} } : { usdcToNo: {} };
  const pre: TransactionInstruction[] = [];
  const u = await maybeUsdcAtaIx(
    params.connection,
    params.user,
    params.user,
    collateralMint,
  );
  if (u) pre.push(u);
  pre.push(
    createAssociatedTokenAccountIdempotentInstruction(
      params.user,
      userYes,
      params.user,
      yesMint,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ),
    createAssociatedTokenAccountIdempotentInstruction(
      params.user,
      userNo,
      params.user,
      noMint,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ),
  );
  const ix = await program.methods
    .swap(direction, params.usdcAmountAtoms, params.minOut)
    .accounts({
      signer: params.user,
      market: params.marketPda,
      collateralMint,
      yesMint,
      noMint,
      vault,
      userCollateral,
      userYes,
      userNo,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
  pre.push(ix);
  return baseTx(params.connection, params.user, pre);
}

export async function pmammBuildSellOutcomeTransaction(params: {
  connection: Connection;
  user: PublicKey;
  marketPda: PublicKey;
  sellSide: "yes" | "no";
  amountInAtoms: BN;
  minOut: BN;
}): Promise<Transaction> {
  const program = createPmammProgram(params.connection, params.user);
  const acc = await fetchPmammMarketAccount(program, params.marketPda);
  const { collateralMint, yesMint, noMint, vault } = acc;
  const userCollateral = getAssociatedTokenAddressSync(
    collateralMint,
    params.user,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const userYes = getAssociatedTokenAddressSync(
    yesMint,
    params.user,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const userNo = getAssociatedTokenAddressSync(
    noMint,
    params.user,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const direction =
    params.sellSide === "yes" ? { yesToUsdc: {} } : { noToUsdc: {} };
  const pre: TransactionInstruction[] = [];
  const u = await maybeUsdcAtaIx(
    params.connection,
    params.user,
    params.user,
    collateralMint,
  );
  if (u) pre.push(u);
  const ix = await program.methods
    .swap(direction, params.amountInAtoms, params.minOut)
    .accounts({
      signer: params.user,
      market: params.marketPda,
      collateralMint,
      yesMint,
      noMint,
      vault,
      userCollateral,
      userYes,
      userNo,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
  pre.push(ix);
  return baseTx(params.connection, params.user, pre);
}

export async function pmammBuildDepositLiquidityUserTransaction(params: {
  connection: Connection;
  user: PublicKey;
  marketPda: PublicKey;
  amountAtoms: BN;
}): Promise<Transaction> {
  const programId = requirePmammProgramId();
  const program = createPmammProgram(params.connection, params.user);
  const acc = await fetchPmammMarketAccount(program, params.marketPda);
  const { collateralMint, vault } = acc;
  const lpPosition = derivePmammLpPda(
    params.marketPda,
    params.user,
    programId,
  );
  const userCollateral = getAssociatedTokenAddressSync(
    collateralMint,
    params.user,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const pre: TransactionInstruction[] = [];
  const ataIx = await maybeUsdcAtaIx(
    params.connection,
    params.user,
    params.user,
    collateralMint,
  );
  if (ataIx) pre.push(ataIx);
  const ix = await program.methods
    .depositLiquidity(params.amountAtoms)
    .accounts({
      signer: params.user,
      market: params.marketPda,
      collateralMint,
      vault,
      userCollateral,
      lpPosition,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
  pre.push(ix);
  return baseTx(params.connection, params.user, pre);
}

export async function pmammBuildWithdrawLiquidityTransaction(params: {
  connection: Connection;
  user: PublicKey;
  marketPda: PublicKey;
  sharesToBurn: BN;
}): Promise<Transaction> {
  const programId = requirePmammProgramId();
  const program = createPmammProgram(params.connection, params.user);
  const acc = await fetchPmammMarketAccount(program, params.marketPda);
  const { collateralMint, yesMint, noMint } = acc;
  const lpPosition = derivePmammLpPda(
    params.marketPda,
    params.user,
    programId,
  );
  const userYes = getAssociatedTokenAddressSync(
    yesMint,
    params.user,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const userNo = getAssociatedTokenAddressSync(
    noMint,
    params.user,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const pre: TransactionInstruction[] = [
    createAssociatedTokenAccountIdempotentInstruction(
      params.user,
      userYes,
      params.user,
      yesMint,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ),
    createAssociatedTokenAccountIdempotentInstruction(
      params.user,
      userNo,
      params.user,
      noMint,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ),
  ];
  const ix = await program.methods
    .withdrawLiquidity(params.sharesToBurn)
    .accounts({
      signer: params.user,
      market: params.marketPda,
      collateralMint,
      yesMint,
      noMint,
      lpPosition,
      userYes,
      userNo,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
  pre.push(ix);
  return baseTx(params.connection, params.user, pre);
}

export async function pmammBuildResolveMarketTransaction(params: {
  connection: Connection;
  authority: PublicKey;
  marketPda: PublicKey;
  winningSide: "yes" | "no";
}): Promise<Transaction> {
  const program = createPmammProgram(params.connection, params.authority);
  const side = params.winningSide === "yes" ? { yes: {} } : { no: {} };
  const ix = await program.methods
    .resolveMarket(side)
    .accounts({
      signer: params.authority,
      market: params.marketPda,
    })
    .instruction();
  return baseTx(params.connection, params.authority, [ix]);
}

export async function pmammBuildClaimWinningsTransaction(params: {
  connection: Connection;
  user: PublicKey;
  marketPda: PublicKey;
  amount: BN;
}): Promise<Transaction> {
  const program = createPmammProgram(params.connection, params.user);
  const acc = await fetchPmammMarketAccount(program, params.marketPda);
  const { collateralMint, yesMint, noMint, vault } = acc;
  const userCollateral = getAssociatedTokenAddressSync(
    collateralMint,
    params.user,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const userYes = getAssociatedTokenAddressSync(
    yesMint,
    params.user,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const userNo = getAssociatedTokenAddressSync(
    noMint,
    params.user,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const pre: TransactionInstruction[] = [];
  const u = await maybeUsdcAtaIx(
    params.connection,
    params.user,
    params.user,
    collateralMint,
  );
  if (u) pre.push(u);
  const ix = await program.methods
    .claimWinnings(params.amount)
    .accounts({
      signer: params.user,
      market: params.marketPda,
      collateralMint,
      yesMint,
      noMint,
      vault,
      userYes,
      userNo,
      userCollateral,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
  pre.push(ix);
  return baseTx(params.connection, params.user, pre);
}

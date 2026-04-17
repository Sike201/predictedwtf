import {
  Connection,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import type { Market } from "@/lib/types/market";
import { DEVNET_USDC_MINT } from "@/lib/solana/assets";
import {
  decodeFutarchySwapShareBps,
  decodeOmnipairPairAccount,
} from "@/lib/solana/decode-omnipair-accounts";
import {
  applySlippageFloor,
  estimateOmnipairSwapAmountOut,
} from "@/lib/solana/omnipair-swap-math";
import { buildOmnipairSwapInstruction } from "@/lib/solana/omnipair-swap-instruction";
import {
  DEFAULT_OMNIPAIR_POOL_PARAMS,
} from "@/lib/solana/omnipair-params-hash";
import {
  deriveOmnipairLayout,
  getGlobalFutarchyAuthorityPDA,
} from "@/lib/solana/omnipair-pda";
import { requireOmnipairProgramId } from "@/lib/solana/omnipair-program";
import type { WalletSignTransaction } from "@/lib/solana/send-transaction";
import { sendSignedTransaction } from "@/lib/solana/send-transaction";
import { TOKEN_2022_PROGRAM_ID } from "@/lib/solana/omnipair-constants";

export type TradeOutcomeSide = "yes" | "no";

export type ExecuteOmnipairOutcomeTradeParams = {
  connection: Connection;
  /** Connected wallet */
  publicKey: PublicKey;
  signTransaction: WalletSignTransaction;
  market: Market;
  side: TradeOutcomeSide;
  /**
   * Human amount of **input** token (the opposite outcome you sell).
   * Example: buying YES spends NO — enter how much NO to swap.
   */
  amountInHuman: string;
  /** Min-out slippage protection (default 100 = 1%). */
  slippageBps?: number;
};

export type ExecuteOmnipairOutcomeTradeResult = {
  signature: string;
  amountIn: bigint;
  minAmountOut: bigint;
  estimatedAmountOut: bigint;
  /** SPL token ATAs after confirm (raw amounts). */
  balancesAfter: {
    userTokenIn: bigint;
    userTokenOut: bigint;
    userUsdc: bigint | null;
  };
};

async function getSplProgramForMint(
  connection: Connection,
  mint: PublicKey,
): Promise<PublicKey> {
  const acc = await connection.getAccountInfo(mint, "confirmed");
  if (!acc) throw new Error(`Mint account not found: ${mint.toBase58()}`);
  if (acc.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  return TOKEN_PROGRAM_ID;
}

async function deriveUserAta(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey,
): Promise<PublicKey> {
  const programId = await getSplProgramForMint(connection, mint);
  return getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    programId,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
}

async function maybeCreateAtaIx(
  connection: Connection,
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
) {
  const programId = await getSplProgramForMint(connection, mint);
  const ata = getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    programId,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const info = await connection.getAccountInfo(ata, "confirmed");
  if (info) return null;
  return createAssociatedTokenAccountIdempotentInstruction(
    payer,
    ata,
    owner,
    mint,
    programId,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
}

function parseHumanToBaseUnits(amountHuman: string, decimals: number): bigint {
  const cleaned = amountHuman.replace(/[^0-9.]/g, "");
  if (!cleaned || cleaned === ".") return 0n;
  const [wholeRaw, fracRaw = ""] = cleaned.split(".");
  const whole = wholeRaw || "0";
  const fracPadded = (fracRaw + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fracPadded || "0");
}

async function readTokenBalance(
  connection: Connection,
  ata: PublicKey,
): Promise<bigint> {
  const info = await connection.getAccountInfo(ata, "confirmed");
  if (!info) return 0n;
  const a = await getAccount(connection, ata, "confirmed", info.owner);
  return a.amount;
}

/**
 * Executes an Omnipair GAMM **swap** on the YES/NO pair:
 * - **Buy YES** → swap NO → YES (`amountInHuman` is how much NO you sell).
 * - **Buy NO** → swap YES → NO (`amountInHuman` is how much YES you sell).
 *
 * The pool’s tradable pair is outcome vs outcome; devnet USDC is not a pool leg.
 * We still create a USDC ATA for the wallet (idempotent) for future collateral / routing flows.
 */
export async function executeOmnipairOutcomeTrade(
  params: ExecuteOmnipairOutcomeTradeParams,
): Promise<ExecuteOmnipairOutcomeTradeResult> {
  const {
    connection,
    publicKey,
    signTransaction,
    market,
    side,
    amountInHuman,
    slippageBps = 100,
  } = params;

  if (market.kind !== "binary") {
    throw new Error("Outcome swaps are implemented for binary YES/NO markets only.");
  }

  const pool = market.pool;
  if (!pool?.poolId || !pool.yesMint || !pool.noMint) {
    throw new Error("Missing on-chain pool (yes_mint, no_mint, pool_address).");
  }

  const programId = requireOmnipairProgramId();
  const yesMint = new PublicKey(pool.yesMint);
  const noMint = new PublicKey(pool.noMint);
  const pairAddress = new PublicKey(pool.poolId);

  const layout = deriveOmnipairLayout(
    programId,
    yesMint,
    noMint,
    DEFAULT_OMNIPAIR_POOL_PARAMS,
  );

  if (!layout.pairAddress.equals(pairAddress)) {
    throw new Error(
      "Pool address does not match derived Omnipair pair — check OMNIPAIR pool params match the deployed market.",
    );
  }

  const tokenInMint = side === "yes" ? noMint : yesMint;
  const tokenOutMint = side === "yes" ? yesMint : noMint;

  const isToken0In = tokenInMint.equals(layout.token0Mint);

  const pairInfo = await connection.getAccountInfo(pairAddress, "confirmed");
  if (!pairInfo?.data) {
    throw new Error("Pair account not found on-chain.");
  }
  const pairState = decodeOmnipairPairAccount(pairInfo.data);

  const [futarchyPk] = getGlobalFutarchyAuthorityPDA(programId);
  const futarchyInfo = await connection.getAccountInfo(futarchyPk, "confirmed");
  if (!futarchyInfo?.data) {
    throw new Error("Futarchy authority account not found.");
  }
  const futarchySwapShareBps = decodeFutarchySwapShareBps(futarchyInfo.data);

  const inDecimals = (
    await getMint(
      connection,
      tokenInMint,
      undefined,
      await getSplProgramForMint(connection, tokenInMint),
    )
  ).decimals;

  const amountIn = parseHumanToBaseUnits(amountInHuman, inDecimals);
  if (amountIn <= 0n) {
    throw new Error("Enter an amount greater than zero.");
  }

  const userTokenIn = await deriveUserAta(connection, publicKey, tokenInMint);
  const userTokenOut = await deriveUserAta(connection, publicKey, tokenOutMint);

  const inBal = await readTokenBalance(connection, userTokenIn);
  if (inBal < amountIn) {
    throw new Error(
      side === "yes"
        ? `Insufficient NO balance. Buying YES swaps NO → YES on the Omnipair pool; fund NO in this wallet first (or acquire NO from another transfer).`
        : `Insufficient YES balance. Buying NO swaps YES → NO on the Omnipair pool; fund YES in this wallet first.`,
    );
  }

  const estimatedAmountOut = estimateOmnipairSwapAmountOut({
    pair: pairState,
    futarchySwapShareBps,
    amountIn,
    isToken0In,
  });

  if (estimatedAmountOut <= 0n) {
    throw new Error(
      "Simulated output is zero — increase the amount or check pool liquidity.",
    );
  }

  const minAmountOut = applySlippageFloor(estimatedAmountOut, slippageBps);

  const swapIx = buildOmnipairSwapInstruction({
    programId,
    pair: pairAddress,
    rateModel: pairState.rateModel,
    tokenInMint,
    tokenOutMint,
    user: publicKey,
    userTokenIn,
    userTokenOut,
    amountIn,
    minAmountOut,
  });

  const tx = new Transaction();

  const ixUsdc = await maybeCreateAtaIx(
    connection,
    publicKey,
    publicKey,
    DEVNET_USDC_MINT,
  );
  if (ixUsdc) tx.add(ixUsdc);

  const ixIn = await maybeCreateAtaIx(
    connection,
    publicKey,
    publicKey,
    tokenInMint,
  );
  if (ixIn) tx.add(ixIn);

  const ixOut = await maybeCreateAtaIx(
    connection,
    publicKey,
    publicKey,
    tokenOutMint,
  );
  if (ixOut) tx.add(ixOut);

  tx.add(swapIx);

  tx.feePayer = publicKey;
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;

  const signature = await sendSignedTransaction({
    connection,
    transaction: tx,
    signTransaction,
  });

  const userUsdcAta = await deriveUserAta(
    connection,
    publicKey,
    DEVNET_USDC_MINT,
  );

  const balancesAfter = {
    userTokenIn: await readTokenBalance(connection, userTokenIn),
    userTokenOut: await readTokenBalance(connection, userTokenOut),
    userUsdc: (await connection.getAccountInfo(userUsdcAta, "confirmed"))
      ? await readTokenBalance(connection, userUsdcAta)
      : null,
  };

  return {
    signature,
    amountIn,
    minAmountOut,
    estimatedAmountOut,
    balancesAfter,
  };
}

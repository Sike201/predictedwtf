import type { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";

/** TODO: mainnet-beta support — wire program id, USDC mint, custody, and RPC defaults. */
export type PredictedCluster = "devnet" | "mainnet-beta";

export type PredictedWallet = {
  publicKey: PublicKey;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
};

export type PredictedClientConfig = {
  connection: Connection;
  wallet: PredictedWallet;
  cluster: PredictedCluster;
  /**
   * Omnipair program id (same as NEXT_PUBLIC_OMNIPAIR_PROGRAM_ID in the web app).
   * The client sets process env for internal lib calls when provided.
   */
  omnipairProgramId: string;
  /**
   * Market engine keypair — signs custody / mint legs co-present with the user wallet.
   * TODO: document mainnet key management (HSM, remote signer).
   */
  engine: Keypair;
  /**
   * Team treasury wallet (WSOL ATA recipient during pool init). Required for `createMarket`.
   */
  teamTreasury?: string | PublicKey;
};

export type MarketRef = {
  pairAddress: PublicKey | string;
  yesMint: PublicKey | string;
  noMint: PublicKey | string;
};

export type TransactionResult = {
  signature: string;
  explorerUrl: string;
};

export type BuyOutcomeResult = TransactionResult & {
  estimated: {
    /** Final chosen-side exposure in outcome space (rough AMM + mint estimate). */
    chosenSideTokens: string;
  };
};

export type SellOutcomeResult = TransactionResult & {
  estimated: {
    /** Devnet USDC out when route completes to custody USDC. */
    usdcOut: string;
  };
  summary: string;
};

export type DepositLiquidityResult = TransactionResult & {
  estimated: {
    lpTokens: string;
  };
};

export type WithdrawLiquidityResult = TransactionResult & {
  estimated: {
    usdcOut: string;
  };
};

export type CreateMarketResult = {
  preInitializeSignature: string;
  bootstrapLiquiditySignature: string;
  initializeSignature: string;
  /** Same as the final Omnipair init signature. */
  initSignature: string;
  programId: string;
  pairAddress: string;
  yesMint: string;
  noMint: string;
  explorer: {
    preInitialize: string;
    bootstrap: string;
    initialize: string;
  };
};

export type ResolveMarketResult = TransactionResult & {
  estimated: {
    usdcOut: string;
  };
  summary: string;
};

/**
 * @internal
 * Shared env snapshot for long-running app usage (SDK restores after each call that mutates env).
 */
export type EnvSnapshot = {
  nextPublicOmnipair: string | undefined;
  teamTreasury: string | undefined;
  executeInit: string | undefined;
};

export type { Connection, Keypair, PublicKey, Transaction };

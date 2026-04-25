import { PublicKey, Transaction, Connection, Keypair } from '@solana/web3.js';

/** TODO: mainnet-beta support — wire program id, USDC mint, custody, and RPC defaults. */
type PredictedCluster = "devnet" | "mainnet-beta";
type PredictedWallet = {
    publicKey: PublicKey;
    signTransaction: (tx: Transaction) => Promise<Transaction>;
};
type PredictedClientConfig = {
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
type MarketRef = {
    pairAddress: PublicKey | string;
    yesMint: PublicKey | string;
    noMint: PublicKey | string;
};
type TransactionResult = {
    signature: string;
    explorerUrl: string;
};
type BuyOutcomeResult = TransactionResult & {
    estimated: {
        /** Final chosen-side exposure in outcome space (rough AMM + mint estimate). */
        chosenSideTokens: string;
    };
};
type SellOutcomeResult = TransactionResult & {
    estimated: {
        /** Devnet USDC out when route completes to custody USDC. */
        usdcOut: string;
    };
    summary: string;
};
type DepositLiquidityResult = TransactionResult & {
    estimated: {
        lpTokens: string;
    };
};
type WithdrawLiquidityResult = TransactionResult & {
    estimated: {
        usdcOut: string;
    };
};
type CreateMarketResult = {
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
type ResolveMarketResult = TransactionResult & {
    estimated: {
        usdcOut: string;
    };
    summary: string;
};

type CreateMarketCallParams = {
    connection: Connection;
    engine: Keypair;
    cluster: PredictedCluster;
    teamTreasury: string | PublicKey;
    yesMint: string | PublicKey;
    noMint: string | PublicKey;
    authorityYesAta: string | PublicKey;
    authorityNoAta: string | PublicKey;
    /**
     * Human-sized bootstrap for each leg (outcome token decimals on devnet, typically 9),
     * e.g. "1000" mints 1000 YES and 1000 NO into the engine ATAs before `initialize` pulls it.
     */
    bootstrapPerSide: string;
};
/**
 * **Devnet (current):** run the three-step bootstrap + `initialize` flow for a YES/NO pair that already
 * exists. Supply engine-funded outcome token ATAs with enough balance for the bootstrap.
 *
 * // TODO: mainnet — fee payer / rent policy, `production` metadata constraints, and audited keys.
 */
declare function runCreateOmnipairMarket(params: CreateMarketCallParams): Promise<CreateMarketResult>;

type CreateMarketUserParams = Omit<CreateMarketCallParams, "connection" | "engine" | "cluster" | "teamTreasury"> & {
    teamTreasury?: string | PublicKey;
};
/**
 * High-level entry for the Predicted Omnipair GAMM layer on **devnet** (v0).
 * Sets `NEXT_PUBLIC_OMNIPAIR_PROGRAM_ID` in `process.env` for shared lib code — see README.
 */
declare class PredictedClient {
    readonly connection: PredictedClientConfig["connection"];
    readonly wallet: PredictedClientConfig["wallet"];
    readonly cluster: PredictedClientConfig["cluster"];
    readonly engine: PredictedClientConfig["engine"];
    private readonly teamTreasury;
    constructor(config: PredictedClientConfig);
    /**
     * Initialize the Omnipair pool for an existing YES/NO mint pair. Requires a funded bootstrap on the
     * engine ATAs. Team treasury (WSOL fee recipient context) is taken from the client config or
     * overridden in this call.
     */
    createMarket(params: CreateMarketUserParams): Promise<CreateMarketResult>;
    buyOutcome(market: MarketRef, side: "yes" | "no", usdcAmount: string, opts?: {
        slippageBps?: number;
        marketSlug?: string;
    }): Promise<BuyOutcomeResult>;
    sellOutcome(market: MarketRef, side: "yes" | "no", outcomeAmount: string, opts?: {
        slippageBps?: number;
        marketSlug?: string;
    }): Promise<SellOutcomeResult>;
    depositLiquidity(market: MarketRef, usdcAmount: string, opts?: {
        slippageBps?: number;
        marketSlug?: string;
    }): Promise<DepositLiquidityResult>;
    /**
     * Remove omLP and unwind to **devnet USDC** in one flow (user + engine co-signed).
     */
    withdrawLiquidity(market: MarketRef, lpAmount: string, opts?: {
        slippageBps?: number;
        marketSlug?: string;
    }): Promise<WithdrawLiquidityResult>;
    /**
     * **Post-resolution** redemption: burn winning tokens for USDC (not an oracle / resolve
     * instruction). `side` and `winningOutcome` must match a resolved market.
     */
    resolveMarket(market: MarketRef, side: "yes" | "no", winningOutcome: "yes" | "no", outcomeAmount: string, opts?: {
        marketSlug?: string;
    }): Promise<ResolveMarketResult>;
}

declare function solanaTransactionExplorerUrl(signature: string, cluster: PredictedCluster): string;

type BuyOutcomeCallParams = {
    connection: Connection;
    engine: Keypair;
    wallet: PredictedWallet;
    cluster: PredictedCluster;
    market: MarketRef;
    side: "yes" | "no";
    /** Devnet USDC, e.g. "25.5" (6 dp). */
    usdcAmount: string;
    slippageBps?: number;
    marketSlug?: string;
};
/**
 * **Devnet (current):** mint YES+NO from USDC via custody, then directionally swap the unwanted leg
 * on Omnipair (USDC is never the pool asset; this route matches the app).
 *
 * // TODO: mainnet USDC mint + verified custody and pool deployment id.
 */
declare function runBuyOutcome(p: BuyOutcomeCallParams): Promise<BuyOutcomeResult>;
type SellOutcomeCallParams = {
    connection: Connection;
    engine: Keypair;
    wallet: PredictedWallet;
    cluster: PredictedCluster;
    market: MarketRef;
    side: "yes" | "no";
    /** Outcome size on the selling leg (outcome human string, 9 dp on devnet). */
    outcomeAmount: string;
    slippageBps?: number;
    marketSlug?: string;
};
/**
 * **Devnet (current):** best-effort paired burn + custody USDC, with optional AMM leg.
 *
 * // TODO: mainnet USDC + custody invariants and routing parity with production.
 */
declare function runSellOutcome(p: SellOutcomeCallParams): Promise<SellOutcomeResult>;

type DepositLiquidityCallParams = {
    connection: Connection;
    engine: Keypair;
    wallet: PredictedWallet;
    cluster: PredictedCluster;
    market: MarketRef;
    /** Devnet USDC to convert into a balanced add (full-set mint + add_liquidity). */
    usdcAmount: string;
    slippageBps?: number;
    marketSlug?: string;
};
/**
 * **Devnet (current):** full-set USDC → YES+NO mint, then add_liquidity on the Omnipair pool.
 *
 * // TODO: mainnet — USDC leg + pool / custody alignment.
 */
declare function runDepositLiquidity(p: DepositLiquidityCallParams): Promise<DepositLiquidityResult>;
type WithdrawLiquidityCallParams = {
    connection: Connection;
    engine: Keypair;
    wallet: PredictedWallet;
    cluster: PredictedCluster;
    market: MarketRef;
    /**
     * Human LP size (omLP) — on-chain omLP decimal count is read from the LP mint; no raw units required.
     */
    lpAmount: string;
    slippageBps?: number;
    marketSlug?: string;
};
/**
 * **Devnet (current):** `remove_liquidity` and redeem to devnet USDC in one user + engine co-signed
 * transaction.
 *
 * // TODO: mainnet — custody / fee profile parity.
 */
declare function runWithdrawLiquidityToUsdc(p: WithdrawLiquidityCallParams): Promise<WithdrawLiquidityResult>;

type ResolveMarketCallParams = {
    connection: Connection;
    engine: Keypair;
    wallet: PredictedWallet;
    cluster: PredictedCluster;
    market: MarketRef;
    /**
     * Which side you are redeeming (must equal `winningOutcome` after on-chain or social resolution
     * for this market).
     */
    side: "yes" | "no";
    /** Declared resolution outcome. */
    winningOutcome: "yes" | "no";
    /**
     * Human burn size on the winning leg (9 dp on devnet; matches the app’s outcome inputs).
     */
    outcomeAmount: string;
    marketSlug?: string;
};
/**
 * **Devnet (current):** after a market is resolved, burn winning tokens for devnet USDC at custody
 * parity. This is *not* an oracle/resolve instruction; it is the user redemption path once the
 * winning outcome is known.
 *
 * // TODO: mainnet — custody limits, KYC, and on-chain attestation of resolution if applicable.
 */
declare function runResolveMarketRedemption(p: ResolveMarketCallParams): Promise<ResolveMarketResult>;

declare function toPublicKey(k: string | PublicKey, label?: string): PublicKey;

export { type BuyOutcomeCallParams, type BuyOutcomeResult, type CreateMarketCallParams, type CreateMarketResult, type DepositLiquidityCallParams, type DepositLiquidityResult, type MarketRef, PredictedClient, type PredictedClientConfig, type PredictedCluster, type PredictedWallet, type ResolveMarketCallParams, type ResolveMarketResult, type SellOutcomeCallParams, type SellOutcomeResult, type TransactionResult, type WithdrawLiquidityCallParams, type WithdrawLiquidityResult, runBuyOutcome, runCreateOmnipairMarket, runDepositLiquidity, runResolveMarketRedemption, runSellOutcome, runWithdrawLiquidityToUsdc, solanaTransactionExplorerUrl, toPublicKey };

import type { PublicKey } from "@solana/web3.js";
import { applyOmnipairProgramId } from "./env-apply.js";
import { runCreateOmnipairMarket, type CreateMarketCallParams } from "./market.js";
import {
  runDepositLiquidity,
  runWithdrawLiquidityToUsdc,
  type DepositLiquidityCallParams,
  type WithdrawLiquidityCallParams,
} from "./liquidity.js";
import { runResolveMarketRedemption, type ResolveMarketCallParams } from "./resolver.js";
import { runBuyOutcome, runSellOutcome, type BuyOutcomeCallParams, type SellOutcomeCallParams } from "./trade.js";
import type {
  BuyOutcomeResult,
  CreateMarketResult,
  DepositLiquidityResult,
  MarketRef,
  PredictedClientConfig,
  PredictedCluster,
  ResolveMarketResult,
  SellOutcomeResult,
  WithdrawLiquidityResult,
} from "./types.js";
import { toPublicKey } from "./utils.js";

function assertDevnetForNow(cluster: PredictedCluster) {
  if (cluster !== "devnet") {
    throw new Error(
      "predicted-sdk: this release is wired for devnet only. " +
        "TODO: mainnet-beta — program + USDC mint + custody and RPC policy.",
    );
  }
}

type CreateMarketUserParams = Omit<
  CreateMarketCallParams,
  "connection" | "engine" | "cluster" | "teamTreasury"
> & { teamTreasury?: string | PublicKey };

/**
 * High-level entry for the Predicted Omnipair GAMM layer on **devnet** (v0).
 * Sets `NEXT_PUBLIC_OMNIPAIR_PROGRAM_ID` in `process.env` for shared lib code — see README.
 */
export class PredictedClient {
  readonly connection: PredictedClientConfig["connection"];
  readonly wallet: PredictedClientConfig["wallet"];
  readonly cluster: PredictedClientConfig["cluster"];
  readonly engine: PredictedClientConfig["engine"];
  private readonly teamTreasury: string | undefined;

  constructor(config: PredictedClientConfig) {
    this.connection = config.connection;
    this.wallet = config.wallet;
    this.cluster = config.cluster;
    this.engine = config.engine;
    this.teamTreasury =
      config.teamTreasury === undefined
        ? undefined
        : toPublicKey(config.teamTreasury, "teamTreasury").toBase58();
    applyOmnipairProgramId(config.omnipairProgramId);
  }

  /**
   * Initialize the Omnipair pool for an existing YES/NO mint pair. Requires a funded bootstrap on the
   * engine ATAs. Team treasury (WSOL fee recipient context) is taken from the client config or
   * overridden in this call.
   */
  async createMarket(params: CreateMarketUserParams): Promise<CreateMarketResult> {
    assertDevnetForNow(this.cluster);
    const team = params.teamTreasury ?? this.teamTreasury;
    if (team === undefined) {
      throw new Error(
        "createMarket: set `teamTreasury` on PredictedClient or pass `teamTreasury` in this call (devnet OMNIPAIR_TEAM_TREASURY).",
      );
    }
    const teamResolved = toPublicKey(team, "teamTreasury").toBase58();
    return runCreateOmnipairMarket({
      connection: this.connection,
      engine: this.engine,
      cluster: this.cluster,
      teamTreasury: teamResolved,
      yesMint: params.yesMint,
      noMint: params.noMint,
      authorityYesAta: params.authorityYesAta,
      authorityNoAta: params.authorityNoAta,
      bootstrapPerSide: params.bootstrapPerSide,
    });
  }

  async buyOutcome(
    market: MarketRef,
    side: "yes" | "no",
    usdcAmount: string,
    opts?: { slippageBps?: number; marketSlug?: string },
  ): Promise<BuyOutcomeResult> {
    assertDevnetForNow(this.cluster);
    const p: BuyOutcomeCallParams = {
      connection: this.connection,
      engine: this.engine,
      wallet: this.wallet,
      cluster: this.cluster,
      market,
      side,
      usdcAmount,
      slippageBps: opts?.slippageBps,
      marketSlug: opts?.marketSlug,
    };
    return runBuyOutcome(p);
  }

  async sellOutcome(
    market: MarketRef,
    side: "yes" | "no",
    outcomeAmount: string,
    opts?: { slippageBps?: number; marketSlug?: string },
  ): Promise<SellOutcomeResult> {
    assertDevnetForNow(this.cluster);
    const p: SellOutcomeCallParams = {
      connection: this.connection,
      engine: this.engine,
      wallet: this.wallet,
      cluster: this.cluster,
      market,
      side,
      outcomeAmount,
      slippageBps: opts?.slippageBps,
      marketSlug: opts?.marketSlug,
    };
    return runSellOutcome(p);
  }

  async depositLiquidity(
    market: MarketRef,
    usdcAmount: string,
    opts?: { slippageBps?: number; marketSlug?: string },
  ): Promise<DepositLiquidityResult> {
    assertDevnetForNow(this.cluster);
    const p: DepositLiquidityCallParams = {
      connection: this.connection,
      engine: this.engine,
      wallet: this.wallet,
      cluster: this.cluster,
      market,
      usdcAmount,
      slippageBps: opts?.slippageBps,
      marketSlug: opts?.marketSlug,
    };
    return runDepositLiquidity(p);
  }

  /**
   * Remove omLP and unwind to **devnet USDC** in one flow (user + engine co-signed).
   */
  async withdrawLiquidity(
    market: MarketRef,
    lpAmount: string,
    opts?: { slippageBps?: number; marketSlug?: string },
  ): Promise<WithdrawLiquidityResult> {
    assertDevnetForNow(this.cluster);
    const p: WithdrawLiquidityCallParams = {
      connection: this.connection,
      engine: this.engine,
      wallet: this.wallet,
      cluster: this.cluster,
      market,
      lpAmount,
      slippageBps: opts?.slippageBps,
      marketSlug: opts?.marketSlug,
    };
    return runWithdrawLiquidityToUsdc(p);
  }

  /**
   * **Post-resolution** redemption: burn winning tokens for USDC (not an oracle / resolve
   * instruction). `side` and `winningOutcome` must match a resolved market.
   */
  async resolveMarket(
    market: MarketRef,
    side: "yes" | "no",
    winningOutcome: "yes" | "no",
    outcomeAmount: string,
    opts?: { marketSlug?: string },
  ): Promise<ResolveMarketResult> {
    assertDevnetForNow(this.cluster);
    const p: ResolveMarketCallParams = {
      connection: this.connection,
      engine: this.engine,
      wallet: this.wallet,
      cluster: this.cluster,
      market,
      side,
      winningOutcome,
      outcomeAmount,
      marketSlug: opts?.marketSlug,
    };
    return runResolveMarketRedemption(p);
  }
}

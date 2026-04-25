import type { Connection, Keypair, PublicKey } from "@solana/web3.js";
import type { MarketEngine } from "@/lib/types/market";

export type EngineTxResult = {
  signature: string;
  explorerUrl: string;
};

export type EngineCreateMarketServerContext = {
  connection: Connection;
  /** Server treasury (Omnipair bootstrap / pmAMM authority). */
  payer: Keypair;
  slug: string;
  rowId: string;
  /** ISO expiry written to DB */
  expiryIso: string;
  title: string;
};

export type EngineCreateMarketResult =
  | {
      ok: true;
      engine: MarketEngine;
      yesMint: PublicKey;
      noMint: PublicKey;
      /** GAMM: pair PDA; PM_AMM: market PDA */
      poolOrMarket: PublicKey;
      primarySignature: string;
      mintYesTx: string | null;
      mintNoTx: string | null;
      poolInitTx: string | null;
      seedLiquidityTx: string | null;
      programId: string;
      usdcMint: string;
      pmammMarketId?: string;
    }
  | { ok: false; error: string };

import { getMint } from "@solana/spl-token";

import {
  getSparkUsdMint,
  SPARK_USD_DECIMALS,
  tryGetSparkUsdMintRawFromEnv,
} from "@/lib/config/spark-usd";
import { getConnection } from "@/lib/solana/connection";
import {
  loadEffectiveMarketAuthoritySigner,
  loadSparkUsdMintAuthority,
} from "@/lib/solana/treasury";

function normalizeCollapsedMintEnv(): void {
  const raw = tryGetSparkUsdMintRawFromEnv();
  const spark = process.env.SPARK_USD_MINT?.trim();
  const pmamm = process.env.PMAMM_COLLATERAL_MINT?.trim();
  const pub = process.env.NEXT_PUBLIC_COLLATERAL_MINT?.trim();
  const legacy = process.env.NEXT_PUBLIC_PMAMM_USDC_MINT?.trim();
  const keys = [spark, pmamm, pub, legacy].filter(Boolean) as string[];
  const uniq = new Set(keys);
  if (uniq.size > 1) {
    throw new Error(
      `SparkUSD mint env mismatch: SPARK_USD_MINT, PMAMM_COLLATERAL_MINT, NEXT_PUBLIC_COLLATERAL_MINT / NEXT_PUBLIC_PMAMM_USDC_MINT must all match when set. Got: ${[...uniq].join(", ")}`,
    );
  }
  if (!raw) {
    throw new Error(
      "Set SPARK_USD_MINT and NEXT_PUBLIC_COLLATERAL_MINT (same pubkey) for SparkUSD collateral.",
    );
  }
}

/**
 * Development-only: verify SparkUSD env and mint on RPC (decimals, mint authority for faucet).
 */
export async function assertSparkUsdDevBoot(): Promise<void> {
  if (process.env.NODE_ENV !== "development") return;

  normalizeCollapsedMintEnv();
  const mintPk = getSparkUsdMint();
  const payer = loadSparkUsdMintAuthority();

  const engineSet = Boolean(process.env.MARKET_ENGINE_AUTHORITY_SECRET?.trim());
  if (!engineSet) {
    console.warn(
      "[predicted][authority-fallback] MARKET_ENGINE_AUTHORITY_SECRET is unset — in development, effective authority may come from TRUSTED_RESOLVER_SECRET or SPARK_USD_MINT_AUTHORITY_SECRET.",
    );
  }

  if (!payer) {
    throw new Error(
      "SparkUSD faucet / minting: set MARKET_ENGINE_AUTHORITY_SECRET or TRUSTED_RESOLVER_SECRET (with TRUSTED_RESOLVER_ADDRESS), or SPARK_USD_MINT_AUTHORITY_SECRET matching the on-chain mint authority.",
    );
  }

  const eff = loadEffectiveMarketAuthoritySigner();
  if (eff?.source === "trusted_resolver" && !engineSet) {
    console.warn(
      "[predicted][authority-fallback] Using TRUSTED_RESOLVER_SECRET as effective market authority in development.",
    );
  }

  const connection = getConnection();
  const info = await getMint(connection, mintPk, "confirmed");
  if (info.decimals !== SPARK_USD_DECIMALS) {
    throw new Error(
      `SparkUSD mint ${mintPk.toBase58()} must have ${SPARK_USD_DECIMALS} decimals; got ${info.decimals}.`,
    );
  }
  if (
    info.mintAuthority !== null &&
    !info.mintAuthority.equals(payer.publicKey)
  ) {
    throw new Error(
      `SparkUSD mint authority on-chain (${info.mintAuthority?.toBase58()}) does not match faucet signer (${payer.publicKey.toBase58()}). Use SPARK_USD_MINT_AUTHORITY_SECRET or set mint authority to the same wallet as MARKET_ENGINE_AUTHORITY_SECRET / TRUSTED_RESOLVER_SECRET.`,
    );
  }
  if (info.mintAuthority === null) {
    throw new Error(
      `SparkUSD mint ${mintPk.toBase58()} has no mint authority — faucet cannot mint.`,
    );
  }

  console.log("[predicted][spark-usd-boot] ok", {
    mint: mintPk.toBase58(),
    decimals: info.decimals,
    mintAuthority: payer.publicKey.toBase58(),
  });
}

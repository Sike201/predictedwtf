/**
 * Create SparkUSD (6-decimal SPL) mint for Predicted dev/test collateral.
 *
 * Payer priority:
 * 1. SPARK_USD_PAYER_SECRET
 * 2. MARKET_ENGINE_AUTHORITY_SECRET
 * 3. TRUSTED_RESOLVER_SECRET (non-production only; requires TRUSTED_RESOLVER_ADDRESS match in dev)
 *
 * Usage:
 *   npx tsx scripts/create-spark-usd-mint.ts
 *
 * Output: copy `SPARK_USD_MINT` and public vars into `.env.local`.
 */
import { createMint } from "@solana/spl-token";
import bs58 from "bs58";
import { Connection, Keypair } from "@solana/web3.js";

import { getSolanaRpcUrl } from "../lib/solana/rpc-url";
import { loadEffectiveMarketAuthoritySigner } from "../lib/solana/treasury";

function parseKeypair(raw: string): Keypair {
  if (raw.startsWith("[")) {
    const arr = JSON.parse(raw) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  }
  return Keypair.fromSecretKey(bs58.decode(raw));
}

function loadPayerWithLoggedSource(): Keypair {
  const payerRaw = process.env.SPARK_USD_PAYER_SECRET?.trim();
  if (payerRaw) {
    console.log("[spark-usd-mint] using payer source: spark_usd_payer_secret");
    return parseKeypair(payerRaw);
  }

  const eff = loadEffectiveMarketAuthoritySigner();
  if (eff) {
    console.log(
      `[spark-usd-mint] using authority source: ${eff.source}`,
    );
    return eff.signer;
  }

  throw new Error(
    "Set SPARK_USD_PAYER_SECRET, MARKET_ENGINE_AUTHORITY_SECRET, or TRUSTED_RESOLVER_SECRET (with TRUSTED_RESOLVER_ADDRESS) for a funded keypair. In production, only the first two apply.",
  );
}

function loadMintAuthorityOr(payer: Keypair): Keypair {
  const raw = process.env.SPARK_USD_MINT_AUTHORITY_SECRET?.trim();
  if (!raw) return payer;
  return parseKeypair(raw);
}

async function main() {
  const payer = loadPayerWithLoggedSource();
  const mintAuthority = loadMintAuthorityOr(payer);
  const freezeAuthority = null;

  const connection = new Connection(getSolanaRpcUrl(), "confirmed");

  console.log("Creating SparkUSD mint (6 decimals)…");
  console.log("Payer / fee payer:", payer.publicKey.toBase58());
  console.log("Mint authority:", mintAuthority.publicKey.toBase58());
  console.log("Freeze authority: null\n");

  const mint = await createMint(
    connection,
    payer,
    mintAuthority.publicKey,
    freezeAuthority,
    6,
  );

  const mintStr = mint.toBase58();
  console.log("--- Copy into .env.local ---\n");
  console.log(`SPARK_USD_MINT=${mintStr}`);
  console.log(`SPARK_USD_DECIMALS=6`);
  console.log(`SPARK_USD_SYMBOL=SPKUSD`);
  console.log(`SPARK_USD_DISPLAY_NAME=SparkUSD`);
  console.log(`PMAMM_COLLATERAL_MINT=${mintStr}`);
  console.log(`NEXT_PUBLIC_COLLATERAL_MINT=${mintStr}`);
  console.log(`NEXT_PUBLIC_COLLATERAL_SYMBOL=SPKUSD`);
  console.log(`NEXT_PUBLIC_COLLATERAL_DISPLAY_NAME=SparkUSD`);
  console.log(
    `# Deprecated alias (keep in sync if tooling still reads it):\n# NEXT_PUBLIC_PMAMM_USDC_MINT=${mintStr}`,
  );
  console.log(
    "\nFund the mint authority ATA / use faucet after deploying claim API.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

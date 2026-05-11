/**
 * Static checks for SparkUSD migration (no RPC).
 * Run: npx tsx scripts/verify-spark-usd.ts
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

import {
  LEGACY_DEVNET_USDC_COLLATERAL_MINT,
  tryGetSparkUsdMintRawFromEnv,
} from "../lib/config/spark-usd";
import {
  SPARK_USD_FAUCET_CLAIM_AMOUNT_ATOMS,
  utcDateStringYmd,
} from "../lib/spark-usd/faucet";

const LEGACY = LEGACY_DEVNET_USDC_COLLATERAL_MINT;
const ROOT = join(__dirname, "..");

function walk(dir: string, acc: string[]) {
  for (const name of readdirSync(dir)) {
    if (
      name === "node_modules" ||
      name === ".next" ||
      name === "target" ||
      name === "test-ledger"
    ) {
      continue;
    }
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(tsx?|jsx?|md|json)$/.test(name)) acc.push(p);
  }
}

function main() {
  const envMint = tryGetSparkUsdMintRawFromEnv();
  if (!envMint) {
    console.warn(
      "[verify-spark-usd] SPARK_USD_MINT / NEXT_PUBLIC_COLLATERAL_MINT not set in this shell — skipping mint match checks.",
    );
  } else if (envMint === LEGACY) {
    throw new Error(
      "Configured SparkUSD mint still equals legacy devnet USDC — create a new mint with scripts/create-spark-usd-mint.ts",
    );
  }

  if (SPARK_USD_FAUCET_CLAIM_AMOUNT_ATOMS !== 1_000_000_000n) {
    throw new Error("Faucet claim atoms should be 1000 * 10^6");
  }
  const d = utcDateStringYmd(new Date("2026-05-11T12:00:00Z"));
  if (d !== "2026-05-11") {
    throw new Error(`utcDateStringYmd broken: got ${d}`);
  }

  const files: string[] = [];
  walk(join(ROOT, "lib"), files);
  walk(join(ROOT, "app"), files);
  walk(join(ROOT, "components"), files);
  walk(join(ROOT, "scripts"), files);

  const offenders: string[] = [];
  for (const file of files) {
    if (file.includes("lib/config/spark-usd.ts")) continue;
    const txt = readFileSync(file, "utf8");
    if (txt.includes(LEGACY)) {
      offenders.push(file);
    }
  }

  if (offenders.length) {
    throw new Error(
      `Legacy collateral mint string still present in:\n${offenders.join("\n")}`,
    );
  }

  console.log("[verify-spark-usd] ok");
}

main();

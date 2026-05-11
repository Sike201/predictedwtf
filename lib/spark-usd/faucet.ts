import { SPARK_USD_DECIMALS } from "@/lib/config/spark-usd";

/** Max SparkUSD human amount claimable per wallet per UTC day. */
export const SPARK_USD_DAILY_CLAIM_CAP_HUMAN = 1000;

/** Atoms minted per successful claim (default full daily cap in one claim). */
export const SPARK_USD_FAUCET_CLAIM_AMOUNT_HUMAN = 1000;

const pow = 10n ** BigInt(SPARK_USD_DECIMALS);

export function sparkUsdHumanToAtoms(human: number): bigint {
  if (!Number.isFinite(human) || human <= 0) return 0n;
  return BigInt(Math.round(human * Number(pow)));
}

export const SPARK_USD_FAUCET_CLAIM_AMOUNT_ATOMS = sparkUsdHumanToAtoms(
  SPARK_USD_FAUCET_CLAIM_AMOUNT_HUMAN,
);

export function utcDateStringYmd(d: Date = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export const SPARK_USD_CLAIM_PENDING_SIG = "pending";

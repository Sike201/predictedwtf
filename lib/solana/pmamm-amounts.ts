/** pm-AMM outcome mints use 6 decimals (matches collateral). */
export const PMAMM_OUTCOME_DECIMALS = 6;

export function parsePmammOutcomeHumanToAtoms(amountHuman: string): bigint {
  const cleaned = amountHuman.replace(/[^0-9.]/g, "");
  if (!cleaned || cleaned === ".") return 0n;
  const [wholeRaw, fracRaw = ""] = cleaned.split(".");
  const whole = wholeRaw || "0";
  const fracPadded = (fracRaw + "0".repeat(PMAMM_OUTCOME_DECIMALS)).slice(
    0,
    PMAMM_OUTCOME_DECIMALS,
  );
  return (
    BigInt(whole) * 10n ** BigInt(PMAMM_OUTCOME_DECIMALS) +
    BigInt(fracPadded || "0")
  );
}

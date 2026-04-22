import { MINT_POSITIONS_USDC_DECIMALS } from "@/lib/solana/mint-market-positions";
import { OUTCOME_MINT_DECIMALS } from "@/lib/solana/create-outcome-mints";

/**
 * Full formula (all amounts in on-chain "atoms"):
 *
 * 1) Pick the **debt token** for the close direction (matches `omnipair-close-leverage`):
 *    - `closeDirection === "yes"`  → debt token is **NO**  (repay `debtNo` from the user's NO ATA).
 *    - `closeDirection === "no"`  → debt token is **YES** (repay `debtYes` from the user's YES ATA).
 *
 * 2) **Outcome-token shortfall** (same 9-dp base units as the mint):
 *    `tokenShortfallAtoms = max(0, debtTokenOwedAtoms − debtTokenInWalletAtoms)`
 *
 * 3) **USDC to send through the paired mint** (USDC 6-dp; mint maps USDC → outcome via `usdcBaseUnitsToOutcomeBaseUnits`):
 *    - Let `D = 10 ** (OUTCOME_MINT_DECIMALS − MINT_POSITIONS_USDC_DECIMALS)`  (= 1_000: each 1e-6 USDC unit mints 1e3 units on each 9-dp leg).
 *    - `minUsdcBaseUnits = ceilDiv(tokenShortfallAtoms, D)`
 *    so that `minUsdcBaseUnits * D >= tokenShortfallAtoms` and the **debt leg** of the new mint
 *    covers the missing amount (YES and NO are minted equally; we size USDC to cover the **short** leg only).
 *
 * 4) **Rounding**: ceiling at **1 micro-USDC** (6-dp) steps — not a 1:1 "USDC = dollar debt"; it is
 *    the **minimum number of 6-dp USDC units** such that the engine mint produces **enough** of the
 *    debt token when paired. Human display: `minUsdcHuman = minUsdcBaseUnits / 1e6`.
 *
 * This is *not* "you owe 13.65 USDC to the pool as debt" — it is "you must route **at least** this much
 * USDC through the **USDC → YES+NO** mint to source enough of the **outcome** token to repay.
 */
const OUTCOME_PER_USDC_EXP =
  BigInt(OUTCOME_MINT_DECIMALS) - BigInt(MINT_POSITIONS_USDC_DECIMALS);

/** `10^3`: one USDC micro-unit (1e-6) → 1e3 9-dp outcome atoms on each leg of the pair mint. */
export const OUTCOME_ATOMS_PER_USDC_BASE_UNIT = 10n ** OUTCOME_PER_USDC_EXP;

function ceilDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) return a;
  return (a + b - 1n) / b;
}

/**
 * YES-track close: repays `debtNo` from user's NO ATA (`noBal` in close builder) before remove_collateral.
 * Shortfall = additional NO atoms needed in wallet: `debtNo - noBal` when positive.
 */
export function shortfallNoAtomsForYesTrackClose(
  debtNoAtoms: bigint,
  noWalletAtoms: bigint,
): bigint {
  if (debtNoAtoms <= 0n) return 0n;
  return debtNoAtoms > noWalletAtoms ? debtNoAtoms - noWalletAtoms : 0n;
}

/**
 * NO-track close: repays `debtYes` from user's YES ATA (`yesBal` in close builder).
 */
export function shortfallYesAtomsForNoTrackClose(
  debtYesAtoms: bigint,
  yesWalletAtoms: bigint,
): bigint {
  if (debtYesAtoms <= 0n) return 0n;
  return debtYesAtoms > yesWalletAtoms ? debtYesAtoms - yesWalletAtoms : 0n;
}

export type CloseDirection = "yes" | "no";

export function debtTokenShortfallForClose(
  which: CloseDirection,
  args: {
    debtYesAtoms: bigint;
    debtNoAtoms: bigint;
    yesWalletAtoms: bigint;
    noWalletAtoms: bigint;
  },
): { shortfall: bigint; debtToken: "yes" | "no" } {
  if (which === "yes") {
    return {
      shortfall: shortfallNoAtomsForYesTrackClose(
        args.debtNoAtoms,
        args.noWalletAtoms,
      ),
      debtToken: "no",
    };
  }
  return {
    shortfall: shortfallYesAtomsForNoTrackClose(
      args.debtYesAtoms,
      args.yesWalletAtoms,
    ),
    debtToken: "yes",
  };
}

/**
 * Smallest `usdcAmountAtoms` such that
 * `usdcBaseUnitsToOutcomeBaseUnits(usdcAmountAtoms) >= shortfall` for paired mint
 * (each leg gets the same `outcomeMintAtoms`).
 */
export function minUsdcBaseUnitsToCoverOutcomeShortfall(
  shortfallOutcomeAtoms: bigint,
): bigint {
  if (shortfallOutcomeAtoms <= 0n) return 0n;
  return ceilDiv(shortfallOutcomeAtoms, 10n ** OUTCOME_PER_USDC_EXP);
}

/** Snapshot for UI/logging: debt leg vs wallet vs minimum paired-mint USDC. */
export type DebtBridgeShortfallDetails = {
  closeDirection: CloseDirection;
  debtToken: "yes" | "no";
  /** Atoms of the debt token the position owes (9 dp). */
  debtTokenOwedAtoms: bigint;
  /** Atoms in the user’s wallet ATA for that debt token. */
  debtTokenWalletAtoms: bigint;
  /** = max(0, owed − wallet); same as `debtTokenShortfallForClose().shortfall`. */
  tokenShortfallOutcomeAtoms: bigint;
  minUsdcBaseUnits: bigint;
  /** = `10^(OUTCOME_MINT_DECIMALS − MINT_POSITIONS_USDC_DECIMALS)` (1_000 in typical devnet). */
  ceilingDivisor: bigint;
};

export function buildDebtBridgeShortfallDetails(
  which: CloseDirection,
  input: {
    debtYesAtoms: bigint;
    debtNoAtoms: bigint;
    yesWalletAtoms: bigint;
    noWalletAtoms: bigint;
  },
): DebtBridgeShortfallDetails {
  const { shortfall, debtToken } = debtTokenShortfallForClose(which, input);
  const debtOwed =
    debtToken === "yes" ? input.debtYesAtoms : input.debtNoAtoms;
  const wallet =
    debtToken === "yes" ? input.yesWalletAtoms : input.noWalletAtoms;
  return {
    closeDirection: which,
    debtToken,
    debtTokenOwedAtoms: debtOwed,
    debtTokenWalletAtoms: wallet,
    tokenShortfallOutcomeAtoms: shortfall,
    minUsdcBaseUnits: minUsdcBaseUnitsToCoverOutcomeShortfall(shortfall),
    ceilingDivisor: 10n ** OUTCOME_PER_USDC_EXP,
  };
}

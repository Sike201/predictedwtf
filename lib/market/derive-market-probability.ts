/**
 * Single source of truth for YES/NO spot display from Omnipair reserve vault balances.
 *
 * Uses **raw token atoms** (same units on both sides for outcome SPL mints). Do not mix in
 * pair-account `token0Decimals` / `token1Decimals` here — on devnet those have been observed
 * to mismatch and skew ratios (e.g. showing 100% YES with equal raw vault balances).
 */

export type DerivedMarketProbability = {
  /** yesPrice — same as implied P(YES) for this MVP mid. */
  yesProbability: number;
  /** noPrice — same as implied P(NO). */
  noProbability: number;
  yesProbabilityBps: number;
  noProbabilityBps: number;
};

/** True when exactly one side has zero liquidity and the other does not. */
export function isOneSidedLiquidity(state: {
  reserveYes: bigint;
  reserveNo: bigint;
}): boolean {
  if (state.reserveYes === 0n && state.reserveNo === 0n) return false;
  return state.reserveYes === 0n || state.reserveNo === 0n;
}

/**
 * YES/NO pool spot from reserves (raw atoms):
 * - yesPrice = reserveNo / (reserveYes + reserveNo)
 * - noPrice = reserveYes / (reserveYes + reserveNo)
 */
export function computeYesNoSpotFromRawReserves(
  reserveYes: bigint,
  reserveNo: bigint,
): DerivedMarketProbability | null {
  if (reserveYes === 0n && reserveNo === 0n) return null;

  if (reserveYes === reserveNo) {
    return {
      yesProbability: 0.5,
      noProbability: 0.5,
      yesProbabilityBps: 5000,
      noProbabilityBps: 5000,
    };
  }

  const sum = reserveYes + reserveNo;
  const yesPrice = Number(reserveNo) / Number(sum);
  const noPrice = Number(reserveYes) / Number(sum);
  const yesBps = Math.min(10_000, Math.max(0, Math.round(yesPrice * 10_000)));
  const noBps = 10_000 - yesBps;

  return {
    yesProbability: yesPrice,
    noProbability: noPrice,
    yesProbabilityBps: yesBps,
    noProbabilityBps: noBps,
  };
}

export function deriveMarketProbabilityFromPoolState(
  state: Pick<{ reserveYes: bigint; reserveNo: bigint }, "reserveYes" | "reserveNo">,
): DerivedMarketProbability | null {
  return computeYesNoSpotFromRawReserves(state.reserveYes, state.reserveNo);
}

/**
 * Sanity: equal raw reserves ⇒ 50/50 (used by dev debug panel).
 */
export function verifyFiftyFiftyWhenEqualRawReserves(): boolean {
  const d = computeYesNoSpotFromRawReserves(100_000_000_000n, 100_000_000_000n);
  if (!d) return false;
  return (
    Math.abs(d.yesProbability - 0.5) < 1e-12 &&
    Math.abs(d.noProbability - 0.5) < 1e-12
  );
}

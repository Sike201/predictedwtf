import type { DecodedOmnipairPair } from "@/lib/solana/decode-omnipair-accounts";

/** Matches `BPS_DENOMINATOR` in omnipair-rs `constants.rs`. */
export const OMNIPAIR_BPS = 10_000n;

export function ceilDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error("ceilDiv: divisor zero");
  return (a + b - 1n) / b;
}

/**
 * Mirrors `Swap::handle_swap` + `CPCurve::calculate_amount_out` in
 * `programs/omnipair/src/instructions/spot/swap.rs` for quote / min-out.
 */
export function estimateOmnipairSwapAmountOut(params: {
  pair: DecodedOmnipairPair;
  /** `futarchy_authority.revenue_share.swap_bps` — futarchy share of the swap fee. */
  futarchySwapShareBps: number;
  amountIn: bigint;
  /** True if swapping token0 → token1. */
  isToken0In: boolean;
}): bigint {
  const { pair, futarchySwapShareBps, amountIn, isToken0In } = params;
  if (amountIn <= 0n) return 0n;

  const swapFee = ceilDiv(
    amountIn * BigInt(pair.swapFeeBps),
    OMNIPAIR_BPS,
  );
  const futarchyFee = ceilDiv(
    swapFee * BigInt(futarchySwapShareBps),
    OMNIPAIR_BPS,
  );
  const amountInAfterSwapFee = amountIn - swapFee;

  const reserveIn = isToken0In ? pair.reserve0 : pair.reserve1;
  const reserveOut = isToken0In ? pair.reserve1 : pair.reserve0;

  const denominator = reserveIn + amountInAfterSwapFee;
  if (denominator === 0n) return 0n;

  return (amountInAfterSwapFee * reserveOut) / denominator;
}

/** Min receive after `slippageBps` (e.g. 100 = 1%). */
export function applySlippageFloor(amountOut: bigint, slippageBps: number): bigint {
  if (slippageBps <= 0 || slippageBps >= 10_000) return amountOut;
  return (amountOut * BigInt(10_000 - slippageBps)) / OMNIPAIR_BPS;
}

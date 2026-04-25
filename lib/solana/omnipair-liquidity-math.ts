import { ceilDiv, OMNIPAIR_BPS } from "@/lib/solana/omnipair-swap-math";

/** `LIQUIDITY_WITHDRAWAL_FEE_BPS` in omnipair-rs `constants.rs` (1%). */
export const OMNIPAIR_LIQUIDITY_WITHDRAWAL_FEE_BPS = 100;

/**
 * Proportional LP minted from add_liquidity (min of the two leg quotients, matches on-chain intension).
 * Uses virtual reserves and total LP supply from the pair + LP mint.
 */
export function estimateLiquidityOutFromAdd(params: {
  reserve0: bigint;
  reserve1: bigint;
  totalSupplyLp: bigint;
  amount0In: bigint;
  amount1In: bigint;
}): bigint {
  const { reserve0, reserve1, totalSupplyLp, amount0In, amount1In } = params;
  if (
    reserve0 <= 0n ||
    reserve1 <= 0n ||
    totalSupplyLp <= 0n ||
    amount0In <= 0n ||
    amount1In <= 0n
  ) {
    return 0n;
  }
  const l0 = (amount0In * totalSupplyLp) / reserve0;
  const l1 = (amount1In * totalSupplyLp) / reserve1;
  return l0 < l1 ? l0 : l1;
}

/**
 * min_liquidity_out with slippage (floor) — `slippageBps` 100 = 1%.
 */
export function applyAddLiquiditySlippageFloor(
  liquidityOut: bigint,
  slippageBps: number,
): bigint {
  if (liquidityOut <= 0n) return 0n;
  if (slippageBps <= 0 || slippageBps >= 10_000) return liquidityOut;
  return (liquidityOut * BigInt(10_000 - slippageBps)) / OMNIPAIR_BPS;
}

/** Gross token amounts before withdrawal fee. */
export function estimateRemoveLiquidityGrossOut(params: {
  reserve0: bigint;
  reserve1: bigint;
  totalSupplyLp: bigint;
  liquidityIn: bigint;
}): { amount0: bigint; amount1: bigint } {
  const { reserve0, reserve1, totalSupplyLp, liquidityIn } = params;
  if (liquidityIn <= 0n || totalSupplyLp <= 0n) {
    return { amount0: 0n, amount1: 0n };
  }
  const a0 = (liquidityIn * reserve0) / totalSupplyLp;
  const a1 = (liquidityIn * reserve1) / totalSupplyLp;
  return { amount0: a0, amount1: a1 };
}

/** Net out after 1% protocol withdrawal fee to remaining LPs. */
export function applyLiquidityWithdrawalFee(
  amountGross: bigint,
  feeBps: number = OMNIPAIR_LIQUIDITY_WITHDRAWAL_FEE_BPS,
): { fee: bigint; out: bigint } {
  if (amountGross <= 0n) return { fee: 0n, out: 0n };
  const fee = Number(feeBps) > 0 ? ceilDiv(amountGross * BigInt(feeBps), OMNIPAIR_BPS) : 0n;
  const out = amountGross - fee;
  return { fee, out: out < 0n ? 0n : out };
}

/**
 * min_amount{0,1}_out after fee + slippage (floor) for remove_liquidity.
 */
export function estimateRemoveMinOuts(params: {
  reserve0: bigint;
  reserve1: bigint;
  totalSupplyLp: bigint;
  liquidityIn: bigint;
  slippageBps: number;
}): { min0: bigint; min1: bigint } {
  const g = estimateRemoveLiquidityGrossOut(params);
  const f0 = applyLiquidityWithdrawalFee(g.amount0);
  const f1 = applyLiquidityWithdrawalFee(g.amount1);
  if (params.slippageBps <= 0 || params.slippageBps >= 10_000) {
    return { min0: f0.out, min1: f1.out };
  }
  const s = BigInt(10_000 - params.slippageBps);
  return {
    min0: (f0.out * s) / OMNIPAIR_BPS,
    min1: (f1.out * s) / OMNIPAIR_BPS,
  };
}

/**
 * Notional USDC (UI) for the outcome pool from YES/NO reserves and mid prices.
 * Uses 1:1 full-set / mint mapping: token fair value in USD is proxied as yes*p_yes + no*p_no in “dollar” units.
 */
export function estimatePoolLiquidityUsdHint(params: {
  reserveYesAtoms: bigint;
  reserveNoAtoms: bigint;
  /** 0..1, YES token implied price */
  yesProbability: number;
}): number {
  const pYes =
    Number.isFinite(params.yesProbability) && params.yesProbability >= 0
      ? Math.min(1, Math.max(0, params.yesProbability))
      : 0.5;
  const pNo = 1 - pYes;
  const dec = 9;
  const scale = 10 ** dec;
  const y = Number(params.reserveYesAtoms) / scale;
  const n = Number(params.reserveNoAtoms) / scale;
  if (!Number.isFinite(y) || !Number.isFinite(n)) return 0;
  const tvl = y * pYes + n * pNo;
  return Number.isFinite(tvl) && tvl >= 0 ? tvl : 0;
}

/**
 * Effective bps of swap notional that accrues to LPs (swap fee net of futarchy share).
 * Mirrors `Swap::handle_swap` fee split.
 */
export function effectiveLpShareOfSwapFeeBps(params: {
  swapFeeBps: number;
  futarchySwapShareBps: number;
}): number {
  const sf = params.swapFeeBps;
  const fs = params.futarchySwapShareBps;
  if (sf <= 0) return 0;
  if (fs <= 0) return Math.min(10_000, sf);
  const futarchy = Math.min(fs, 10_000);
  // swapFee to futarchy: ceil(swapFee * fs / 1e4) — for APR use rational approx.
  return Math.max(0, (sf * (10_000 - futarchy)) / 10_000);
}

/**
 * Annualized % estimate from 24h volume: (vol24h * effectiveFeeBps/1e4 * 365) / liquidityUsd.
 * Returns null when inputs are non-positive.
 */
export function estimateFeeAprFromVolume(params: {
  /** USD */
  volume24hUsd: number;
  /** USD — TVL proxy */
  liquidityUsd: number;
  /** Swap fee bps (pair) */
  swapFeeBps: number;
  /** Protocol share of swap fee (futarchy) */
  futarchySwapShareBps: number;
}): number | null {
  const { volume24hUsd, liquidityUsd, swapFeeBps, futarchySwapShareBps } =
    params;
  if (
    !Number.isFinite(volume24hUsd) ||
    !Number.isFinite(liquidityUsd) ||
    volume24hUsd <= 0 ||
    liquidityUsd <= 0
  ) {
    return null;
  }
  const eff = effectiveLpShareOfSwapFeeBps({ swapFeeBps, futarchySwapShareBps });
  if (eff <= 0) return 0;
  const apr = ((volume24hUsd * (eff / 10_000)) * 365) / liquidityUsd;
  return Number.isFinite(apr) ? apr : null;
}

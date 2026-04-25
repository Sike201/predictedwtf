import { parseUsdcHumanToBaseUnits } from "@/lib/solana/mint-market-positions";
import { PMAMM_DEFAULT_INITIAL_LIQUIDITY_USDC_HUMAN } from "@/lib/solana/pmamm-config";

/** Aligns with buy-outcome cap — absurdly large strings are rejected. */
export const PMAMM_INITIAL_LIQUIDITY_USDC_MAX_ATOMS = 10_000_000_000_000n;

export type ParsedPmammInitialLiquidity =
  | { ok: true; atoms: bigint; humanForLog: string }
  | { ok: false; error: string };

/**
 * Parses pmAMM initial liquidity (6-decimal USDC) for create-market.
 * Empty / omitted input defaults to {@link PMAMM_DEFAULT_INITIAL_LIQUIDITY_USDC_HUMAN}.
 */
export function parsePmammInitialLiquidityUsdcInput(
  raw: string | undefined,
): ParsedPmammInitialLiquidity {
  const human = raw?.trim() || PMAMM_DEFAULT_INITIAL_LIQUIDITY_USDC_HUMAN;
  const atoms = parseUsdcHumanToBaseUnits(human);
  if (atoms <= 0n) {
    return {
      ok: false,
      error: "Initial liquidity must be greater than zero.",
    };
  }
  if (atoms > PMAMM_INITIAL_LIQUIDITY_USDC_MAX_ATOMS) {
    return {
      ok: false,
      error: "Initial liquidity amount exceeds the allowed maximum.",
    };
  }
  return { ok: true, atoms, humanForLog: human };
}

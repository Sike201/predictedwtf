/**
 * Repair `market_price_history` for one market from on-chain pair signatures (post-tx vault state).
 *
 *   npx tsx scripts/backfill-chart-history.ts <market-slug>
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const slug = process.argv[2]?.trim();
  if (!slug) {
    console.error("Usage: npx tsx scripts/backfill-chart-history.ts <market-slug>");
    process.exit(1);
  }

  const { backfillMarketPriceHistoryFromOnchainActivity } = await import(
    "../lib/market/backfill-market-price-history",
  );

  const result = await backfillMarketPriceHistoryFromOnchainActivity({
    slug,
    limit: 100,
  });

  if (!result.ok) {
    console.error("[backfill-chart-history]", result.error);
    process.exit(1);
  }

  console.info("[backfill-chart-history] done", result);
  process.exit(0);
}

void main();

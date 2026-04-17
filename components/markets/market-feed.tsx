"use client";

import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { filterFeedMarkets } from "@/lib/data/filter-markets";
import { MarketCard } from "@/components/markets/market-card";
import { CategoryFilterBar } from "@/components/markets/category-filter-bar";
import type { Market } from "@/lib/types/market";
import type { MarketCategoryKey, MarketSortKey } from "@/lib/types/market";

type MarketFeedProps = {
  /** Supabase `live` markets (see `fetchLiveMarketsForFeed`). */
  initialMarkets: Market[];
};

export function MarketFeed({ initialMarkets }: MarketFeedProps) {
  const [sort, setSort] = useState<MarketSortKey>("trending");
  const [category, setCategory] = useState<MarketCategoryKey>("all");

  const list = useMemo(
    () => filterFeedMarkets(initialMarkets, sort, category),
    [initialMarkets, sort, category],
  );

  return (
    <div className="bg-black px-3 pb-24 pt-4 sm:px-4 lg:px-6">
      <div className="mx-auto max-w-[1920px]">
        <motion.div
          className="mb-5 border-b border-white/[0.04] pb-4"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <CategoryFilterBar
            sort={sort}
            category={category}
            onSortChange={setSort}
            onCategoryChange={setCategory}
          />
        </motion.div>

        <motion.div
          className="grid grid-cols-1 gap-3 min-[560px]:grid-cols-2 xl:grid-cols-4"
          initial="hidden"
          animate="show"
          variants={{
            hidden: { opacity: 0 },
            show: {
              opacity: 1,
              transition: {
                staggerChildren: 0.055,
                delayChildren: 0.08,
                ease: [0.16, 1, 0.3, 1],
              },
            },
          }}
        >
          {list.map((m) => (
            <motion.div
              key={m.id}
              variants={{
                hidden: { opacity: 0, y: 18, filter: "blur(6px)" },
                show: {
                  opacity: 1,
                  y: 0,
                  filter: "blur(0px)",
                  transition: { duration: 0.52, ease: [0.16, 1, 0.3, 1] },
                },
              }}
            >
              <MarketCard market={m} />
            </motion.div>
          ))}
        </motion.div>

        {list.length === 0 && (
          <p className="py-16 text-center text-sm text-zinc-500">
            No markets in this category yet.
          </p>
        )}
      </div>
    </div>
  );
}

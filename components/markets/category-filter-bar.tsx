"use client";

import type { LucideIcon } from "lucide-react";
import { Flame, Sparkles, Clock3 } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils/cn";
import {
  FILTER_PRIMARY,
  FILTER_CATEGORIES,
} from "@/lib/constants/market-filters";
import type { MarketCategoryKey, MarketSortKey } from "@/lib/types/market";

const PRIMARY_ICON: Record<MarketSortKey, LucideIcon> = {
  trending: Flame,
  new: Sparkles,
  "ending-soon": Clock3,
};

type CategoryFilterBarProps = {
  sort: MarketSortKey;
  category: MarketCategoryKey;
  onSortChange: (sort: MarketSortKey) => void;
  onCategoryChange: (category: MarketCategoryKey) => void;
};

export function CategoryFilterBar({
  sort,
  category,
  onSortChange,
  onCategoryChange,
}: CategoryFilterBarProps) {
  return (
    <div className="scrollbar-thin w-full overflow-x-auto py-1 pb-2">
      <div className="mx-auto flex w-max max-w-none flex-nowrap items-center justify-center gap-x-1.5 px-2 sm:gap-x-2">
        {FILTER_PRIMARY.map(({ key, label }) => {
          const Icon = PRIMARY_ICON[key];
          const isActive = sort === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSortChange(key)}
              className={cn(
                "inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-[14px] font-medium transition-colors sm:px-3.5 sm:text-[15px]",
                isActive
                  ? "bg-white/[0.14] text-white ring-1 ring-inset ring-white/25"
                  : "text-zinc-500 hover:text-zinc-300",
              )}
            >
              {Icon && (
                <Icon className="h-4 w-4 shrink-0 opacity-80 sm:h-[17px] sm:w-[17px]" />
              )}
              {label}
            </button>
          );
        })}

        <span
          className="mx-1 h-5 w-px shrink-0 bg-white/15 sm:mx-2"
          aria-hidden
        />

        {FILTER_CATEGORIES.map(({ key, label }) => {
          const isActive = category === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onCategoryChange(key)}
              className={cn(
                "relative shrink-0 px-2 pb-1.5 text-[14px] font-medium transition-colors sm:px-2.5 sm:text-[15px]",
                isActive ? "text-white" : "text-zinc-500 hover:text-zinc-400",
              )}
            >
              {label}
              {isActive && (
                <motion.span
                  layoutId="cat-underline"
                  className="absolute bottom-0 left-1.5 right-1.5 h-[2px] rounded-full bg-white sm:left-2 sm:right-2"
                  transition={{ type: "spring", stiffness: 400, damping: 35 }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

"use client";

import { cn } from "@/lib/utils/cn";

const TIERS = [1, 2, 3] as const;

type Props = {
  value: (typeof TIERS)[number];
  onChange: (t: (typeof TIERS)[number]) => void;
  disabled?: boolean;
};

export function LeverageTierChips({ value, onChange, disabled }: Props) {
  return (
    <div className="flex items-center justify-center gap-1.5">
      {TIERS.map((t) => (
        <button
          key={t}
          type="button"
          disabled={disabled}
          onClick={() => onChange(t)}
          className={cn(
            "min-w-[44px] rounded-full px-2.5 py-1.5 text-[12px] font-semibold tabular-nums transition",
            value === t
              ? "bg-white text-black"
              : "bg-white/[0.06] text-zinc-500 hover:bg-white/[0.1] hover:text-zinc-300",
            "disabled:cursor-not-allowed disabled:opacity-40",
          )}
        >
          {t}×
        </button>
      ))}
    </div>
  );
}

"use client";

import { cn } from "@/lib/utils/cn";

export function fmtUsdCompactVol(n: unknown): string {
  const x =
    typeof n === "number" && Number.isFinite(n)
      ? Math.max(0, n)
      : typeof n === "string"
        ? Math.max(0, Number.parseFloat(n) || 0)
        : 0;
  if (!Number.isFinite(x)) return "$0";
  if (x >= 1_000_000) return `$${(x / 1_000_000).toFixed(1)}M`;
  if (x >= 1_000) return `$${(x / 1_000).toFixed(1)}K`;
  return x.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

type Props = {
  /** USD notional */
  value: number;
  /** Trailing label (e.g. ` vol` on cards, ` Vol.` in headers). */
  suffix?: string;
  /** Mute the suffix (feed cards); inherit parent color when false (detail header). */
  suffixMuted?: boolean;
  className?: string;
};

/**
 * Volume display (no animation — avoids stale/blank frames during prop updates).
 */
export function AnimatedVolume({
  value,
  suffix = " vol",
  suffixMuted = true,
  className,
}: Props) {
  const display = Number.isFinite(value) ? Math.max(0, value) : 0;
  const label = fmtUsdCompactVol(display);

  return (
    <span className={cn("tabular-nums", className)}>
      {label}
      <span className={suffixMuted ? "text-zinc-600" : undefined}>{suffix}</span>
    </span>
  );
}

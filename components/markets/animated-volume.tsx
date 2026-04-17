"use client";

import { animate } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils/cn";

export function fmtUsdCompactVol(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-US", {
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
 * Subtle count-up when aggregated volume updates (on-chain totals).
 */
export function AnimatedVolume({
  value,
  suffix = " vol",
  suffixMuted = true,
  className,
}: Props) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef<number | null>(null);

  useEffect(() => {
    const from = fromRef.current ?? 0;
    fromRef.current = value;
    const ctrl = animate(from, value, {
      duration: 0.75,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => setDisplay(Math.max(0, latest)),
    });
    return () => ctrl.stop();
  }, [value]);

  return (
    <span className={cn("tabular-nums", className)}>
      {fmtUsdCompactVol(display)}
      <span className={suffixMuted ? "text-zinc-600" : undefined}>{suffix}</span>
    </span>
  );
}

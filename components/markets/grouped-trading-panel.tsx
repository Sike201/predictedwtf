"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Vertical rhythm for grouped event sidebar: outcome picker → trade rail.
 */
export function GroupedTradingPanel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {children}
    </div>
  );
}

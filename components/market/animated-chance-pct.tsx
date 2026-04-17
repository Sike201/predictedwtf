"use client";

import { animate } from "framer-motion";
import { useEffect, useRef, useState } from "react";

type Props = {
  value: number | null;
};

/**
 * Smooth count when YES% updates (load, live pool refresh, range changes).
 */
export function AnimatedChancePct({ value }: Props) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef<number | null>(null);

  useEffect(() => {
    if (value == null) {
      fromRef.current = null;
      return;
    }
    const from = fromRef.current ?? 0;
    fromRef.current = value;
    const ctrl = animate(from, value, {
      duration: 0.55,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => setDisplay(Math.round(latest)),
    });
    return () => ctrl.stop();
  }, [value]);

  if (value == null) {
    return <span>—</span>;
  }

  return (
    <span className="tabular-nums">
      {display}
      <span className="inline">%</span>
    </span>
  );
}

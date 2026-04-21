"use client";

import { motion } from "framer-motion";
import { useCallback, useMemo, useState, type MouseEvent } from "react";
import { stepAfterLinePath } from "@/lib/chart/monotone-cubic-path";
import {
  evenTimeTicks,
  stepPriceAfterAtT,
  type ChartPathPoint,
} from "@/lib/chart/time-series-path";
import { cn } from "@/lib/utils/cn";

type Point = { t: number; p: number };

export type ProbabilityChartProps = {
  series: Point[];
  /** Visible time window — line and axis use this domain (rolling 24h for 1D, etc.). */
  xDomain: { minT: number; maxT: number };
  /** Number of x-axis labels (evenly spaced in time). */
  xTickCount?: number;
  className?: string;
  /** When this changes, the line stroke re-draws (e.g. history load, range, live tick). */
  drawEpoch?: string;
};

/** ViewBox width; height tuned for a taller chart. */
const w = 1000;
const h = 280;
const padL = 12;
const padR = 48;
const padT = 8;
const padB = 28;

function formatTickLabel(t: number, spanMs: number, tickIndex: number, tickCount: number): string {
  const isLast = tickIndex === tickCount - 1;
  if (isLast && spanMs <= 35 * 24 * 60 * 60 * 1000) {
    const skew = Math.abs(Date.now() - t);
    if (skew < 120_000) return "Now";
  }
  if (spanMs <= 6 * 60 * 60 * 1000) {
    return new Date(t).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  if (spanMs <= 72 * 60 * 60 * 1000) {
    return new Date(t).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return new Date(t).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

export function ProbabilityChart({
  series,
  xDomain,
  xTickCount = 5,
  className,
  drawEpoch = "default",
}: ProbabilityChartProps) {
  const [hover, setHover] = useState<{
    svgX: number;
    t: number;
    p: number;
    clientX: number;
    clientY: number;
  } | null>(null);

  const pathSeries: ChartPathPoint[] = useMemo(() => {
    return [...series].sort((a, b) => a.t - b.t);
  }, [series]);

  const domain = useMemo(() => {
    const span = xDomain.maxT - xDomain.minT;
    if (!Number.isFinite(span) || span <= 0) return null;
    return { minT: xDomain.minT, maxT: xDomain.maxT, span };
  }, [xDomain.minT, xDomain.maxT]);

  const xScale = useMemo(() => {
    if (!domain) return null;
    const plotW = w - padL - padR;
    return (t: number) => padL + ((t - domain.minT) / domain.span) * plotW;
  }, [domain]);

  const invX = useCallback(
    (svgX: number): number | null => {
      if (!domain) return null;
      const plotW = w - padL - padR;
      const clamped = Math.max(padL, Math.min(w - padR, svgX));
      return domain.minT + ((clamped - padL) / plotW) * domain.span;
    },
    [domain],
  );

  const yScale = (p: number) => padT + (1 - p) * (h - padT - padB);

  const screenPts = useMemo(() => {
    if (!xScale) return [];
    return pathSeries.map((pt) => ({ x: xScale(pt.t), y: yScale(pt.p) }));
  }, [pathSeries, xScale]);

  const linePath = useMemo(() => {
    if (pathSeries.length < 2 || !xScale) return "";
    return stepAfterLinePath(screenPts);
  }, [pathSeries.length, screenPts, xScale]);

  const areaPath = useMemo(() => {
    if (pathSeries.length < 2 || !linePath || !domain || !xScale) return "";
    const x0 = xScale(domain.minT);
    const x1 = xScale(domain.maxT);
    return `${linePath} L ${x1} ${h - padB} L ${x0} ${h - padB} Z`;
  }, [linePath, domain, xScale, pathSeries.length]);

  const yTicks = [0, 0.25, 0.5, 0.75, 1];

  const xTicks = useMemo(() => {
    if (!domain || !xScale) return [];
    const n = Math.max(2, Math.min(8, xTickCount));
    const times = evenTimeTicks(domain.minT, domain.maxT, n);
    return times.map((t) => ({ t, x: xScale(t) }));
  }, [domain, xScale, xTickCount]);

  const onSvgMouseMove = useCallback(
    (e: MouseEvent<SVGRectElement>) => {
      const svg = e.currentTarget.ownerSVGElement;
      if (!svg || !domain) return;
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const cursor = pt.matrixTransform(ctm.inverse());
      const clampedX = Math.max(padL, Math.min(w - padR, cursor.x));
      const tHover = invX(clampedX);
      if (tHover == null) return;
      const pHover = stepPriceAfterAtT(pathSeries, tHover);
      setHover({
        svgX: clampedX,
        t: tHover,
        p: pHover,
        clientX: e.clientX,
        clientY: e.clientY,
      });
    },
    [domain, invX, pathSeries],
  );

  if (!series.length || !domain || !xScale) {
    return (
      <div
        className={cn(
          "flex min-h-[200px] items-center justify-center text-[13px] text-zinc-500",
          className,
        )}
      >
        No chart data
      </div>
    );
  }

  const spanMs = domain.span;
  const tickCount = xTicks.length;

  return (
    <div className={cn("relative", className)}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-[240px] w-full sm:h-[260px]"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="probFillWhite" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.18)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </linearGradient>
        </defs>
        {yTicks.map((p) => (
          <g key={p}>
            <line
              x1={padL}
              y1={yScale(p)}
              x2={w - padR}
              y2={yScale(p)}
              stroke="rgba(255,255,255,0.05)"
              strokeWidth="1"
            />
            <text
              x={w - padR + 4}
              y={yScale(p) + 3}
              fill="rgba(255,255,255,0.38)"
              fontSize="10"
            >
              {Math.round(p * 100)}%
            </text>
          </g>
        ))}
        {areaPath ? (
          <motion.path
            key={`area-${drawEpoch}`}
            d={areaPath}
            fill="url(#probFillWhite)"
            initial={{ opacity: 0.35 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          />
        ) : null}
        {linePath ? (
          <motion.path
            key={`line-${drawEpoch}`}
            d={linePath}
            fill="none"
            stroke="rgb(255 255 255)"
            strokeWidth="1.75"
            strokeLinecap="butt"
            strokeLinejoin="miter"
            vectorEffect="non-scaling-stroke"
            initial={{ opacity: 0.35 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          />
        ) : null}
        {xTicks.map((tick, idx) => (
          <text
            key={`${tick.t}-${idx}`}
            x={tick.x}
            y={h - 8}
            textAnchor={
              idx === 0 ? "start" : idx === xTicks.length - 1 ? "end" : "middle"
            }
            fill="rgba(255,255,255,0.32)"
            fontSize="10"
          >
            {formatTickLabel(tick.t, spanMs, idx, tickCount)}
          </text>
        ))}
        <rect
          x={padL}
          y={padT}
          width={w - padL - padR}
          height={h - padT - padB}
          fill="transparent"
          onMouseMove={onSvgMouseMove}
          onMouseLeave={() => setHover(null)}
        />
        {hover ? (
          <>
            <line
              x1={hover.svgX}
              y1={padT}
              x2={hover.svgX}
              y2={h - padB}
              stroke="rgba(255,255,255,0.14)"
              strokeWidth="1"
            />
            <circle
              cx={hover.svgX}
              cy={yScale(hover.p)}
              r="3.5"
              fill="white"
            />
          </>
        ) : null}
      </svg>
      {hover ? (
        <div
          className="pointer-events-none fixed z-20 max-w-[200px] rounded-md bg-zinc-950/95 px-2.5 py-1.5 text-[10px] text-zinc-200 shadow-lg ring-1 ring-white/[0.08]"
          style={{
            left: Math.max(
              8,
              Math.min(
                hover.clientX + 14,
                (typeof window !== "undefined" ? window.innerWidth : 9999) - 140,
              ),
            ),
            top: Math.max(
              8,
              Math.min(
                hover.clientY + 14,
                (typeof window !== "undefined" ? window.innerHeight : 9999) - 56,
              ),
            ),
          }}
        >
          <div className="tabular-nums text-zinc-500">
            {new Date(hover.t).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              second: spanMs <= 6 * 60 * 60 * 1000 ? "2-digit" : undefined,
            })}
          </div>
          <div className="mt-0.5 font-semibold tabular-nums text-white">
            {Math.round(hover.p * 100)}%
          </div>
        </div>
      ) : null}
    </div>
  );
}

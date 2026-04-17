"use client";

import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { chartLinePathFromScreenPoints } from "@/lib/chart/monotone-cubic-path";
import { cn } from "@/lib/utils/cn";

type Point = { t: number; p: number };

type ProbabilityChartProps = {
  series: Point[];
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

export function ProbabilityChart({
  series,
  className,
  drawEpoch = "default",
}: ProbabilityChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const domain = useMemo(() => {
    if (series.length < 2) return null;
    return {
      minT: series[0].t,
      maxT: series[series.length - 1].t,
    };
  }, [series]);

  const xScale = useMemo(() => {
    if (!domain) return null;
    const span = domain.maxT - domain.minT || 1;
    return (t: number) =>
      padL + ((t - domain.minT) / span) * (w - padL - padR);
  }, [domain]);

  const yScale = (p: number) => padT + (1 - p) * (h - padT - padB);

  const screenPts = useMemo(() => {
    if (series.length === 1) {
      const p = series[0]!;
      const cx = (padL + w - padR) / 2;
      return [{ x: cx, y: yScale(p.p) }];
    }
    if (!xScale) return [];
    return series.map((pt) => ({ x: xScale(pt.t), y: yScale(pt.p) }));
  }, [series, xScale]);

  const linePath = useMemo(() => {
    if (series.length < 2 || !domain || !xScale) return "";
    return chartLinePathFromScreenPoints(screenPts);
  }, [series.length, domain, xScale, screenPts]);

  const areaPath = useMemo(() => {
    if (series.length < 2 || !linePath || !domain || !xScale) return "";
    const xf = xScale;
    const x0 = xf(domain.minT);
    const x1 = xf(domain.maxT);
    return `${linePath} L ${x1} ${h - padB} L ${x0} ${h - padB} Z`;
  }, [linePath, domain, xScale, series.length]);

  const single = series.length === 1 ? series[0] : null;
  const singleX = (padL + w - padR) / 2;
  const singleY = single ? yScale(single.p) : 0;

  const hovered = hoverIdx != null ? series[hoverIdx] : null;

  /** Nearest screen point on curve for hover dot (snap to real snapshots). */
  const hoverScreen =
    hoverIdx != null && screenPts[hoverIdx]
      ? screenPts[hoverIdx]
      : null;

  const yTicks = [0, 0.25, 0.5, 0.75, 1];

  const xTicks = useMemo(() => {
    if (series.length < 2 || !domain || !xScale) return [];
    return [0, 1 / 3, 2 / 3, 1].map((f) => {
      const t = domain.minT + (domain.maxT - domain.minT) * f;
      return { t, x: xScale(t) };
    });
  }, [series.length, domain, xScale]);

  if (!series.length) {
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
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            initial={{ opacity: 0.35 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          />
        ) : null}
        {single ? (
          <circle
            cx={singleX}
            cy={singleY}
            r="4"
            fill="white"
            stroke="rgba(0,0,0,0.25)"
            strokeWidth="1"
          />
        ) : null}
        {xTicks.map((tick, idx) => (
          <text
            key={idx}
            x={tick.x}
            y={h - 8}
            textAnchor={
              idx === 0 ? "start" : idx === xTicks.length - 1 ? "end" : "middle"
            }
            fill="rgba(255,255,255,0.32)"
            fontSize="10"
          >
            {new Date(tick.t).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })}
          </text>
        ))}
        <rect
          x={padL}
          y={padT}
          width={w - padL - padR}
          height={h - padT - padB}
          fill="transparent"
          onMouseMove={(e) => {
            const svg = e.currentTarget.ownerSVGElement;
            if (!svg) return;
            const pt = svg.createSVGPoint();
            pt.x = e.clientX;
            pt.y = e.clientY;
            const cursor = pt.matrixTransform(svg.getScreenCTM()?.inverse());
            const clampedX = Math.max(padL, Math.min(w - padR, cursor.x));
            if (series.length === 1) {
              setHoverIdx(0);
              return;
            }
            const ratio = (clampedX - padL) / (w - padL - padR);
            const idx = Math.round(ratio * (series.length - 1));
            setHoverIdx(Math.max(0, Math.min(series.length - 1, idx)));
          }}
          onMouseLeave={() => setHoverIdx(null)}
        />
        {hovered && hoverScreen ? (
          <>
            <line
              x1={hoverScreen.x}
              y1={padT}
              x2={hoverScreen.x}
              y2={h - padB}
              stroke="rgba(255,255,255,0.1)"
              strokeWidth="1"
            />
            <circle
              cx={hoverScreen.x}
              cy={hoverScreen.y}
              r="3.5"
              fill="white"
            />
          </>
        ) : null}
      </svg>
      {hovered ? (
        <div className="pointer-events-none absolute left-2 top-2 rounded-md bg-zinc-950/90 px-2 py-1 text-[10px] text-zinc-200 shadow-sm ring-1 ring-white/[0.06]">
          <div className="text-zinc-500">
            {new Date(hovered.t).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </div>
          <div className="font-semibold tabular-nums text-white">
            {Math.round(hovered.p * 100)}%
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Build plot points for a fixed [startMs, endMs] x-domain so the line spans the full
 * visible window (hold previous price to the left edge; live pool price at endMs).
 *
 * Pass only persisted / anchor trade points in `points`. Do not include a synthetic
 * "live now" sample — that would sit at endMs and collapse the last real trade into
 * the right edge; instead `endPrice` is applied at `endMs` after the last trade time.
 */
export type ChartPathPoint = { t: number; p: number };

export function buildPathSeriesForTimeDomain(params: {
  /** Anchor + in-window trades (no synthetic live tail at `endMs`) */
  points: ChartPathPoint[];
  startMs: number;
  endMs: number;
  /** YES price at endMs when extending the tail */
  endPrice: number;
}): ChartPathPoint[] {
  const { points, startMs, endMs, endPrice } = params;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return [];
  }

  const sorted = [...points]
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.p))
    .sort((a, b) => a.t - b.t);

  if (sorted.length === 0) {
    return [
      { t: startMs, p: endPrice },
      { t: endMs, p: endPrice },
    ];
  }

  const relevant = sorted.filter((p) => p.t <= endMs);
  if (relevant.length === 0) {
    return [
      { t: startMs, p: endPrice },
      { t: endMs, p: endPrice },
    ];
  }

  const strictlyBefore = relevant.filter((p) => p.t < startMs);
  const lastBefore = strictlyBefore[strictlyBefore.length - 1];
  const strictlyInside = relevant.filter((p) => p.t >= startMs && p.t < endMs);

  const leftP =
    lastBefore?.p ??
    strictlyInside[0]?.p ??
    relevant[relevant.length - 1]!.p;

  const out: ChartPathPoint[] = [{ t: startMs, p: leftP }];
  for (const p of strictlyInside) {
    const prev = out[out.length - 1]!;
    if (p.t < prev.t) continue;
    if (p.t === prev.t) {
      out[out.length - 1] = { t: p.t, p: p.p };
      continue;
    }
    out.push({ t: p.t, p: p.p });
  }

  const last = out[out.length - 1]!;
  if (last.t < endMs) {
    out.push({ t: endMs, p: endPrice });
  }

  return dedupePathPoints(out);
}

function dedupePathPoints(pts: ChartPathPoint[]): ChartPathPoint[] {
  const r: ChartPathPoint[] = [];
  for (const p of pts) {
    const prev = r[r.length - 1];
    if (prev && prev.t === p.t) {
      r[r.length - 1] = p;
    } else {
      r.push(p);
    }
  }
  return r;
}

/** Piecewise-linear YES price at time t (series sorted by t). */
export function interpolatePriceAtT(
  series: ChartPathPoint[],
  t: number,
): number {
  if (series.length === 0) return 0;
  if (t <= series[0]!.t) return series[0]!.p;
  const last = series[series.length - 1]!;
  if (t >= last.t) return last.p;
  let i = 0;
  while (i < series.length - 1 && series[i + 1]!.t < t) i++;
  const a = series[i]!;
  const b = series[i + 1]!;
  const span = b.t - a.t;
  if (span <= 0) return b.p;
  const u = (t - a.t) / span;
  return a.p + u * (b.p - a.p);
}

/** Step-after: hold the last knot’s price at or before t (matches stepped line chart). */
export function stepPriceAfterAtT(series: ChartPathPoint[], t: number): number {
  if (series.length === 0) return 0;
  const s = [...series].sort((a, b) => a.t - b.t);
  if (t < s[0]!.t) return s[0]!.p;
  const last = s[s.length - 1]!;
  if (t >= last.t) return last.p;
  let out = s[0]!.p;
  for (const p of s) {
    if (p.t <= t) out = p.p;
    else break;
  }
  return out;
}

/** Evenly spaced tick times in [minT, maxT] inclusive of endpoints. */
export function evenTimeTicks(minT: number, maxT: number, count: number): number[] {
  if (count < 2 || maxT <= minT) return [minT, maxT];
  const ticks: number[] = [];
  for (let i = 0; i < count; i++) {
    ticks.push(minT + ((maxT - minT) * i) / (count - 1));
  }
  return ticks;
}

export function xAxisTickCountForRange(
  range: "1H" | "6H" | "1D" | "1W" | "1M" | "ALL",
  spanMs: number,
): number {
  void spanMs;
  if (range === "1H") return 5;
  if (range === "6H") return 5;
  if (range === "1D") return 5;
  if (range === "1W") return 6;
  if (range === "1M") return 5;
  if (spanMs <= 60 * 60 * 1000) return 5;
  if (spanMs <= 6 * 60 * 60 * 1000) return 5;
  if (spanMs <= 48 * 60 * 60 * 1000) return 5;
  if (spanMs <= 10 * 24 * 60 * 60 * 1000) return 6;
  if (spanMs <= 45 * 24 * 60 * 60 * 1000) return 5;
  return 6;
}

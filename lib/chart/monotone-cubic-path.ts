/**
 * SVG path builders for time-series charts. Visual only — does not add data points.
 *
 * - Two points: straight segment.
 * - Three or more: monotone cubic (PCHIP-style tangents) — smooth at knots while
 *   preserving monotonicity per segment (no backward bends between consecutive knots).
 */

export type ScreenPt = { x: number; y: number };

/** Polyline through knots — guaranteed no spline overshoot. */
export function linearLinePath(pts: ScreenPt[]): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i += 1) {
    d += ` L ${pts[i].x} ${pts[i].y}`;
  }
  return d;
}

/**
 * Step-after (post): hold prior y until the next x, then jump vertically.
 * Horizontal segments between trades; vertical segments at price changes.
 */
export function stepAfterLinePath(pts: ScreenPt[]): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i += 1) {
    const prev = pts[i - 1]!;
    const cur = pts[i]!;
    if (cur.x !== prev.x) {
      d += ` L ${cur.x} ${prev.y}`;
    }
    d += ` L ${cur.x} ${cur.y}`;
  }
  return d;
}

/**
 * Monotone piecewise cubic (Fritsch–Carlson tangents), converted to cubic Bézier
 * segments. x must be strictly increasing (time axis).
 */
export function monotoneCubicLinePath(pts: ScreenPt[]): string {
  if (pts.length < 2) return "";
  if (pts.length === 2) {
    return linearLinePath(pts);
  }

  const n = pts.length;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);

  const h: number[] = [];
  const delta: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const hi = xs[i + 1] - xs[i];
    if (hi <= 0) {
      return linearLinePath(pts);
    }
    h.push(hi);
    delta.push((ys[i + 1] - ys[i]) / hi);
  }

  const m = new Array<number>(n).fill(0);
  m[0] = delta[0]!;
  m[n - 1] = delta[n - 2]!;

  for (let i = 1; i < n - 1; i += 1) {
    const d0 = delta[i - 1]!;
    const d1 = delta[i]!;
    if (d0 === 0 || d1 === 0 || d0 * d1 < 0) {
      m[i] = 0;
    } else {
      const w1 = 2 * h[i]! + h[i - 1]!;
      const w2 = h[i]! + 2 * h[i - 1]!;
      m[i] = (w1 + w2) / (w1 / d0 + w2 / d1);
    }
  }

  let d = `M ${xs[0]} ${ys[0]}`;
  for (let i = 0; i < n - 1; i += 1) {
    const x0 = xs[i]!;
    const x1 = xs[i + 1]!;
    const y0 = ys[i]!;
    const y1 = ys[i + 1]!;
    const hseg = h[i]!;
    const cp1x = x0 + hseg / 3;
    const cp1y = y0 + (m[i]! * hseg) / 3;
    const cp2x = x1 - hseg / 3;
    const cp2y = y1 - (m[i + 1]! * hseg) / 3;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x1} ${y1}`;
  }
  return d;
}

/**
 * Two points → straight segment. Three or more → monotone cubic (smooth at knots,
 * no overshoot / backward bends from Catmull–Rom).
 */
export function chartLinePathFromScreenPoints(pts: ScreenPt[]): string {
  if (pts.length < 2) return "";
  if (pts.length === 2) {
    return linearLinePath(pts);
  }
  return monotoneCubicLinePath(pts);
}

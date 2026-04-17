const KEY = (marketId: string) => `predicted.leverageTarget.${marketId}`;

/** After a successful outcome leverage open, persist the preview multiple for “Opened at ~X×”. */
export function persistLeverageTargetAtOpen(marketId: string, multiple: number): void {
  if (typeof window === "undefined") return;
  try {
    if (!Number.isFinite(multiple) || multiple <= 0) return;
    sessionStorage.setItem(KEY(marketId), multiple.toFixed(2));
  } catch {
    /* ignore quota / private mode */
  }
}

export function readLeverageTargetAtOpen(marketId: string): number | null {
  if (typeof window === "undefined") return null;
  try {
    const v = sessionStorage.getItem(KEY(marketId));
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

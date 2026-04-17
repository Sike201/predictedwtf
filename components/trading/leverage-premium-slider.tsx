"use client";

import { cn } from "@/lib/utils/cn";
import type { LeverageUiTier } from "@/lib/market/adaptive-leverage-cap";

const UI_MAX_TIER = 3 as const;

type Props = {
  value: LeverageUiTier;
  onChange: (tier: LeverageUiTier) => void;
  /** Per UX contract: disable 2× only if max leverage is materially below 2× (e.g. &lt; 1.75). */
  tier2Enabled: boolean;
  /** Disable 3× only if max leverage is materially below 3× (e.g. &lt; 2.75). */
  tier3Enabled: boolean;
  disabled?: boolean;
  loading?: boolean;
};

const STEPS: LeverageUiTier[] = [1, 2, 3];

/**
 * Discrete 1×–3× control: always three steps; individual tiers may be disabled by pool cap.
 */
export function LeveragePremiumSlider({
  value,
  onChange,
  tier2Enabled,
  tier3Enabled,
  disabled,
  loading,
}: Props) {
  const stepAllowed = (step: LeverageUiTier) =>
    step === 1 || (step === 2 && tier2Enabled) || (step === 3 && tier3Enabled);

  const effectiveMax = UI_MAX_TIER;
  const rawClamped = (Math.min(value, effectiveMax) || 1) as LeverageUiTier;
  const clamped = stepAllowed(rawClamped)
    ? rawClamped
    : tier2Enabled
      ? (2 as LeverageUiTier)
      : (1 as LeverageUiTier);

  const canInteract = !disabled && !loading;

  const pct =
    effectiveMax <= 1 ? 0 : ((clamped - 1) / (effectiveMax - 1)) * 100;

  const tryChange = (tier: LeverageUiTier) => {
    if (!stepAllowed(tier) || !canInteract) return;
    onChange(tier);
  };

  return (
    <div
      className={cn(
        "relative w-full pt-1",
        !canInteract && "pointer-events-none opacity-60",
      )}
    >
      <div className="relative h-10 w-full">
        <div
          className="absolute left-[28px] right-[28px] top-[17px] h-[5px] rounded-full bg-zinc-800/90"
          aria-hidden
        />
        <div className="absolute inset-x-0 top-[9px] flex justify-between px-[22px]">
          {STEPS.map((step) => {
            const allowed = stepAllowed(step);
            const active = clamped === step;
            return (
              <button
                key={step}
                type="button"
                tabIndex={-1}
                aria-hidden
                disabled={!allowed || !canInteract}
                onClick={() => tryChange(step)}
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full transition",
                  !allowed && "bg-zinc-800/80",
                  allowed && !active && "bg-zinc-600/90",
                  allowed &&
                    active &&
                    "bg-emerald-500/90 shadow-[0_0_10px_-2px_rgba(34,197,94,0.55)]",
                )}
              />
            );
          })}
        </div>

        <div
          className="pointer-events-none absolute top-1.5 w-[56px] -translate-x-1/2 transition-[left] duration-150 ease-out"
          style={{
            left:
              effectiveMax <= 1
                ? "28px"
                : `calc(28px + (100% - 56px) * ${pct / 100})`,
          }}
        >
          <div
            className={cn(
              "flex h-7 w-[52px] select-none items-center justify-center rounded-full border border-white/[0.08] bg-zinc-900/95 text-[11px] font-semibold tabular-nums text-zinc-100 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06),0_4px_14px_-4px_rgba(0,0,0,0.75)]",
              loading && "animate-pulse",
            )}
          >
            {clamped}×
          </div>
        </div>

        <input
          type="range"
          aria-label="Leverage"
          className={cn(
            "absolute inset-0 z-[1] h-10 w-full cursor-pointer opacity-0",
            !canInteract && "cursor-not-allowed",
          )}
          min={1}
          max={effectiveMax}
          step={1}
          value={clamped}
          disabled={!canInteract}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (v !== 1 && v !== 2 && v !== 3) return;
            tryChange(v as LeverageUiTier);
          }}
        />
      </div>
    </div>
  );
}

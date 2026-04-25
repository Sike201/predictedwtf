import { cn } from "@/lib/utils/cn";

/** Island / input fill — slightly above page (#070707) */
export const defiWellBg = "bg-[#101012]";

/**
 * Omnipair-style outline: inset lighting + hairline + drop (no CSS border).
 */
export const defiWellOutlineShadow =
  "shadow-[inset_0_1px_1px_rgba(255,255,255,0.045),inset_0_-10px_22px_rgba(0,0,0,0.28),0_0_0_1px_rgba(255,255,255,0.045),0_12px_32px_rgba(0,0,0,0.35)]";

const wellShadow = defiWellOutlineShadow;

const wellShadowFocus =
  "focus:shadow-[inset_0_1px_1px_rgba(255,255,255,0.045),inset_0_-10px_22px_rgba(0,0,0,0.28),0_0_0_1px_rgba(0,255,120,0.18),0_0_24px_rgba(0,255,120,0.08),0_12px_32px_rgba(0,0,0,0.35)]";

const wellShadowFocusVisible =
  "focus-visible:shadow-[inset_0_1px_1px_rgba(255,255,255,0.045),inset_0_-10px_22px_rgba(0,0,0,0.28),0_0_0_1px_rgba(0,255,120,0.18),0_0_24px_rgba(0,255,120,0.08),0_12px_32px_rgba(0,0,0,0.35)]";

const inputChrome =
  "border-0 outline-none ring-0 focus:outline-none focus-visible:outline-none";

const inputTransition =
  "transition-[box-shadow,background-color] duration-200";

/**
 * Stat cards, section shells, claim panels — compact rounded islands.
 */
export const defiWellPanel = cn(
  defiWellBg,
  wellShadow,
  "rounded-xl",
);

/**
 * Compact search / filter bar (not a large floating pill).
 */
export const defiWellInputPill = cn(
  defiWellBg,
  wellShadow,
  "rounded-xl",
  inputChrome,
  inputTransition,
  wellShadowFocus,
  wellShadowFocusVisible,
);

/**
 * Amount fields, text areas.
 */
export const defiWellInputBox = cn(
  defiWellBg,
  wellShadow,
  "rounded-xl sm:rounded-2xl",
  inputChrome,
  inputTransition,
  wellShadowFocus,
  wellShadowFocusVisible,
);

/**
 * Thumbnail / avatar holders inside rows.
 */
export const defiWellThumb = cn(
  "bg-[#0D0D0F]",
  wellShadow,
  "overflow-hidden rounded-lg",
);

/**
 * Full-width secondary CTA (e.g. withdraw confirm).
 */
export const defiWellButtonSecondary = cn(
  defiWellBg,
  wellShadow,
  "rounded-xl sm:rounded-2xl",
  "border-0 outline-none transition-[filter] hover:brightness-110 active:brightness-95 disabled:opacity-50",
);

/**
 * Dense list row — same outline, hover brighten.
 */
export const defiWellIslandRow = cn(
  defiWellBg,
  wellShadow,
  "rounded-xl transition-[background-color,box-shadow] duration-200 hover:bg-[#131316]",
);

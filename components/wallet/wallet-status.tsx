"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, LayoutDashboard, LogOut } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "@/lib/hooks/use-wallet";
import { shortAddress } from "@/lib/utils/short-address";
import { cn } from "@/lib/utils/cn";

type WalletStatusProps = {
  className?: string;
};

export function WalletStatus({ className }: WalletStatusProps) {
  const { publicKey, disconnect } = useWallet();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const el = rootRef.current;
      if (el && !el.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!publicKey) return null;

  const full = publicKey.toBase58();
  const display = shortAddress(full);

  return (
    <div
      ref={rootRef}
      className={cn("relative z-50 inline-flex shrink-0", className)}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls="wallet-account-menu"
        id="wallet-account-trigger"
        onClick={() => setOpen((v) => !v)}
        title={full}
        className={cn(
          "inline-flex h-8 max-w-full min-w-0 items-center gap-1.5 rounded-full px-3.5",
          "bg-white text-[11px] font-medium text-[#0a0a0c] shadow-none",
          "ring-1 ring-black/[0.06] transition-colors",
          "hover:bg-zinc-100 hover:ring-black/[0.08]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:ring-offset-2 focus-visible:ring-offset-black",
          open && "bg-zinc-100 ring-black/[0.1]",
        )}
      >
        <span className="min-w-0 truncate font-mono tabular-nums sm:text-[12px]">
          {display}
        </span>
        <ChevronDown
          strokeWidth={2.25}
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform duration-200",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            id="wallet-account-menu"
            role="menu"
            aria-labelledby="wallet-account-trigger"
            initial={{ opacity: 0, scale: 0.96, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -6 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "absolute right-0 top-[calc(100%+6px)] z-50",
              "w-[min(14rem,calc(100vw-1rem))]",
              "rounded-xl border border-white/[0.08] bg-[#111] py-1 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.85)] ring-1 ring-white/[0.06]",
            )}
            style={{ transformOrigin: "top right" }}
          >
            <Link
              href="/portfolio"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] font-medium text-zinc-200 transition-colors hover:bg-white/[0.07]"
            >
              <LayoutDashboard
                className="h-4 w-4 shrink-0 text-zinc-500"
                strokeWidth={2}
                aria-hidden
              />
              Positions
            </Link>
            <div className="mx-2 my-1 h-px bg-white/[0.07]" role="separator" />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void disconnect();
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] font-medium text-zinc-200 transition-colors hover:bg-white/[0.07] hover:text-red-200/95"
            >
              <LogOut
                className="h-4 w-4 shrink-0 text-zinc-500"
                strokeWidth={2.25}
                aria-hidden
              />
              Disconnect
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

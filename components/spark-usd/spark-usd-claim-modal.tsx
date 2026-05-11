"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

import { SparkUsdClaimInline } from "@/components/spark-usd/spark-usd-claim-inline";
import { COLLATERAL_DISPLAY_LABEL } from "@/lib/config/spark-usd";
import { useWallet } from "@/lib/hooks/use-wallet";

type SparkUsdClaimModalProps = {
  open: boolean;
  onClose: () => void;
};

export function SparkUsdClaimModal({ open, onClose }: SparkUsdClaimModalProps) {
  const { connected } = useWallet();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="spark-usd-claim-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`Claim ${COLLATERAL_DISPLAY_LABEL}`}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            aria-label="Close"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.2 }}
            className="relative z-10 w-full max-w-md rounded-2xl bg-black p-5 shadow-2xl ring-1 ring-white/[0.06]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold tracking-tight text-white">
                  Claim USD
                </h2>
                <p className="mt-0.5 text-[12px] text-zinc-500">
                  {COLLATERAL_DISPLAY_LABEL} dev faucet (daily cap)
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
                aria-label="Close"
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>
            {!connected ? (
              <p className="text-[13px] leading-relaxed text-zinc-400">
                Connect your wallet using the control in the top right, then
                claim test {COLLATERAL_DISPLAY_LABEL} here.
              </p>
            ) : (
              <SparkUsdClaimInline bare />
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

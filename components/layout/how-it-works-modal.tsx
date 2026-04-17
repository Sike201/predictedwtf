"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

const SLIDES = [
  {
    title: "Earn from the pool",
    body: "Add liquidity to Omnipair pools and earn from trading fees. Pool APY reflects fee yield on your share of the curve.",
  },
  {
    title: "Trade outcomes",
    body: "Buy YES or NO (or date buckets) as probabilities move. Prices reflect what the market believes will resolve.",
  },
  {
    title: "Creators & volume",
    body: "Market creators earn a share of volume on their markets. Resolution is rule-based and posted on-chain after expiry.",
  },
] as const;

type HowItWorksModalProps = {
  open: boolean;
  onClose: () => void;
};

export function HowItWorksModal({ open, onClose }: HowItWorksModalProps) {
  const [slide, setSlide] = useState(0);
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

  useEffect(() => {
    if (open) setSlide(0);
  }, [open]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="how-it-works-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="How it works"
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
            className="relative z-10 flex min-h-[min(520px,85vh)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-black shadow-2xl ring-1 ring-white/[0.06]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Full-height background video on the right — flush top to bottom */}
            <video
              className="pointer-events-none absolute inset-y-0 right-0 z-0 h-full w-[min(52%,22rem)] object-cover object-center opacity-[0.42] sm:w-[min(48%,24rem)]"
              autoPlay
              muted
              playsInline
              loop
              aria-hidden
            >
              <source src="/liquidabstractlandingv1.mp4" type="video/mp4" />
            </video>
            <div
              className="pointer-events-none absolute inset-y-0 right-0 z-[1] h-full w-[min(52%,22rem) bg-gradient-to-l from-black/20 via-black/55 to-black sm:w-[min(48%,24rem)]"
              aria-hidden
            />

            <button
              type="button"
              onClick={onClose}
              className="absolute right-3 top-3 z-30 rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/[0.06] hover:text-white sm:right-4 sm:top-4"
              aria-label="Close"
            >
              <X className="h-5 w-5" strokeWidth={1.75} />
            </button>

            {/* Left column: copy flexes; bottom block pins carousel + CTA */}
            <div className="relative z-20 flex min-h-[min(520px,85vh)] flex-1 flex-col px-5 pb-6 pt-14 sm:px-8 sm:pb-8 sm:pt-16">
              <div className="max-w-lg pr-2 sm:max-w-xl sm:pr-8">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={slide}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2 }}
                  >
                    <h3 className="text-balance pr-2 text-xl font-semibold leading-tight text-white sm:text-2xl lg:text-[1.75rem]">
                      {SLIDES[slide].title}
                    </h3>
                    <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-zinc-400 sm:text-[15px]">
                      {SLIDES[slide].body}
                    </p>
                  </motion.div>
                </AnimatePresence>
              </div>

              {/* Pinned to bottom of card: dots centered, then Learn more */}
              <div className="mt-auto flex flex-col items-center gap-5 pt-10 sm:pt-12">
                <div
                  className="flex w-full justify-center gap-1.5"
                  role="tablist"
                  aria-label="Slide"
                >
                  {SLIDES.map((_, idx) => (
                    <button
                      key={idx}
                      type="button"
                      role="tab"
                      aria-selected={idx === slide}
                      aria-label={`Slide ${idx + 1}`}
                      onClick={() => setSlide(idx)}
                      className={`h-1.5 rounded-full transition-all ${
                        idx === slide
                          ? "w-6 bg-white"
                          : "w-1.5 bg-white/25 hover:bg-white/40"
                      }`}
                    />
                  ))}
                </div>
                <Link
                  href="/docs"
                  onClick={onClose}
                  className="inline-flex shrink-0 items-center justify-center self-start rounded-xl bg-white px-4 py-2.5 text-center text-[13px] font-semibold text-[#0a0a0c] transition hover:bg-zinc-200 sm:self-auto"
                >
                  Learn more
                </Link>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

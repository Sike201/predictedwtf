"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { Plus, Search } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils/cn";
import { HowItWorksModal } from "@/components/layout/how-it-works-modal";
import { WalletConnectButton } from "@/components/wallet/wallet-connect-button";
import { WalletStatus } from "@/components/wallet/wallet-status";
import { useWallet } from "@/lib/hooks/use-wallet";

type TopNavProps = {
  className?: string;
};

export function TopNav({ className }: TopNavProps) {
  const { connected } = useWallet();
  const [howOpen, setHowOpen] = useState(false);
  const [createExpanded, setCreateExpanded] = useState(false);

  return (
    <>
      <HowItWorksModal open={howOpen} onClose={() => setHowOpen(false)} />
      <header
        className={cn(
          "sticky top-0 z-30 bg-black/95 backdrop-blur-sm",
          className,
        )}
      >
        <div className="mx-auto grid h-[52px] max-w-[1920px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 lg:h-[56px] lg:px-6">
          <div className="flex min-w-0 justify-start">
            <Link
              href="/"
              className="relative block h-7 w-[120px] shrink-0 lg:h-8 lg:w-[140px]"
            >
              <Image
                src="/whitedpredictedlogo.png"
                alt="Predicted"
                fill
                className="object-contain object-left"
                priority
              />
            </Link>
          </div>

          <div className="flex min-w-0 items-center justify-center gap-3 px-1 sm:gap-4">
            <button
              type="button"
              onClick={() => setHowOpen(true)}
              className="shrink-0 border-0 bg-transparent p-0 text-left text-[12px] font-medium text-zinc-500 transition-colors hover:text-zinc-200 sm:text-[13px]"
            >
              How it works
            </button>
            <label className="trade-field group/nav-search relative flex min-h-[46px] min-w-0 flex-1 max-w-md items-center gap-2.5 pl-3.5 pr-4 py-2 ring-1 ring-white/[0.06] lg:max-w-lg">
              <span className="sr-only">Search</span>
              <Search
                className="h-[18px] w-[18px] shrink-0 text-zinc-500 transition-colors group-focus-within/nav-search:text-zinc-400"
                strokeWidth={2}
                aria-hidden
              />
              <input
                type="search"
                placeholder="Search markets"
                autoComplete="off"
                className="min-w-0 flex-1 border-0 bg-transparent py-0.5 text-[13px] font-normal text-zinc-100 placeholder:text-zinc-600 outline-none ring-0 focus:ring-0"
              />
            </label>
          </div>

          <div className="flex min-w-0 items-center justify-end gap-2">
            {/* Fixed slot so hover expansion does not resize the grid / shift the search */}
            <div className="relative h-8 w-8 shrink-0">
              <Link
                href="/create"
                aria-label="Create market"
                onMouseEnter={() => setCreateExpanded(true)}
                onMouseLeave={() => setCreateExpanded(false)}
                onFocus={() => setCreateExpanded(true)}
                onBlur={() => setCreateExpanded(false)}
                className="absolute right-0 top-1/2 z-10 flex h-8 max-w-none -translate-y-1/2 items-stretch overflow-hidden rounded-full bg-white/[0.07] text-zinc-100 ring-1 ring-inset ring-white/[0.06] transition-[background-color,box-shadow] duration-200 hover:bg-white/[0.11] hover:ring-white/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
              >
                <span className="flex w-8 shrink-0 items-center justify-center">
                  <Plus className="h-[15px] w-[15px]" strokeWidth={2.25} />
                </span>
                <motion.span
                  aria-hidden={!createExpanded}
                  initial={false}
                  animate={{
                    width: createExpanded ? 96 : 0,
                    opacity: createExpanded ? 1 : 0,
                  }}
                  transition={{
                    type: "spring",
                    stiffness: 520,
                    damping: 40,
                    mass: 0.42,
                  }}
                  className="flex min-w-0 items-center overflow-hidden"
                >
                  <span className="whitespace-nowrap pb-px pr-3 text-[11px] font-semibold tracking-tight text-zinc-50">
                    Create market
                  </span>
                </motion.span>
              </Link>
            </div>
            {connected ? (
              <WalletStatus className="justify-end" />
            ) : (
              <WalletConnectButton />
            )}
          </div>
        </div>
      </header>
    </>
  );
}

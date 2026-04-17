"use client";

import { motion } from "framer-motion";
import { LogOut } from "lucide-react";
import { useWallet } from "@/lib/hooks/use-wallet";
import { shortAddress } from "@/lib/utils/short-address";
import { cn } from "@/lib/utils/cn";

type WalletStatusProps = {
  className?: string;
};

export function WalletStatus({ className }: WalletStatusProps) {
  const { publicKey, disconnect } = useWallet();

  const full = publicKey?.toBase58() ?? "";
  const display = full ? shortAddress(full) : "";

  if (!publicKey) return null;

  return (
    <div
      className={cn(
        "flex max-w-full min-w-0 items-center gap-2",
        className,
      )}
    >
      <span
        className="min-w-0 truncate font-mono text-[11px] font-medium tabular-nums text-zinc-200 sm:text-[12px]"
        title={full}
      >
        {display}
      </span>
      <motion.button
        type="button"
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => void disconnect()}
        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-white px-3.5 text-[11px] font-medium text-[#0a0a0c] transition hover:bg-zinc-100"
      >
        <LogOut className="h-3.5 w-3.5 sm:hidden" strokeWidth={2.25} />
        <span className="hidden sm:inline">Disconnect</span>
        <span className="sm:hidden">Out</span>
      </motion.button>
    </div>
  );
}

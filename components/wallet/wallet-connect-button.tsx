"use client";

import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { cn } from "@/lib/utils/cn";

type WalletConnectButtonProps = {
  className?: string;
};

/**
 * Multi-wallet button — styles live in globals under `.predicted-wallet-connect`
 * (adapter ships purple `.wallet-adapter-button-trigger`; we override to white pill).
 */
export function WalletConnectButton({ className }: WalletConnectButtonProps) {
  return (
    <div className={cn("predicted-wallet-connect inline-flex shrink-0", className)}>
      <WalletMultiButton className="!m-0 !border-0 !bg-transparent !p-0 !shadow-none [&_.wallet-adapter-button]:!font-sans" />
    </div>
  );
}

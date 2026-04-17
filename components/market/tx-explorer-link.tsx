"use client";

import {
  devnetTxExplorerUrl,
  shortenTransactionSignature,
} from "@/lib/utils/solana-explorer";
import { cn } from "@/lib/utils/cn";

type TxExplorerLinkProps = {
  signature: string;
  className?: string;
  /** Override anchor styles (default: emerald explorer link). */
  linkClassName?: string;
};

/**
 * Short signature + external “View on Explorer” link (devnet).
 */
export function TxExplorerLink({
  signature,
  className,
  linkClassName,
}: TxExplorerLinkProps) {
  const href = devnetTxExplorerUrl(signature);
  const short = shortenTransactionSignature(signature);
  return (
    <span className={className}>
      <span className="font-mono tabular-nums text-zinc-300">{short}</span>
      {" · "}
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "text-emerald-400/95 underline decoration-emerald-500/40 underline-offset-2 hover:text-emerald-300",
          linkClassName,
        )}
      >
        View on Explorer
      </a>
    </span>
  );
}

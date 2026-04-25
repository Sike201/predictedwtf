"use client";

import { Connection } from "@solana/web3.js";
import {
  ConnectionContext,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { type ReactNode, useMemo } from "react";

import { wrapSolanaConnection } from "@/lib/solana/connection-resilient";
import { getSolanaRpcUrl } from "@/lib/solana/rpc-url";

import "@solana/wallet-adapter-react-ui/styles.css";

/** Phantom + Solflare. To add Backpack: `npm i @solana/wallet-adapter-backpack` and `new BackpackWalletAdapter()`. */

type SolanaWalletProviderProps = {
  children: ReactNode;
};

export function SolanaWalletProvider({ children }: SolanaWalletProviderProps) {
  const endpoint = useMemo(() => getSolanaRpcUrl(), []);

  const connection = useMemo(() => {
    const inner = new Connection(endpoint, { commitment: "confirmed" });
    return wrapSolanaConnection(inner, { rpcUrl: endpoint });
  }, [endpoint]);

  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  );

  return (
    <ConnectionContext.Provider value={{ connection }}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionContext.Provider>
  );
}

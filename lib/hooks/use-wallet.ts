"use client";

import { useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";

/**
 * App wrapper around the official adapter hook — use this for market flows, trading, resolvers.
 */
export function useWallet() {
  const w = useSolanaWallet();
  return {
    publicKey: w.publicKey,
    connected: w.connected,
    connecting: w.connecting,
    disconnecting: w.disconnecting,
    connect: w.connect,
    disconnect: w.disconnect,
    signTransaction: w.signTransaction,
    sendTransaction: w.sendTransaction,
    signMessage: w.signMessage,
    wallet: w.wallet,
  };
}

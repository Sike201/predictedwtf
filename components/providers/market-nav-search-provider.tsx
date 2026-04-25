"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type MarketNavSearchContextValue = {
  query: string;
  setQuery: (q: string) => void;
};

const MarketNavSearchContext =
  createContext<MarketNavSearchContextValue | null>(null);

export function MarketNavSearchProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState("");
  const value = useMemo(
    () => ({ query, setQuery }),
    [query],
  );
  return (
    <MarketNavSearchContext.Provider value={value}>
      {children}
    </MarketNavSearchContext.Provider>
  );
}

export function useMarketNavSearch() {
  const ctx = useContext(MarketNavSearchContext);
  if (!ctx) {
    throw new Error(
      "useMarketNavSearch must be used within MarketNavSearchProvider",
    );
  }
  return ctx;
}

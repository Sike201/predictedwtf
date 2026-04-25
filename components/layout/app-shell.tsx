import type { ReactNode } from "react";
import { TopNav } from "@/components/layout/top-nav";
import { ConditionalFooter } from "@/components/layout/conditional-footer";
import { MarketNavSearchProvider } from "@/components/providers/market-nav-search-provider";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <MarketNavSearchProvider>
      <div className="relative flex min-h-dvh flex-col bg-black">
        <div className="pointer-events-none fixed inset-0 bg-black" aria-hidden />
        <div
          className="pointer-events-none fixed inset-0 opacity-[0.25]"
          style={{
            backgroundImage:
              "radial-gradient(ellipse 100% 80% at 50% -40%, rgba(91, 140, 255, 0.06), transparent 55%)",
          }}
          aria-hidden
        />
        <TopNav />
        <main className="relative flex-1 overflow-x-hidden pb-2">{children}</main>
        <ConditionalFooter />
      </div>
    </MarketNavSearchProvider>
  );
}

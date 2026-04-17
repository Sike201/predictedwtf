"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils/cn";

function XLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden
      fill="currentColor"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export function VanishingFooter() {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setHidden(window.scrollY > 32);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <footer
      className={cn(
        "pointer-events-none fixed bottom-0 left-0 right-0 z-20 transition-transform duration-300 ease-out",
        hidden ? "translate-y-full" : "translate-y-0",
      )}
    >
      <div className="pointer-events-auto bg-[#0f1114]/95 px-4 py-3 backdrop-blur-md">
        <div className="mx-auto flex max-w-lg flex-wrap items-center justify-center gap-x-8 gap-y-2">
          <a
            href="https://x.com/predictedwtf"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center text-zinc-400 transition hover:text-white"
            aria-label="Predicted on X"
          >
            <XLogo className="h-5 w-5" />
          </a>
          <span className="text-[12px] text-zinc-500">
            © {new Date().getFullYear()} Predicted
          </span>
          <Link
            href="/docs"
            className="text-[12px] font-medium text-zinc-400 transition hover:text-white"
          >
            Docs
          </Link>
        </div>
      </div>
    </footer>
  );
}

"use client";

import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Search } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { cn } from "@/lib/utils/cn";

export type OutcomeDropdownOption = {
  id: string;
  label: string;
  imageUrl: string;
  /** 0–1 */
  yesProbability: number;
};

const SEARCH_MIN_OPTIONS = 8;

function pctLabel(p: number): string {
  if (!Number.isFinite(p)) return "—";
  return `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
}

export function OutcomeSelectorDropdown({
  options,
  selectedId,
  onSelect,
  className,
}: {
  options: OutcomeDropdownOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  className?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => options.find((o) => o.id === selectedId) ?? options[0] ?? null,
    [options, selectedId],
  );

  const showSearch = options.length >= SEARCH_MIN_OPTIONS;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (open && showSearch) {
      window.setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [open, showSearch]);

  const pick = useCallback(
    (id: string) => {
      onSelect(id);
      setOpen(false);
      setQuery("");
    },
    [onSelect],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    },
    [],
  );

  if (!selected) return null;

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKeyDown}
          className={cn(
          "flex w-full items-center gap-2.5 rounded-xl border border-white/[0.06] bg-[#111] px-3 py-2.5 text-left ring-1 ring-white/[0.06]",
          "transition-colors hover:border-white/[0.1] hover:bg-[#131313] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20",
          open && "border-white/[0.1] bg-[#141414]",
        )}
      >
        <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-zinc-900 ring-1 ring-white/[0.08]">
          <Image
            src={selected.imageUrl}
            alt=""
            fill
            sizes="36px"
            className="object-cover"
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
            Outcome
          </p>
          <p className="truncate text-[13px] font-semibold leading-snug text-white">
            {selected.label}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-zinc-500">
            YES
          </p>
          <p className="font-mono text-[14px] font-semibold tabular-nums text-zinc-200">
            {pctLabel(selected.yesProbability)}
          </p>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-zinc-500 transition-transform duration-200",
            open && "rotate-180 text-zinc-300",
          )}
        />
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            id={listId}
            role="listbox"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.99 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "absolute left-0 right-0 top-[calc(100%+6px)] z-40 overflow-hidden rounded-xl border border-white/[0.08] bg-[#111] shadow-xl ring-1 ring-white/[0.06]",
              showSearch ? "max-h-[min(420px,70vh)]" : "max-h-[min(340px,60vh)]",
            )}
          >
            {showSearch ? (
              <div className="border-b border-white/[0.06] p-2">
                <div className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-black/40 px-2.5 py-2">
                  <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search outcomes…"
                    className="min-w-0 flex-1 bg-transparent text-[13px] font-medium leading-snug text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
                  />
                </div>
              </div>
            ) : null}
            <div className="scrollbar-thin max-h-[min(320px,55vh)] overflow-y-auto p-1.5">
              {filtered.length === 0 ? (
                <p className="px-3 py-6 text-center text-[13px] font-medium leading-snug text-zinc-500">
                  No matches
                </p>
              ) : (
                filtered.map((o) => {
                  const active = o.id === selectedId;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => pick(o.id)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors",
                        active
                          ? "bg-white/[0.08] ring-1 ring-white/[0.06]"
                          : "hover:bg-white/[0.05]",
                      )}
                    >
                      <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-md bg-zinc-900 ring-1 ring-white/[0.06]">
                        <Image
                          src={o.imageUrl}
                          alt=""
                          fill
                          sizes="32px"
                          className="object-cover"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "truncate text-[13px] font-semibold leading-snug",
                            active ? "text-white" : "text-zinc-200",
                          )}
                        >
                          {o.label}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 font-mono text-[14px] font-semibold tabular-nums",
                          active ? "text-zinc-100" : "text-zinc-400",
                        )}
                      >
                        {pctLabel(o.yesProbability)}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

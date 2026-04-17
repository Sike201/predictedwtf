"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LayoutGroup, motion } from "framer-motion";
import { ArrowLeft, ArrowUp, Loader2, Sparkles, Upload } from "lucide-react";
import { TxExplorerLink } from "@/components/market/tx-explorer-link";
import type { MarketDraft } from "@/lib/types/market";
import type { MarketRecord } from "@/lib/types/market-record";
import { pushRecentMarketTransaction } from "@/lib/market/recent-market-transactions";
import { useWallet } from "@/lib/hooks/use-wallet";
import {
  devnetTxExplorerUrl,
  shortenTransactionSignature,
} from "@/lib/utils/solana-explorer";
import { cn } from "@/lib/utils/cn";

type ChatMsg = { role: "user" | "assistant"; text: string };

const INPUT_PLACEHOLDER =
  'e.g. "Will Anatoly Yakovenko tweet \u201coh fuck\u201d before June 2027?"';

const PREMIUM_MIN_WAIT_MS = 1100;

function CreateBackground() {
  return (
    <>
      <div className="absolute inset-0 z-0 bg-black" aria-hidden />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-[min(72%,36rem)] bg-[radial-gradient(ellipse_130%_90%_at_50%_100%,rgba(255,255,255,0.14)_0%,rgba(190,180,255,0.09)_22%,rgba(120,100,200,0.05)_40%,transparent_68%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-[45%] bg-[linear-gradient(to_top,rgba(255,255,255,0.055)_0%,rgba(200,195,255,0.04)_18%,transparent_100%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-[40%] max-h-[280px] bg-[linear-gradient(to_bottom,rgba(0,0,0,0.55)_0%,transparent_100%)]"
        aria-hidden
      />
    </>
  );
}

function PremiumThinking() {
  return (
    <div className="flex justify-start">
      <motion.div
        initial={{ opacity: 0, scale: 0.94, filter: "blur(6px)" }}
        animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
        transition={{ type: "spring", stiffness: 420, damping: 36 }}
        className="flex items-center gap-2 rounded-[1.25rem] rounded-bl-md border border-white/[0.09] bg-gradient-to-r from-white/[0.06] to-white/[0.03] px-4 py-3"
      >
        <span className="text-[12px] text-zinc-400">Grok is checking</span>
        <span className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-zinc-300"
              animate={{ y: [0, -6, 0], opacity: [0.35, 1, 0.35] }}
              transition={{
                duration: 0.85,
                repeat: Infinity,
                delay: i * 0.16,
                ease: "easeInOut",
              }}
            />
          ))}
        </span>
      </motion.div>
    </div>
  );
}

function Composer({
  input,
  setInput,
  busy,
  draft,
  onSend,
}: {
  input: string;
  setInput: (v: string) => void;
  busy: boolean;
  draft: MarketDraft | null;
  onSend: () => void;
}) {
  return (
    <motion.div
      className="relative w-full"
      initial={{ opacity: 0, y: 28, scale: 0.965, filter: "blur(14px)" }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
      transition={{
        type: "spring",
        stiffness: 300,
        damping: 26,
        mass: 0.88,
      }}
    >
      <label htmlFor="create-market-prompt" className="sr-only">
        Market prompt
      </label>
      <div
        className={cn(
          "flex items-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.06] py-2 pl-4 pr-2 shadow-[inset_0_1px_10px_rgba(0,0,0,0.35)] transition focus-within:border-white/[0.18] focus-within:bg-white/[0.08]",
          draft && "opacity-40",
        )}
      >
        <input
          id="create-market-prompt"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (!busy && !draft && input.trim()) onSend();
            }
          }}
          placeholder={
            draft ? "Review and add an image above…" : INPUT_PLACEHOLDER
          }
          autoComplete="off"
          disabled={busy || !!draft}
          className="min-h-[44px] min-w-0 flex-1 border-0 bg-transparent text-[13px] text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-0 disabled:cursor-not-allowed"
        />
        {busy ? (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center">
            <Loader2
              className="h-5 w-5 animate-spin text-zinc-400"
              aria-hidden
            />
          </span>
        ) : (
          <motion.button
            type="button"
            whileHover={{ scale: draft ? 1 : 1.04 }}
            whileTap={{ scale: draft ? 1 : 0.96 }}
            disabled={!input.trim() || !!draft}
            onClick={onSend}
            aria-label="Send"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.14] text-white transition hover:bg-white/[0.22] disabled:cursor-not-allowed disabled:opacity-35"
          >
            <ArrowUp className="h-[17px] w-[17px]" strokeWidth={2.25} />
          </motion.button>
        )}
      </div>
    </motion.div>
  );
}

function Bubble({
  role,
  children,
}: {
  role: "user" | "assistant";
  children: React.ReactNode;
}) {
  const isUser = role === "user";
  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[min(88%,20rem)] px-3.5 py-2.5 text-[13px] leading-relaxed text-zinc-100",
          "border border-white/[0.1] bg-white/[0.05]",
          isUser
            ? "rounded-[1.25rem] rounded-br-md"
            : "rounded-[1.25rem] rounded-bl-md text-zinc-300",
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function CreateMarketFlow() {
  const router = useRouter();
  const { publicKey, connected } = useWallet();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState<MarketDraft | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageRelated, setImageRelated] = useState<boolean | null>(null);
  const [imageReason, setImageReason] = useState("");
  const [imageConfidence, setImageConfidence] = useState<number | null>(null);
  const [imageChecking, setImageChecking] = useState(false);
  /** Base64 data URL for Pinata upload on create (set after FileReader read). */
  const [coverDataUrl, setCoverDataUrl] = useState<string | null>(null);
  const [creatingMarket, setCreatingMarket] = useState(false);
  const [marketCreated, setMarketCreated] = useState<{
    slug: string;
    primarySig: string | null;
    mintYesTx: string | null;
    mintNoTx: string | null;
    poolInitTx: string | null;
    seedLiquidityTx: string | null;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastObjectUrl = useRef<string | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, busy, draft, imageChecking, creatingMarket]);

  function reset() {
    if (lastObjectUrl.current) {
      URL.revokeObjectURL(lastObjectUrl.current);
      lastObjectUrl.current = null;
    }
    setInput("");
    setBusy(false);
    setMessages([]);
    setDraft(null);
    setImagePreview(null);
    setImageRelated(null);
    setImageReason("");
    setImageConfidence(null);
    setImageChecking(false);
    setCoverDataUrl(null);
    setCreatingMarket(false);
    setMarketCreated(null);
  }

  function goToCreatedMarket() {
    if (!marketCreated) return;
    const sig =
      marketCreated.primarySig ??
      marketCreated.poolInitTx ??
      marketCreated.mintYesTx ??
      null;
    if (sig) {
      pushRecentMarketTransaction(
        marketCreated.slug,
        {
          action: "create_market",
          amount: "Market setup",
          signature: sig,
        },
        publicKey?.toBase58(),
      );
    }
    router.push(`/markets/${encodeURIComponent(marketCreated.slug)}`);
  }

  async function handleCreateMarket() {
    if (!draft || !publicKey || creatingMarket) return;
    setCreatingMarket(true);
    try {
      const res = await fetch("/api/market/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft,
          creatorWallet: publicKey.toBase58(),
          imageDataUrl: coverDataUrl ?? undefined,
        }),
      });
      const json = (await res.json()) as {
        market?: MarketRecord;
        error?: string;
      };
      if (!res.ok) {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            text:
              json.error ??
              "Could not create this market. Try again or check configuration.",
          },
        ]);
        return;
      }
      if (json.market?.slug) {
        const m = json.market;
        const primarySig =
          m.created_tx ?? m.pool_init_tx ?? m.mint_yes_tx ?? null;
        setMarketCreated({
          slug: m.slug,
          primarySig,
          mintYesTx: m.mint_yes_tx ?? null,
          mintNoTx: m.mint_no_tx ?? null,
          poolInitTx: m.pool_init_tx ?? null,
          seedLiquidityTx: m.seed_liquidity_tx ?? null,
        });
        return;
      }
    } catch {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: "Network error while creating the market.",
        },
      ]);
    } finally {
      setCreatingMarket(false);
    }
  }

  async function validateImageFile(f: File, d: MarketDraft) {
    if (lastObjectUrl.current) {
      URL.revokeObjectURL(lastObjectUrl.current);
    }
    const url = URL.createObjectURL(f);
    lastObjectUrl.current = url;
    setImagePreview(url);
    setImageRelated(null);
    setImageReason("");
    setImageConfidence(null);
    setImageChecking(true);
    const dataUrl: string = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(new Error("read"));
      r.readAsDataURL(f);
    });
    setCoverDataUrl(dataUrl);
    try {
      const res = await fetch("/api/market/validate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageDataUrl: dataUrl,
          question: d.question,
          description: d.description,
          imageRequirements: d.imageRequirements ?? "",
          subject: d.imageRequirements?.trim() || d.question,
        }),
      });
      const json = (await res.json()) as {
        valid?: boolean;
        related?: boolean;
        reason?: string;
        confidence?: number;
        error?: string;
      };
      if (!res.ok) {
        setCoverDataUrl(null);
        throw new Error(json.error || "Image validation failed");
      }
      const ok = Boolean(json.valid ?? json.related);
      setImageRelated(ok);
      if (!ok) setCoverDataUrl(null);
      setImageReason(json.reason?.trim() || "");
      setImageConfidence(
        typeof json.confidence === "number" && Number.isFinite(json.confidence)
          ? Math.max(0, Math.min(100, Math.round(json.confidence)))
          : null,
      );
    } catch {
      setCoverDataUrl(null);
      setImageRelated(false);
      setImageConfidence(null);
      setImageReason("Could not verify this image.");
    } finally {
      setImageChecking(false);
    }
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || busy || draft) return;
    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    setBusy(true);
    const started = Date.now();
    try {
      const res = await fetch("/api/market/validate-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text }),
      });
      const json = (await res.json()) as {
        passes?: boolean;
        assistantMessage?: string;
        draft?: MarketDraft;
        error?: string;
      };
      const elapsed = Date.now() - started;
      if (elapsed < PREMIUM_MIN_WAIT_MS) {
        await new Promise((r) =>
          setTimeout(r, PREMIUM_MIN_WAIT_MS - elapsed),
        );
      }
      if (!res.ok) {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            text:
              json.error ||
              "Validation is temporarily unavailable. Try again in a moment.",
          },
        ]);
        return;
      }
      if (json.passes === false) {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            text:
              json.assistantMessage ||
              "That doesn’t meet the bar for a public, verifiable market yet. Tighten the YES/NO and anchor it to something the world can check.",
          },
        ]);
        return;
      }
      if (json.passes === true && json.draft) {
        setDraft(json.draft);
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            text:
              json.assistantMessage ||
              "Looks good — review the draft and add a cover image that fits this market.",
          },
        ]);
      }
    } catch {
      const elapsed = Date.now() - started;
      if (elapsed < PREMIUM_MIN_WAIT_MS) {
        await new Promise((r) =>
          setTimeout(r, PREMIUM_MIN_WAIT_MS - elapsed),
        );
      }
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: "Couldn’t reach Grok. Check your connection and API configuration, then try again.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  const formReady =
    draft != null &&
    imagePreview != null &&
    imageRelated === true &&
    !imageChecking &&
    connected &&
    publicKey != null;

  const createBlockedReason = (() => {
    if (!draft) return null;
    if (!connected || !publicKey) return "Connect your Solana wallet to create.";
    if (imageChecking) return null;
    if (!imagePreview) return null;
    if (imageRelated !== true) return null;
    return null;
  })();

  return (
    <div className="relative flex min-h-[calc(100dvh-52px)] w-full flex-col overflow-hidden lg:min-h-[calc(100dvh-56px)]">
      <CreateBackground />

      <div className="relative z-10 flex flex-1 flex-col px-4 pb-6 pt-4 sm:px-5">
        <LayoutGroup id="create-flow">
          <div className="mx-auto flex w-full max-w-lg flex-1 flex-col min-h-0">
            {messages.length === 0 ? (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
                <div className="w-full px-1">
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                    className="text-center"
                  >
                    <h1 className="text-balance text-[17px] font-semibold leading-snug tracking-tight text-white sm:text-lg">
                      Create your Prediction Market and Earn!
                    </h1>
                    <p className="mx-auto mt-2 max-w-sm text-[11px] leading-relaxed text-zinc-400 sm:text-xs">
                      Market creator earns 2% of total volume.
                    </p>
                  </motion.div>
                  <motion.div
                    layoutId="create-composer"
                    transition={{ type: "spring", stiffness: 380, damping: 34 }}
                    className="mt-8 w-full"
                  >
                    <Composer
                      input={input}
                      setInput={setInput}
                      busy={busy}
                      draft={draft}
                      onSend={() => void handleSend()}
                    />
                  </motion.div>
                </div>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={reset}
                  className="mb-3 inline-flex shrink-0 items-center gap-2 self-start text-[12px] font-medium text-zinc-500 transition hover:text-zinc-200"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Start over
                </button>

                <div
                  ref={scrollRef}
                  className="scrollbar-none flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pb-4"
                >
                  {messages.map((msg, i) => (
                    <motion.div
                      key={`${i}-${msg.text.slice(0, 12)}`}
                      initial={{
                        opacity: 0,
                        x: msg.role === "user" ? 14 : -14,
                        scale: 0.96,
                      }}
                      animate={{ opacity: 1, x: 0, scale: 1 }}
                      transition={{
                        type: "spring",
                        stiffness: 420,
                        damping: 34,
                        delay: i === messages.length - 1 ? 0 : 0,
                      }}
                    >
                      <Bubble role={msg.role}>
                        {msg.text.split("\n").map((line, j) => (
                          <span key={j}>
                            {j > 0 && <br />}
                            {line}
                          </span>
                        ))}
                      </Bubble>
                    </motion.div>
                  ))}

                  {busy && <PremiumThinking />}

                  {draft && (
                    <motion.div
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ type: "spring", stiffness: 360, damping: 32 }}
                      className="mt-4 space-y-4 border-t border-white/[0.06] pt-4"
                    >
                      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
                        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                          Market title
                        </h3>
                        <p className="mt-1.5 text-[15px] font-medium leading-snug text-zinc-100">
                          {draft.question}
                        </p>
                        <h3 className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                          Description
                        </h3>
                        <p className="mt-1.5 text-[12px] leading-relaxed text-zinc-400">
                          {draft.description}
                        </p>
                        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
                            <div className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
                              Yes
                            </div>
                            <p className="mt-0.5 text-[11px] text-zinc-400">
                              Event occurs as stated.
                            </p>
                          </div>
                          <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
                            <div className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
                              No
                            </div>
                            <p className="mt-0.5 text-[11px] text-zinc-400">
                              Otherwise.
                            </p>
                          </div>
                        </div>
                        <h3 className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                          Resolution rules
                        </h3>
                        <p className="mt-1.5 text-[12px] leading-relaxed text-zinc-400">
                          {draft.resolutionRules}
                        </p>
                      </div>

                      <div className="rounded-2xl border border-dashed border-white/[0.1] bg-white/[0.02] p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                          <div className="relative mx-auto flex h-24 w-full max-w-[160px] shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/[0.08] bg-black/30 sm:mx-0">
                            {imagePreview ? (
                              <Image
                                src={imagePreview}
                                alt=""
                                fill
                                unoptimized
                                className="object-cover"
                              />
                            ) : (
                              <Upload className="h-7 w-7 text-zinc-600" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <h3 className="text-[13px] font-medium text-zinc-200">
                              Market image
                            </h3>
                            <p className="mt-0.5 text-[11px] text-zinc-500">
                              Grok checks that the art matches this market.
                            </p>
                            {imageChecking && (
                              <p className="mt-2 flex items-center gap-2 text-[11px] text-zinc-400">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                Verifying image…
                              </p>
                            )}
                            {imageRelated === false && !imageChecking && (
                              <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">
                                {imageReason ||
                                  "This image doesn’t match the market well enough."}
                              </p>
                            )}
                            {imageRelated === true && !imageChecking && (
                              <p className="mt-2 text-[11px] text-zinc-400">
                                Image aligns with the market.
                                {imageConfidence != null && (
                                  <span className="text-zinc-500">
                                    {" "}
                                    · confidence {imageConfidence}%
                                  </span>
                                )}
                              </p>
                            )}
                            <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.05] px-3 py-1.5 text-[12px] font-medium text-zinc-300 transition hover:bg-white/[0.08] disabled:opacity-40">
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                disabled={imageChecking}
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f && draft) void validateImageFile(f, draft);
                                }}
                              />
                              Choose file
                            </label>
                          </div>
                        </div>
                      </div>

                      <p className="text-[11px] leading-relaxed text-zinc-500">
                        {draft.aiReasoning}
                      </p>

                      {createBlockedReason && !marketCreated && (
                        <p className="text-center text-[11px] text-amber-200/90">
                          {createBlockedReason}
                        </p>
                      )}

                      {marketCreated ? (
                        <div className="space-y-3 rounded-xl border border-emerald-500/25 bg-emerald-950/25 px-4 py-4 ring-1 ring-emerald-500/15">
                          <div>
                            <p className="text-[12px] font-medium text-emerald-100/95">
                              Market created
                            </p>
                            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                              On-chain setup completed (devnet). Review the
                              transaction signature below, then open your market.
                            </p>
                          </div>
                          {marketCreated.primarySig ? (
                            <div className="text-[11px] leading-relaxed">
                              <TxExplorerLink
                                signature={marketCreated.primarySig}
                              />
                            </div>
                          ) : (
                            <p className="text-[11px] text-zinc-500">
                              No primary signature returned (mock or offline
                              pipeline).
                            </p>
                          )}
                          <ul className="space-y-1.5 text-[10px] text-zinc-500">
                            {(
                              [
                                ["YES mint", marketCreated.mintYesTx],
                                ["NO mint", marketCreated.mintNoTx],
                                ["Pool init", marketCreated.poolInitTx],
                                ["Seed liquidity", marketCreated.seedLiquidityTx],
                              ] as const
                            )
                              .filter(([, sig]) => Boolean(sig))
                              .filter(
                                ([, sig]) =>
                                  sig && sig !== marketCreated.primarySig,
                              )
                              .map(([label, sig]) => (
                                <li key={label}>
                                  <span className="text-zinc-600">{label}:</span>{" "}
                                  <span className="font-mono text-zinc-400">
                                    {shortenTransactionSignature(sig!, 5, 5)}
                                  </span>{" "}
                                  <a
                                    href={devnetTxExplorerUrl(sig!)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-emerald-400/90 underline decoration-emerald-500/35 underline-offset-2"
                                  >
                                    Explorer
                                  </a>
                                </li>
                              ))}
                          </ul>
                          <button
                            type="button"
                            onClick={() => goToCreatedMarket()}
                            className="flex w-full items-center justify-center gap-2 rounded-full bg-white py-3 text-[13px] font-semibold text-[#0a0a0c] shadow-[0_0_24px_-8px_rgba(255,255,255,0.35)] transition hover:bg-zinc-100"
                          >
                            Go to market
                          </button>
                        </div>
                      ) : (
                        <motion.button
                          type="button"
                          whileHover={{
                            scale: formReady && !creatingMarket ? 1.01 : 1,
                          }}
                          whileTap={{
                            scale: formReady && !creatingMarket ? 0.99 : 1,
                          }}
                          disabled={creatingMarket || !formReady}
                          onClick={() => void handleCreateMarket()}
                          className={cn(
                            "flex w-full items-center justify-center gap-2 rounded-full py-3 text-[13px] font-semibold transition",
                            formReady || creatingMarket
                              ? "bg-white text-[#0a0a0c] shadow-[0_0_24px_-8px_rgba(255,255,255,0.35)]"
                              : "cursor-not-allowed bg-white/[0.08] text-zinc-500",
                          )}
                        >
                          {creatingMarket ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Sparkles className="h-4 w-4" />
                          )}
                          {creatingMarket ? "Creating market…" : "Create market"}
                        </motion.button>
                      )}
                    </motion.div>
                  )}
                </div>

                <motion.div
                  layoutId="create-composer"
                  transition={{ type: "spring", stiffness: 380, damping: 34 }}
                  className="w-full shrink-0 pt-2"
                >
                  <Composer
                    input={input}
                    setInput={setInput}
                    busy={busy}
                    draft={draft}
                    onSend={() => void handleSend()}
                  />
                </motion.div>
              </>
            )}
          </div>
        </LayoutGroup>
      </div>
    </div>
  );
}

"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { LayoutGroup, motion } from "framer-motion";
import { ArrowLeft, ArrowUp, Loader2, Sparkles, Upload } from "lucide-react";
import { TxExplorerLink } from "@/components/market/tx-explorer-link";
import type { MarketDraft, MarketEngine } from "@/lib/types/market";
import type { MarketRecord } from "@/lib/types/market-record";
import { pushRecentMarketTransaction } from "@/lib/market/recent-market-transactions";
import { useWallet } from "@/lib/hooks/use-wallet";
import { useConnection } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  devnetTxExplorerUrl,
  shortenTransactionSignature,
} from "@/lib/utils/solana-explorer";
import { cn } from "@/lib/utils/cn";
import { parsePmammInitialLiquidityUsdcInput } from "@/lib/market/pmamm-initial-liquidity";
import { formatPmammCollateralHuman } from "@/lib/solana/pmamm-initial-lp-preflight";
import {
  PMAMM_CONFIG,
  PMAMM_DEFAULT_INITIAL_LIQUIDITY_USDC_HUMAN,
} from "@/lib/solana/pmamm-config";
import { COLLATERAL_DISPLAY_LABEL } from "@/lib/config/spark-usd";
import {
  dedupeWinnerDrafts,
  isNoneOfListedOutcomeDraft,
} from "@/lib/market/group-feed-markets";
import { reconcileGroupedDraftOutcomeMutations } from "@/lib/market/draft-outcome-reconcile";
import {
  alignGroupDraftExpiries,
  evaluateBundleCreateReadiness,
} from "@/lib/market/draft-create-readiness";
import type { GroupReconciliationPayload } from "@/lib/market/grouped-market-merge";

const PMAMM_USDC_DECIMALS = 6;

/** Canonical draft for the create UI: `drafts` lists only markets that still need POST /create after DB reconciliation. */
type MarketBundle = {
  eventTitle: string | null;
  drafts: MarketDraft[];
  groupReconciliation?: GroupReconciliationPayload | null;
};

function logDraftMutation(params: {
  intent: string;
  target?: string;
  beforeCount: number;
  afterCount: number;
  beforeQuestions: string[];
  afterQuestions: string[];
}) {
  console.info("[draft-mutation]", JSON.stringify(params));
}

function imageValidationFocusQuestion(
  bundle: MarketBundle | null,
  d: MarketDraft,
): string {
  if (!bundle || bundle.drafts.length <= 1) {
    return d.question;
  }
  return [bundle.eventTitle, ...bundle.drafts.map((x) => x.question)]
    .filter(Boolean)
    .join(" · ");
}

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
        <span className="text-[12px] text-zinc-400">One sec…</span>
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
  submitLocked,
  hasDraft,
  onSend,
  placeholderHint,
}: {
  input: string;
  setInput: (v: string) => void;
  busy: boolean;
  /** True while assistant responds or submission is in flight (disables chat). */
  submitLocked: boolean;
  /** A draft is on-screen — adjust placeholder only. */
  hasDraft: boolean;
  onSend: () => void;
  /** When set (e.g. mid-chat before a draft), overrides default placeholder. */
  placeholderHint?: string;
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
          submitLocked && "opacity-40",
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
              if (!submitLocked && input.trim()) onSend();
            }
          }}
          placeholder={
            hasDraft
              ? "Change expiry, wording, add/remove outcomes, engine…"
              : (placeholderHint ?? INPUT_PLACEHOLDER)
          }
          autoComplete="off"
          disabled={submitLocked}
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
            whileHover={{ scale: submitLocked ? 1 : 1.04 }}
            whileTap={{ scale: submitLocked ? 1 : 0.96 }}
            disabled={!input.trim() || submitLocked}
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
  const { connection } = useConnection();
  const { publicKey, connected, signTransaction } = useWallet();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [marketBundle, setMarketBundle] = useState<MarketBundle | null>(null);
  const [batchCreatedSlugs, setBatchCreatedSlugs] = useState<string[]>([]);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageRelated, setImageRelated] = useState<boolean | null>(null);
  const [imageReason, setImageReason] = useState("");
  const [imageConfidence, setImageConfidence] = useState<number | null>(null);
  const [imageChecking, setImageChecking] = useState(false);
  /** Base64 data URL for Pinata upload on create (set after FileReader read). */
  const [coverDataUrl, setCoverDataUrl] = useState<string | null>(null);
  const [creatingMarket, setCreatingMarket] = useState(false);
  const [marketEngine, setMarketEngine] = useState<MarketEngine>("GAMM");
  const [pmammInitialLiquidityUsdc, setPmammInitialLiquidityUsdc] = useState(
    PMAMM_DEFAULT_INITIAL_LIQUIDITY_USDC_HUMAN,
  );
  const [yourPmammUsdcAtoms, setYourPmammUsdcAtoms] = useState<bigint | null>(
    null,
  );
  const [yourPmammUsdcLoading, setYourPmammUsdcLoading] = useState(false);
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
  const primaryDraft = marketBundle?.drafts[0] ?? null;
  const draftCount = marketBundle?.drafts.length ?? 0;
  const pendingCreateCount = draftCount;
  const hasBundle =
    draftCount > 0 || Boolean(marketBundle?.groupReconciliation);
  const submitLocked = busy || creatingMarket;
  const bundleReadiness = useMemo(() => {
    const d = marketBundle?.drafts ?? [];
    const rec = marketBundle?.groupReconciliation;
    if (
      d.length === 0 &&
      rec &&
      rec.newOutcomeLabels.length === 0 &&
      rec.existingOutcomeLabels.length > 0
    ) {
      return {
        canCreate: false,
        blockedHint: "All outcomes already exist for this event.",
      };
    }
    return evaluateBundleCreateReadiness(d);
  }, [marketBundle]);
  const createSuccessNavTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, busy, hasBundle, imageChecking, creatingMarket, draftCount]);

  function reset() {
    if (lastObjectUrl.current) {
      URL.revokeObjectURL(lastObjectUrl.current);
      lastObjectUrl.current = null;
    }
    setInput("");
    setBusy(false);
    setMessages([]);
    setMarketBundle(null);
    setBatchCreatedSlugs([]);
    setImagePreview(null);
    setImageRelated(null);
    setImageReason("");
    setImageConfidence(null);
    setImageChecking(false);
    setCoverDataUrl(null);
    setCreatingMarket(false);
    setMarketCreated(null);
    setPmammInitialLiquidityUsdc(PMAMM_DEFAULT_INITIAL_LIQUIDITY_USDC_HUMAN);
    setYourPmammUsdcAtoms(null);
    setYourPmammUsdcLoading(false);
  }

  function goToCreatedMarket() {
    if (createSuccessNavTimer.current) {
      clearTimeout(createSuccessNavTimer.current);
      createSuccessNavTimer.current = null;
    }
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
    const slug =
      batchCreatedSlugs.length > 0 ? batchCreatedSlugs[0]! : marketCreated.slug;
    router.push(`/markets/${encodeURIComponent(slug)}`);
  }

  /** After a successful create, auto-open the market when only one was part of the flow. */
  useEffect(() => {
    if (!marketCreated) return;
    if (batchCreatedSlugs.length > 1) {
      return;
    }
    const m = marketCreated;
    createSuccessNavTimer.current = setTimeout(() => {
      createSuccessNavTimer.current = null;
      const sig = m.primarySig ?? m.poolInitTx ?? m.mintYesTx ?? null;
      if (sig) {
        pushRecentMarketTransaction(
          m.slug,
          {
            action: "create_market",
            amount: "Market setup",
            signature: sig,
          },
          publicKey?.toBase58(),
        );
      }
      router.push(`/markets/${encodeURIComponent(m.slug)}`);
    }, 2000);
    return () => {
      if (createSuccessNavTimer.current) {
        clearTimeout(createSuccessNavTimer.current);
        createSuccessNavTimer.current = null;
      }
    };
  }, [marketCreated, batchCreatedSlugs.length, publicKey, router]);

  const pmammLiqParsed = useMemo(() => {
    if (marketEngine !== "PM_AMM") {
      return { ok: true as const, atoms: 0n, humanForLog: "" };
    }
    return parsePmammInitialLiquidityUsdcInput(pmammInitialLiquidityUsdc);
  }, [marketEngine, pmammInitialLiquidityUsdc]);

  const pmammBalanceExceeded =
    marketEngine === "PM_AMM" &&
    pmammLiqParsed.ok &&
    yourPmammUsdcAtoms !== null &&
    pmammLiqParsed.atoms > yourPmammUsdcAtoms;

  useEffect(() => {
    if (marketEngine !== "PM_AMM" || !publicKey || !connection) {
      setYourPmammUsdcAtoms(null);
      setYourPmammUsdcLoading(false);
      return;
    }
    let cancelled = false;
    setYourPmammUsdcLoading(true);
    void (async () => {
      try {
        const mint = PMAMM_CONFIG.collateralMint;
        const ata = getAssociatedTokenAddressSync(
          mint,
          publicKey,
          false,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        );
        const acc = await getAccount(connection, ata, "confirmed");
        if (!cancelled) setYourPmammUsdcAtoms(acc.amount);
      } catch {
        if (!cancelled) setYourPmammUsdcAtoms(0n);
      } finally {
        if (!cancelled) setYourPmammUsdcLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [marketEngine, publicKey, connection]);

  const pmammLiquidityFormOk =
    marketEngine !== "PM_AMM" ||
    (pmammLiqParsed.ok && !pmammBalanceExceeded);

  const pmammCanSign =
    marketEngine !== "PM_AMM" || (!!signTransaction && !!connection);

  const formReady =
    bundleReadiness.canCreate &&
    primaryDraft != null &&
    imagePreview != null &&
    imageRelated === true &&
    !imageChecking &&
    connected &&
    publicKey != null &&
    pmammLiquidityFormOk &&
    pmammCanSign;

  const createBlockedReason = (() => {
    if (!bundleReadiness.canCreate && bundleReadiness.blockedHint) {
      return bundleReadiness.blockedHint;
    }
    if (!primaryDraft) return null;
    if (!connected || !publicKey) {
      return "Connect wallet to create a market.";
    }
    if (imageChecking) {
      return "Verifying image…";
    }
    if (!imagePreview) {
      return "Add a cover image to continue.";
    }
    if (imageRelated !== true) {
      return "Upload an image that matches this market, or pick a different file.";
    }
    if (
      marketEngine === "PM_AMM" &&
      (!signTransaction || !connection)
    ) {
      return "Use a wallet that can sign transactions — pmAMM initial liquidity is deposited from your connected wallet.";
    }
    return null;
  })();

  async function runCreateForDraft(
    forDraft: MarketDraft,
  ): Promise<
    | {
        ok: true;
        slug: string;
        primarySig: string | null;
        mintYesTx: string | null;
        mintNoTx: string | null;
        poolInitTx: string | null;
        seedLiquidityTx: string | null;
      }
    | { ok: false; message: string }
  > {
    if (!publicKey) {
      return { ok: false, message: "Connect wallet to create a market." };
    }

    const payload = {
      draft: forDraft,
      creatorWallet: publicKey.toBase58(),
      imageDataUrl: coverDataUrl ?? undefined,
      engine: marketEngine,
      ...(marketEngine === "PM_AMM"
        ? { initialLiquidityUsdc: pmammInitialLiquidityUsdc.trim() }
        : {}),
    };

    try {
      const res = await fetch("/api/market/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const rawText = await res.text();
      let json: {
        market?: MarketRecord;
        error?: string;
        stage?: string;
        missingProgramId?: string;
        outcomeAtaContext?: Record<string, string>;
      } = {};
      try {
        json = (rawText ? JSON.parse(rawText) : {}) as typeof json;
      } catch {
        return {
          ok: false,
          message: `Create market failed: server returned non-JSON (HTTP ${res.status}). ${rawText.slice(0, 200)}`,
        };
      }
      if (!res.ok) {
        const detail = [
          json.error && `Error: ${json.error}`,
          json.stage && `Stage: ${json.stage}`,
          json.missingProgramId && `Program id hint: ${json.missingProgramId}`,
          json.outcomeAtaContext &&
            `ATA debug: ${JSON.stringify(json.outcomeAtaContext, null, 2)}`,
        ]
          .filter(Boolean)
          .join("\n");
        return {
          ok: false,
          message:
            detail ||
            "Could not create this market. Try again or check configuration.",
        };
      }

      const phase = (json as { phase?: string }).phase;
      const depositB64 = (json as { depositTransaction?: string })
        .depositTransaction;

      if (
        res.ok &&
        phase === "pmamm_await_user_deposit" &&
        depositB64 &&
        json.market?.slug
      ) {
        if (!signTransaction || !connection) {
          return {
            ok: false,
            message:
              "Cannot sign the liquidity deposit — use a wallet that supports signing transactions.",
          };
        }
        try {
          const tx = Transaction.from(Buffer.from(depositB64, "base64"));
          const signed = await signTransaction(tx);
          const depositSig = await connection.sendRawTransaction(
            signed.serialize(),
            { skipPreflight: false },
          );
          await connection.confirmTransaction(depositSig, "confirmed");
          const completeRes = await fetch(
            "/api/market/create/complete-pmamm-deposit",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                slug: json.market.slug,
                creatorWallet: publicKey.toBase58(),
                depositSignature: depositSig,
              }),
            },
          );
          const completeText = await completeRes.text();
          let completeJson: {
            market?: MarketRecord;
            error?: string;
            stage?: string;
          } = {};
          try {
            completeJson = (
              completeText ? JSON.parse(completeText) : {}
            ) as typeof completeJson;
          } catch {
            return {
              ok: false,
              message: `Deposit submitted (${depositSig.slice(0, 12)}…) but finalize response was invalid. Check your market or try again.`,
            };
          }
          if (!completeRes.ok) {
            const detail = [
              completeJson.error && `Error: ${completeJson.error}`,
              completeJson.stage && `Stage: ${completeJson.stage}`,
            ]
              .filter(Boolean)
              .join("\n");
            return {
              ok: false,
              message:
                detail ||
                "Could not finalize the market after your deposit. Check devnet and try again.",
            };
          }
          const final = completeJson.market;
          if (!final?.slug) {
            return {
              ok: false,
              message: "Finalize step returned no market. Check server logs.",
            };
          }
          const primarySig =
            final.seed_liquidity_tx ??
            final.pool_init_tx ??
            final.created_tx ??
            null;
          return {
            ok: true,
            slug: final.slug,
            primarySig,
            mintYesTx: final.mint_yes_tx ?? null,
            mintNoTx: final.mint_no_tx ?? null,
            poolInitTx: final.pool_init_tx ?? null,
            seedLiquidityTx: final.seed_liquidity_tx ?? null,
          };
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          return {
            ok: false,
            message: `Liquidity deposit failed: ${errMsg || "Wallet or network error"}.`,
          };
        }
      }

      if (json.market?.slug) {
        const m = json.market;
        if ((json as { reusedExisting?: boolean }).reusedExisting) {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              text: "That market already exists — opening it.",
            },
          ]);
        }
        const primarySig =
          m.created_tx ?? m.pool_init_tx ?? m.mint_yes_tx ?? null;
        return {
          ok: true,
          slug: m.slug,
          primarySig,
          mintYesTx: m.mint_yes_tx ?? null,
          mintNoTx: m.mint_no_tx ?? null,
          poolInitTx: m.pool_init_tx ?? null,
          seedLiquidityTx: m.seed_liquidity_tx ?? null,
        };
      }

      return {
        ok: false,
        message: `Create market returned an unexpected response (no market slug). Body: ${rawText.slice(0, 400)}`,
      };
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        message: `Create market failed: ${errMsg || "Network error"}`,
      };
    }
  }

  async function handleCreateMarket() {
    if (!marketBundle?.drafts.length || !publicKey || creatingMarket) {
      return;
    }

    console.info("[predicted][create-ui] create market(s) clicked", {
      count: pendingCreateCount,
      draftsListed: marketBundle.drafts.length,
      creatorWallet: publicKey.toBase58(),
      marketEngine,
    });

    setCreatingMarket(true);
    try {
      const slugs: string[] = [];
      let lastRecord: {
        slug: string;
        primarySig: string | null;
        mintYesTx: string | null;
        mintNoTx: string | null;
        poolInitTx: string | null;
        seedLiquidityTx: string | null;
      } | null = null;

      for (const forDraft of marketBundle.drafts) {
        const r = await runCreateForDraft(forDraft);
        if (!r.ok) {
          setMessages((m) => [...m, { role: "assistant", text: r.message }]);
          return;
        }
        slugs.push(r.slug);
        lastRecord = {
          slug: r.slug,
          primarySig: r.primarySig,
          mintYesTx: r.mintYesTx,
          mintNoTx: r.mintNoTx,
          poolInitTx: r.poolInitTx,
          seedLiquidityTx: r.seedLiquidityTx,
        };
      }

      if (lastRecord) {
        setBatchCreatedSlugs(slugs);
        setMarketCreated(lastRecord);
      }
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
          question: imageValidationFocusQuestion(marketBundle, d),
          description: d.description,
          imageRequirements: d.imageRequirements ?? "",
          subject:
            d.imageRequirements?.trim() ||
            imageValidationFocusQuestion(marketBundle, d),
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
    if (!text || submitLocked) return;
    const startOver = /^(start\s+over|new\s+market|reset|discard\s+draft)\b/i.test(
      text,
    );
    const priorHistory = messages.map((m) => ({
      role: m.role,
      content: m.text,
    }));
    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    setBusy(true);
    const started = Date.now();
    try {
      const res = await fetch("/api/market/validate-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: text,
          history: priorHistory,
          userDisplayHint: publicKey
            ? `wallet ${publicKey.toBase58()}`
            : undefined,
          existingDrafts:
            !startOver && marketBundle && marketBundle.drafts.length > 0
              ? marketBundle.drafts
              : undefined,
          existingEventTitle:
            !startOver && marketBundle ? marketBundle.eventTitle : undefined,
        }),
      });
      const json = (await res.json()) as {
        assistantMessage?: string;
        drafts?: MarketDraft[];
        eventTitle?: string | null;
        isMarketGroup?: boolean;
        mutationAck?: boolean;
        error?: string;
        groupReconcileApplied?: boolean;
        groupReconciliation?: GroupReconciliationPayload | null;
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
              "Something went wrong. Try again in a moment.",
          },
        ]);
        return;
      }

      const rawDrafts = Array.isArray(json.drafts) ? json.drafts : [];
      let drafts =
        rawDrafts.length > 0
          ? dedupeWinnerDrafts(rawDrafts)
          : [];

      if (drafts.length > 1) {
        drafts = alignGroupDraftExpiries(drafts);
      }

      if (
        !startOver &&
        !json.groupReconcileApplied &&
        marketBundle &&
        marketBundle.drafts.length > 1 &&
        drafts.length > 0
      ) {
        const hadNoneBin = marketBundle.drafts.some(isNoneOfListedOutcomeDraft);
        const rec = reconcileGroupedDraftOutcomeMutations({
          userPrompt: text,
          previousDrafts: marketBundle.drafts,
          llmDrafts: drafts,
        });
        drafts = rec.drafts;
        const stillHasNone = drafts.some(isNoneOfListedOutcomeDraft);
        const removedNone = hadNoneBin && !stillHasNone;
        logDraftMutation({
          intent: removedNone
            ? "remove_outcome"
            : rec.reconciliationApplied
              ? "reconcile"
              : "noop",
          target: removedNone ? "none_of_listed" : undefined,
          beforeCount: marketBundle.drafts.length,
          afterCount: drafts.length,
          beforeQuestions: marketBundle.drafts.map((d) => d.question),
          afterQuestions: drafts.map((d) => d.question),
        });
      }

      let assistantMessage = json.assistantMessage?.trim() ?? "";
      const mutationAck = Boolean(json.mutationAck);

      const clarifying =
        assistantMessage.includes("?") &&
        /when|what time|time zone|end (\?|this|the|on)|already in the past|pick a future|which day|\butc\b|confirm/i.test(
          assistantMessage,
        );

      if (drafts.length >= 1 && !clarifying && !mutationAck) {
        const isMulti =
          drafts.length > 1 || Boolean(json.isMarketGroup);
        assistantMessage = isMulti
          ? "Here are the markets. You can create them now, or tell me what to edit."
          : "Looks good — you can create it now, or tell me what to change.";
      } else if (drafts.length === 0 && !startOver && marketBundle) {
        assistantMessage =
          assistantMessage ||
          "What would you like to change? If you need an end time, say when this market should close.";
      } else if (!assistantMessage) {
        assistantMessage =
          drafts.length > 0
            ? "Looks good — you can create it now, or tell me what to change."
            : "Tell me a bit more about what you want to predict.";
      }

      setMessages((m) => [...m, { role: "assistant", text: assistantMessage }]);

      if (drafts.length >= 1 || json.groupReconciliation) {
        setMarketBundle({
          eventTitle:
            json.eventTitle?.trim() ||
            json.groupReconciliation?.matchedEventTitle?.trim() ||
            marketBundle?.eventTitle ||
            null,
          drafts,
          groupReconciliation: json.groupReconciliation ?? null,
        });
      } else if (startOver) {
        setMarketBundle(null);
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
          text: "Couldn’t reach the assistant. Check your connection and API configuration, then try again.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

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
                      submitLocked={submitLocked}
                      hasDraft={hasBundle}
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

                  {marketBundle &&
                    (primaryDraft || marketBundle.groupReconciliation) && (
                    <motion.div
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ type: "spring", stiffness: 360, damping: 32 }}
                      className="mt-4 space-y-4 border-t border-white/[0.06] pt-4"
                    >
                      {(() => {
                        const rec = marketBundle.groupReconciliation;
                        const displayEventTitle =
                          marketBundle.eventTitle?.trim() ||
                          rec?.matchedEventTitle?.trim() ||
                          "";
                        const showEventChrome =
                          Boolean(displayEventTitle) &&
                          (draftCount > 1 || Boolean(rec));
                        return showEventChrome ? (
                          <div className="rounded-2xl border border-white/[0.1] bg-gradient-to-b from-white/[0.07] to-white/[0.02] px-4 py-3">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                              Event
                            </p>
                            <p className="mt-1 text-[14px] font-medium leading-snug text-zinc-100">
                              {displayEventTitle}
                            </p>
                          </div>
                        ) : null;
                      })()}

                      {marketBundle.groupReconciliation ? (
                        <div className="rounded-2xl border border-sky-500/20 bg-gradient-to-b from-sky-500/[0.07] to-white/[0.02] px-4 py-3.5">
                          <p className="text-[13px] font-semibold text-zinc-100">
                            {marketBundle.groupReconciliation.headline}
                          </p>
                          {marketBundle.groupReconciliation.existingOutcomeLabels
                            .length > 0 ? (
                            <div className="mt-3">
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                                Already existing
                              </p>
                              <ul className="mt-1.5 space-y-1">
                                {marketBundle.groupReconciliation.existingOutcomeLabels.map(
                                  (label, i) => (
                                    <li
                                      key={`eo-${i}-${label}`}
                                      className="flex items-start gap-2 text-[12px] leading-snug text-zinc-300"
                                    >
                                      <span
                                        className="mt-0.5 text-emerald-400"
                                        aria-hidden
                                      >
                                        ✓
                                      </span>
                                      <span>{label}</span>
                                    </li>
                                  ),
                                )}
                              </ul>
                            </div>
                          ) : null}
                          {marketBundle.groupReconciliation.newOutcomeLabels
                            .length > 0 ? (
                            <div className="mt-3">
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                                New outcomes to create
                              </p>
                              <ul className="mt-1.5 space-y-1">
                                {marketBundle.groupReconciliation.newOutcomeLabels.map(
                                  (label, i) => (
                                    <li
                                      key={`no-${i}-${label}`}
                                      className="flex items-start gap-2 text-[12px] leading-snug text-sky-100/95"
                                    >
                                      <span className="mt-0.5" aria-hidden>
                                        +
                                      </span>
                                      <span>{label}</span>
                                    </li>
                                  ),
                                )}
                              </ul>
                            </div>
                          ) : (
                            <p className="mt-2 text-[12px] leading-relaxed text-zinc-400">
                              All outcomes already exist for this event.
                            </p>
                          )}
                        </div>
                      ) : null}

                      {draftCount > 1 ? (
                        <ul className="space-y-2.5">
                          {marketBundle.drafts.map((d, idx) => (
                            <li
                              key={`m-${idx}-${d.question.slice(0, 48)}`}
                              className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <p className="min-w-0 flex-1 text-[14px] font-medium leading-snug text-zinc-100">
                                  {d.question}
                                </p>
                              </div>
                              <p className="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-500">
                                {d.resolutionRules}
                              </p>
                            </li>
                          ))}
                        </ul>
                      ) : primaryDraft ? (
                        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
                          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                            Market title
                          </h3>
                          <p className="mt-1.5 text-[15px] font-medium leading-snug text-zinc-100">
                            {primaryDraft.question}
                          </p>
                          <h3 className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                            Description
                          </h3>
                          <p className="mt-1.5 text-[12px] leading-relaxed text-zinc-400">
                            {primaryDraft.description}
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
                            {primaryDraft.resolutionRules}
                          </p>
                        </div>
                      ) : null}

                      {primaryDraft ? (
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
                              Cover image
                            </h3>
                            <p className="mt-0.5 text-[11px] text-zinc-500">
                              One image applies to {draftCount > 1 ? "all markets in this group" : "this market"}.
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
                                  if (f && primaryDraft)
                                    void validateImageFile(f, primaryDraft);
                                }}
                              />
                              Choose file
                            </label>
                          </div>
                        </div>
                      </div>
                      ) : null}

                      {draftCount === 1 && primaryDraft ? (
                        <p className="text-[11px] leading-relaxed text-zinc-500">
                          {primaryDraft.aiReasoning}
                        </p>
                      ) : null}

                      {createBlockedReason && !marketCreated && (
                        <p className="text-center text-[11px] text-amber-200/90">
                          {createBlockedReason}
                        </p>
                      )}

                      {!marketCreated && primaryDraft ? (
                        <div
                          className="flex items-center justify-center gap-1 rounded-xl border border-white/[0.08] bg-white/[0.03] p-1"
                          role="group"
                          aria-label="Market engine"
                        >
                          {(
                            [
                              { id: "GAMM" as const, label: "GAMM" },
                              { id: "PM_AMM" as const, label: "pmAMM" },
                            ] as const
                          ).map(({ id, label }) => (
                            <button
                              key={id}
                              type="button"
                              disabled={creatingMarket}
                              onClick={() => setMarketEngine(id)}
                              className={cn(
                                "min-h-[40px] flex-1 rounded-lg px-3 text-[12px] font-semibold transition",
                                marketEngine === id
                                  ? "bg-white text-[#0a0a0c]"
                                  : "text-zinc-400 hover:text-zinc-200",
                              )}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      ) : null}

                      {marketEngine === "PM_AMM" && !marketCreated && primaryDraft ? (
                        <div className="space-y-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-3">
                          <label
                            htmlFor="pmamm-initial-liquidity"
                            className="block text-[11px] font-medium text-zinc-300"
                          >
                            Initial Liquidity
                          </label>
                          <input
                            id="pmamm-initial-liquidity"
                            type="text"
                            inputMode="decimal"
                            autoComplete="off"
                            placeholder={`${PMAMM_DEFAULT_INITIAL_LIQUIDITY_USDC_HUMAN} ${COLLATERAL_DISPLAY_LABEL}`}
                            value={pmammInitialLiquidityUsdc}
                            onChange={(e) =>
                              setPmammInitialLiquidityUsdc(e.target.value)
                            }
                            disabled={creatingMarket}
                            className="w-full rounded-lg border border-white/[0.1] bg-black/25 px-3 py-2 text-[13px] text-zinc-100 placeholder:text-zinc-600 focus:border-white/[0.2] focus:outline-none disabled:opacity-45"
                          />
                          <p className="text-[10px] leading-relaxed text-zinc-500">
                            Recommended: 1000 {COLLATERAL_DISPLAY_LABEL}. You can start smaller for
                            testing.
                          </p>
                          <p className="text-[10px] leading-relaxed text-zinc-500">
                            Higher liquidity reduces slippage and makes the
                            market easier to trade.
                          </p>
                          <p className="text-[10px] leading-relaxed text-zinc-600">
                            Initial liquidity is deposited from your connected
                            wallet. After you click create, approve the liquidity
                            deposit in your wallet — you pay SOL fees and {COLLATERAL_DISPLAY_LABEL},
                            and you receive the LP position.
                          </p>
                          {yourPmammUsdcLoading ? (
                            <p className="flex items-center gap-2 text-[10px] text-zinc-500">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              Loading your {COLLATERAL_DISPLAY_LABEL} balance…
                            </p>
                          ) : yourPmammUsdcAtoms !== null && pmammLiqParsed.ok ? (
                            <p className="text-[10px] leading-relaxed text-zinc-500">
                              Your wallet has{" "}
                              {formatPmammCollateralHuman(
                                yourPmammUsdcAtoms,
                                PMAMM_USDC_DECIMALS,
                              )}{" "}
                              {COLLATERAL_DISPLAY_LABEL} (mint{" "}
                              <span className="font-mono text-zinc-600">
                                {PMAMM_CONFIG.collateralMint.toBase58().slice(0, 6)}
                                …
                              </span>
                              ).
                            </p>
                          ) : null}
                          {!pmammLiqParsed.ok ? (
                            <p className="text-[11px] leading-relaxed text-amber-200/90">
                              {pmammLiqParsed.error}
                            </p>
                          ) : null}
                          {pmammBalanceExceeded ? (
                            <p className="text-[11px] leading-relaxed text-amber-200/90">
                              You need{" "}
                              {formatPmammCollateralHuman(
                                pmammLiqParsed.atoms,
                                PMAMM_USDC_DECIMALS,
                              )}{" "}
                              {COLLATERAL_DISPLAY_LABEL}, but your wallet has{" "}
                              {formatPmammCollateralHuman(
                                yourPmammUsdcAtoms!,
                                PMAMM_USDC_DECIMALS,
                              )}{" "}
                              {COLLATERAL_DISPLAY_LABEL}.
                            </p>
                          ) : null}
                        </div>
                      ) : null}

                      {marketCreated ? (
                        <div className="space-y-3 rounded-xl border border-emerald-500/25 bg-emerald-950/25 px-4 py-4 ring-1 ring-emerald-500/15">
                          <div>
                            <p className="text-[12px] font-medium text-emerald-100/95">
                              {batchCreatedSlugs.length > 1
                                ? `Markets created (${batchCreatedSlugs.length})`
                                : "Market created"}
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
                          {batchCreatedSlugs.length > 1 ? (
                            <ul className="space-y-1 text-[11px] text-zinc-400">
                              {batchCreatedSlugs.map((s) => (
                                <li key={s}>
                                  <a
                                    href={`/markets/${encodeURIComponent(s)}`}
                                    className="text-emerald-400/90 underline decoration-emerald-500/35 underline-offset-2"
                                  >
                                    {s}
                                  </a>
                                </li>
                              ))}
                            </ul>
                          ) : null}
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
                          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                            <button
                              type="button"
                              onClick={() => goToCreatedMarket()}
                              className="flex w-full items-center justify-center gap-2 rounded-full bg-white py-3 text-[13px] font-semibold text-[#0a0a0c] shadow-[0_0_24px_-8px_rgba(255,255,255,0.35)] transition hover:bg-zinc-100 sm:flex-1"
                            >
                              Go to market
                            </button>
                          </div>
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
                          {creatingMarket
                            ? "Creating…"
                            : pendingCreateCount === 0
                              ? "Nothing new to create"
                              : draftCount > 1
                                ? pendingCreateCount === draftCount
                                  ? `Create ${pendingCreateCount} markets`
                                  : `Create ${pendingCreateCount} new market${pendingCreateCount === 1 ? "" : "s"}`
                                : "Create market"}
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
                    submitLocked={submitLocked}
                    hasDraft={hasBundle}
                    placeholderHint={
                      hasBundle
                        ? undefined
                        : "e.g. a team name, “first one”, or “create all”…"
                    }
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

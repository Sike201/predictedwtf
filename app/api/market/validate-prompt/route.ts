import { NextResponse } from "next/server";
import { extractMarketFromPrompt } from "@/lib/ai/mock-extract";
import {
  fallbackConversationalOpenWinnerTurn,
  filterUsableMarketPayloads,
  looksLikeOpenWinnerTopic,
  parseCreateAssistantTurn,
} from "@/lib/market/create-assistant-turn";
import { grokValidationToMarketDraft } from "@/lib/market/validation-result";
import { MARKET_VALIDATION_SYSTEM_PROMPT } from "@/lib/market/validation-system-prompt";
import { parseGrokJsonObject } from "@/lib/market/parse-grok-json";
import type { MarketDraft } from "@/lib/types/market";
import { defaultXaiModel, xaiChatCompletion } from "@/lib/server/xai";
import {
  appendGroupedBinPayloads,
  dedupeGroupedPayloads,
  pickSharedExpiryFromPayloads,
} from "@/lib/market/grouped-event-draft";
import {
  dedupeWinnerDrafts,
  groupMetaFromQuestion,
  normalizeOutcomeLabel,
  normalizeStoredGroupKey,
} from "@/lib/market/group-feed-markets";
import { alignGroupDraftExpiries } from "@/lib/market/draft-create-readiness";
import { reconcileGroupedDraftOutcomeMutations } from "@/lib/market/draft-outcome-reconcile";
import {
  findSimilarGroupedMarketCluster,
  mergeProposedGroupedDraftsWithExistingMembers,
  type GroupReconciliationPayload,
} from "@/lib/market/grouped-market-merge";
import { getSupabaseAdmin } from "@/lib/supabase/server-client";

export const runtime = "nodejs";

type HistoryBody = { role: "user" | "assistant"; content: string };

function buildUserPayloadMessage(
  prompt: string,
  userDisplayHint?: string,
): string {
  const hint =
    userDisplayHint?.trim() &&
    `\nOptional context (for interpreting "me"): ${userDisplayHint.trim()}\n`;
  return `The user's latest message (verbatim):
"""
${prompt}
"""
${hint ?? ""}
Return JSON only, following your instructions (including type "market_group" when user wants all suggested binaries at once).`;
}

function appendEditContextToUserMessage(
  message: string,
  existingDrafts?: MarketDraft[],
  existingEventTitle?: string | null,
): string {
  if (!existingDrafts?.length) return message;
  const snapshot = {
    eventTitle: existingEventTitle ?? null,
    drafts: existingDrafts.map((d) => ({
      question: d.question,
      description: d.description,
      expiry: d.expiry,
      resolutionRules: d.resolutionRules,
      resolutionSource: d.resolutionSource,
      /* Keep these so the model can merge rules / image hints */
      suggestedRules: d.suggestedRules,
      imageRequirements: d.imageRequirements,
      eventGroupKey: d.eventGroupKey,
      eventTitle: d.eventTitle,
      outcomeLabel: d.outcomeLabel,
      outcomeType: d.outcomeType,
      groupOrder: d.groupOrder,
    })),
  };
  return `${message}

---
EDIT MODE — current drafts JSON (merge the user's latest message; return complete updated markets[] for the whole group unless they explicitly start over):
${JSON.stringify(snapshot, null, 2)}
---
`;
}

/** Prefer matching Grok row → existing draft by outcomeLabel so reorder/edit turns don't corrupt rows by index. */
function fallbackDraftForGrokPayload(
  p: {
    outcomeLabel?: string;
    outcome_label?: string;
    question?: string;
    title?: string;
  },
  existingDrafts: MarketDraft[] | undefined,
  index: number,
  baseNew: MarketDraft,
): MarketDraft {
  if (!existingDrafts?.length) return baseNew;
  const ol = (p.outcomeLabel ?? p.outcome_label ?? "").trim();
  if (ol) {
    const nk = normalizeOutcomeLabel(ol);
    const found = existingDrafts.find((d) => {
      const dl = (d.outcomeLabel ?? "").trim();
      if (dl && normalizeOutcomeLabel(dl) === nk) return true;
      const meta = groupMetaFromQuestion(d.question);
      return (
        !!meta?.outcomeLabel &&
        normalizeOutcomeLabel(meta.outcomeLabel) === nk
      );
    });
    if (found) return found;
  }
  return existingDrafts[index] ?? existingDrafts[0] ?? baseNew;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      prompt?: string;
      history?: HistoryBody[];
      userDisplayHint?: string;
      existingDrafts?: MarketDraft[];
      existingEventTitle?: string | null;
    };
    const prompt = (body.prompt ?? "").trim();
    if (!prompt) {
      return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
    }

    const history = Array.isArray(body.history) ? body.history : [];
    const trimmedHistory = history
      .filter(
        (h) =>
          (h.role === "user" || h.role === "assistant") &&
          typeof h.content === "string" &&
          h.content.trim().length > 0,
      )
      .map((h) => ({
        role: h.role,
        content: h.content.trim(),
      }))
      .slice(-24);

    const existingDrafts = Array.isArray(body.existingDrafts)
      ? body.existingDrafts
      : undefined;
    const existingEventTitle =
      body.existingEventTitle === null ||
      typeof body.existingEventTitle === "string"
        ? body.existingEventTitle
        : undefined;

    let turn: ReturnType<typeof parseCreateAssistantTurn>;
    let fallback = false;

    if (!process.env.XAI_API_KEY) {
      if (looksLikeOpenWinnerTopic(prompt)) {
        turn = fallbackConversationalOpenWinnerTurn(prompt);
      } else {
        fallback = true;
        const base = extractMarketFromPrompt(prompt);
        const draftPayload = {
          question: base.question,
          yesCondition:
            "Resolves YES if the stated event occurs as described before the end time.",
          noCondition: "Resolves NO if YES is not met before the end time.",
          endTimeUtc: base.expiry,
          warning: null as string | null,
        };
        turn = {
          assistantMessage:
            "Here’s a draft from your message. (Configure XAI_API_KEY for a guided chat.) Review below and add a cover image.",
          marketPayloads: [draftPayload],
          eventTitle: null,
          isMarketGroup: false,
          eventGroupKey: null,
          outcomeType: null,
          groupExpiryUtc: null,
        };
      }
    } else {
      const model = defaultXaiModel();
      const messages: {
        role: "system" | "user" | "assistant";
        content: string;
      }[] = [
        { role: "system", content: MARKET_VALIDATION_SYSTEM_PROMPT },
      ];
      for (const h of trimmedHistory) {
        messages.push({ role: h.role, content: h.content });
      }
      messages.push({
        role: "user",
        content: appendEditContextToUserMessage(
          buildUserPayloadMessage(prompt, body.userDisplayHint),
          existingDrafts,
          existingEventTitle,
        ),
      });

      const raw = await xaiChatCompletion({
        model,
        jsonMode: true,
        temperature: 0.35,
        messages,
      });

      try {
        const parsedObj = parseGrokJsonObject<Record<string, unknown>>(raw);
        turn = parseCreateAssistantTurn(parsedObj);
      } catch {
        fallback = true;
        turn = {
          assistantMessage:
            "Couldn’t read that response — here’s a starter draft from your last message.",
          marketPayloads: [],
          eventTitle: null,
          isMarketGroup: false,
          eventGroupKey: null,
          outcomeType: null,
          groupExpiryUtc: null,
        };
      }

      if (fallback && turn.marketPayloads.length === 0) {
        const base = extractMarketFromPrompt(prompt);
        turn = {
          assistantMessage: turn.assistantMessage,
          marketPayloads: [
            {
              question: base.question,
              yesCondition:
                "Resolves YES if the stated event occurs as described before the end time.",
              noCondition:
                "Resolves NO if YES is not met before the end time.",
              endTimeUtc: base.expiry,
              warning: null,
            },
          ],
          eventTitle: null,
          isMarketGroup: false,
          eventGroupKey: null,
          outcomeType: null,
          groupExpiryUtc: null,
        };
      }
    }

    const baseNew = extractMarketFromPrompt(prompt);
    let usable = filterUsableMarketPayloads(turn.marketPayloads);

    const eventTitleForGroup = turn.eventTitle;
    const eventGroupKeyEffective =
      turn.isMarketGroup && turn.eventGroupKey
        ? turn.eventGroupKey.trim()
        : null;

    if (
      turn.isMarketGroup &&
      eventTitleForGroup &&
      eventGroupKeyEffective
    ) {
      usable = dedupeGroupedPayloads(usable, eventGroupKeyEffective);
      const sharedExp = pickSharedExpiryFromPayloads(
        usable,
        turn.groupExpiryUtc ?? "",
      );
      if (sharedExp.trim()) {
        usable = appendGroupedBinPayloads(usable, {
          eventTitle: eventTitleForGroup,
          outcomeType: turn.outcomeType,
          sharedExpiry: sharedExp,
        });
      }
    }

    let drafts: MarketDraft[] = usable.map((p, i) => {
      const baseDraft = grokValidationToMarketDraft(
        p,
        fallbackDraftForGrokPayload(p, existingDrafts, i, baseNew),
        prompt,
      );
      if (
        turn.isMarketGroup &&
        eventGroupKeyEffective &&
        eventTitleForGroup
      ) {
        const ol =
          (p.outcomeLabel ?? p.outcome_label ?? "").trim() ||
          groupMetaFromQuestion(baseDraft.question)?.outcomeLabel ||
          "";
        return {
          ...baseDraft,
          eventGroupKey: normalizeStoredGroupKey(eventGroupKeyEffective),
          eventTitle: eventTitleForGroup,
          outcomeLabel: ol || undefined,
          outcomeType: turn.outcomeType ?? undefined,
          groupOrder: i,
        };
      }
      return baseDraft;
    });

    let assistantMessageOut = turn.assistantMessage;
    let mutationAck = false;
    let groupReconcileApplied = false;
    let groupReconciliation: GroupReconciliationPayload | null = null;

    if (existingDrafts && existingDrafts.length > 1) {
      const rec = reconcileGroupedDraftOutcomeMutations({
        userPrompt: prompt,
        previousDrafts: existingDrafts,
        llmDrafts: drafts,
      });
      drafts = rec.drafts;
      if (rec.acknowledgment) {
        assistantMessageOut = rec.acknowledgment;
        mutationAck = true;
      }
    }

    if (turn.isMarketGroup && drafts.length >= 1) {
      const sb = getSupabaseAdmin();
      if (sb) {
        const existing = await findSimilarGroupedMarketCluster(sb, {
          eventGroupKey: eventGroupKeyEffective ?? turn.eventGroupKey,
          eventTitle: turn.eventTitle,
          draftQuestions: drafts.map((d) => d.question),
        });
        if (existing.length > 0) {
          groupReconcileApplied = true;
          const merged = mergeProposedGroupedDraftsWithExistingMembers({
            proposedDrafts: drafts,
            existingMembers: existing,
          });
          drafts = merged.draftsToCreate;
          groupReconciliation = merged.reconciliation;
          if (merged.mergeNotice) {
            assistantMessageOut = merged.mergeNotice;
            mutationAck = true;
          }
        }
      }
    }

    if (drafts.length > 1) {
      drafts = dedupeWinnerDrafts(alignGroupDraftExpiries(drafts));
    }

    return NextResponse.json({
      assistantMessage: assistantMessageOut,
      mutationAck,
      drafts,
      eventTitle: turn.eventTitle,
      isMarketGroup: turn.isMarketGroup,
      fallback,
      groupReconcileApplied,
      groupReconciliation,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Chat turn failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

import { NextResponse } from "next/server";
import { extractMarketFromPrompt } from "@/lib/ai/mock-extract";
import {
  buildInvalidAssistantMessage,
  grokValidationToMarketDraft,
  type GrokValidationJson,
} from "@/lib/market/validation-result";
import { MARKET_VALIDATION_SYSTEM_PROMPT } from "@/lib/market/validation-system-prompt";
import { parseGrokJsonObject } from "@/lib/market/parse-grok-json";
import type { MarketDraft } from "@/lib/types/market";
import { defaultXaiModel, xaiChatCompletion } from "@/lib/server/xai";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { prompt?: string };
    const prompt = (body.prompt ?? "").trim();
    if (!prompt) {
      return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
    }

    if (!process.env.XAI_API_KEY) {
      const draft = extractMarketFromPrompt(prompt);
      return NextResponse.json({
        passes: true,
        fallback: true,
        assistantMessage:
          "Here’s a draft based on that. (Configure XAI_API_KEY for Grok validation.) Review below, add a cover image, then create the market when it looks right.",
        draft,
      });
    }

    const model = defaultXaiModel();
    const raw = await xaiChatCompletion({
      model,
      jsonMode: true,
      temperature: 0.1,
      messages: [
        { role: "system", content: MARKET_VALIDATION_SYSTEM_PROMPT },
        {
          role: "user",
          content: `User market idea (verbatim):\n"""\n${prompt}\n"""\n\nReturn JSON only, matching the schema in your instructions.`,
        },
      ],
    });

    const parsed = parseGrokJsonObject<GrokValidationJson>(raw);

    const valid = parsed.valid === true && parsed.needs_revision !== true;
    if (!valid) {
      return NextResponse.json({
        passes: false,
        assistantMessage: buildInvalidAssistantMessage(parsed),
      });
    }

    const base = extractMarketFromPrompt(prompt);
    const draft: MarketDraft = grokValidationToMarketDraft(parsed, base);

    return NextResponse.json({
      passes: true,
      assistantMessage:
        "Looks good — this is framed so independent observers can resolve it. Review the draft and add a cover image that matches the subject.",
      draft,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Validation failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

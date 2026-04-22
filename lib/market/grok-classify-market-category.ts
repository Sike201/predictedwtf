import { xaiChatCompletion, defaultXaiModel } from "@/lib/server/xai";
import type { MarketTopic } from "@/lib/types/market";

const LOG = "[predicted][market-category-grok]";

const ALLOWED: ReadonlySet<MarketTopic> = new Set([
  "politics",
  "sports",
  "crypto",
  "tech",
  "finance",
  "predicted",
]);

function buildPrompt(question: string): string {
  const q = question.trim() || "—";
  return `You are classifying a prediction market question.

Return ONLY one category from:

politics
sports
crypto
tech
finance
predicted

Rules:
- politics → elections, governments, geopolitics
- sports → teams, leagues, games, championships
- crypto → bitcoin, ethereum, tokens, crypto markets
- tech → AI, startups, software, tech companies
- finance → stocks, macroeconomics, interest rates
- predicted → anything else

Question:
${q}

Return only the category name.`;
}

/** Normalize Grok output to an allowed `MarketTopic` (otherwise `predicted`). */
export function normalizeGrokCategoryResponse(raw: string): MarketTopic {
  const firstLine = raw.trim().split(/\r?\n/)[0]!.trim().toLowerCase();
  const m = firstLine.match(
    /\b(politics|sports|crypto|tech|finance|predicted)\b/,
  );
  if (m && ALLOWED.has(m[1] as MarketTopic)) {
    return m[1] as MarketTopic;
  }
  return "predicted";
}

/**
 * Classifies a market question with Grok. If `XAI_API_KEY` is missing or the
 * request fails, returns `predicted`.
 */
export async function classifyMarketCategoryWithGrok(params: {
  question: string;
  slug?: string;
}): Promise<MarketTopic> {
  const key = process.env.XAI_API_KEY?.trim();
  if (!key) {
    console.info(
      LOG,
      JSON.stringify({
        event: "skip_no_xai_key",
        slug: params.slug ?? null,
        result: "predicted",
      }),
    );
    return "predicted";
  }

  const q = params.question.trim();
  if (!q) {
    return "predicted";
  }

  try {
    const content = await xaiChatCompletion({
      model: defaultXaiModel(),
      messages: [{ role: "user", content: buildPrompt(q) }],
      temperature: 0,
    });
    const normalized = normalizeGrokCategoryResponse(content);
    console.info(
      LOG,
      JSON.stringify({
        event: "classified",
        slug: params.slug ?? null,
        rawHead: content.slice(0, 80),
        normalized,
      }),
    );
    return normalized;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(
      LOG,
      JSON.stringify({
        event: "error",
        slug: params.slug ?? null,
        message,
        result: "predicted",
      }),
    );
    return "predicted";
  }
}

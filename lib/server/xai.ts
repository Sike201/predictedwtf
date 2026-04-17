const XAI_BASE = "https://api.x.ai/v1";

export type XaiMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | {
      role: "user";
      content: Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
    };

export async function xaiChatCompletion(params: {
  model: string;
  messages: XaiMessage[];
  temperature?: number;
  /** Prefer JSON when the model supports it */
  jsonMode?: boolean;
}): Promise<string> {
  const key = process.env.XAI_API_KEY;
  if (!key) {
    throw new Error("XAI_API_KEY is not set");
  }

  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
    temperature: params.temperature ?? 0.15,
  };
  if (params.jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch(`${XAI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`xAI API ${res.status}: ${raw.slice(0, 500)}`);
  }

  const data = JSON.parse(raw) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("xAI returned empty content");
  }
  return content.trim();
}

/** Defaults to grok-4-1-fast-non-reasoning (see https://docs.x.ai/developers/models). */
export function defaultXaiModel() {
  return process.env.XAI_MODEL?.trim() || "grok-4-1-fast-non-reasoning";
}

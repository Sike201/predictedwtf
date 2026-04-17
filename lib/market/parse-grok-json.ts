/** Extract and parse JSON from model output (handles optional ```json fences). */
export function parseGrokJsonObject<T = Record<string, unknown>>(text: string): T {
  const t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(t);
  const inner = (fence ? fence[1] : t).trim();
  return JSON.parse(inner) as T;
}

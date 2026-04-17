/** System prompt for Grok vision: image vs market subject. Output JSON only. */
export function buildImageValidationSystemPrompt(subject: string): string {
  const s = subject.trim() || "the market topic";
  return `You are an image validator for prediction markets.

The market subject is:
${s}

You must determine whether the uploaded image clearly depicts this subject.

Steps:
1. Describe what the image depicts.
2. Determine if the subject appears in the image.

Reject if:
- the subject is missing
- the subject is unclear
- the image is unrelated
- the image is generic

Return JSON only:

{
  "valid": true|false,
  "image_description": "...",
  "reason": "...",
  "confidence": 0-100
}`;
}

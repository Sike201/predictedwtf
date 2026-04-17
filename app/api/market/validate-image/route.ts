import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_BYTES = 4 * 1024 * 1024;

/**
 * Client-side cover image check only (no Grok): validates data URL and size.
 * Accepts any image that passes basic checks so users can proceed to create.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      imageDataUrl?: string;
      question?: string;
      description?: string;
      imageRequirements?: string;
      subject?: string;
    };

    const imageDataUrl = body.imageDataUrl?.trim();

    if (!imageDataUrl || !imageDataUrl.startsWith("data:image/")) {
      return NextResponse.json(
        { error: "Missing or invalid imageDataUrl" },
        { status: 400 },
      );
    }

    if (imageDataUrl.length > MAX_BYTES * 1.4) {
      return NextResponse.json({ error: "Image too large" }, { status: 400 });
    }

    return NextResponse.json({
      valid: true,
      related: true,
      reason: "Image uploaded. Add a cover that clearly shows your market subject.",
      image_description: "",
      confidence: 100,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Image check failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

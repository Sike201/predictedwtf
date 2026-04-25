import { PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";

import { loadWalletPortfolioPositions } from "@/lib/market/load-wallet-portfolio";
import { getConnection } from "@/lib/solana/connection";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const wallet = searchParams.get("wallet")?.trim();
    if (!wallet) {
      return NextResponse.json({ error: "Missing wallet" }, { status: 400 });
    }
    let owner: PublicKey;
    try {
      owner = new PublicKey(wallet);
    } catch {
      return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
    }

    const connection = getConnection();
    const positions = await loadWalletPortfolioPositions(owner, connection);

    return NextResponse.json({ positions });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to load portfolio positions";
    console.error("[predicted][portfolio-api]", e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

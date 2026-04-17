import { PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";

import { fetchOutcomeTopHolders } from "@/lib/solana/fetch-outcome-top-holders";
import { getConnection } from "@/lib/solana/connection";
import { readOmnipairPoolState } from "@/lib/solana/read-omnipair-pool-state";
import { getSupabaseAdmin } from "@/lib/supabase/server-client";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const slug = searchParams.get("slug")?.trim();

    if (!slug) {
      return NextResponse.json({ error: "Missing slug" }, { status: 400 });
    }

    const sb = getSupabaseAdmin();
    if (!sb) {
      return NextResponse.json(
        { error: "Server data store unavailable" },
        { status: 503 },
      );
    }

    const { data, error } = await sb
      .from("markets")
      .select("slug,status,pool_address,yes_mint,no_mint")
      .eq("slug", slug)
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json({ error: "Market not found" }, { status: 404 });
    }

    const row = data as {
      status: string;
      pool_address: string | null;
      yes_mint: string | null;
      no_mint: string | null;
    };

    if (
      row.status !== "live" ||
      !row.pool_address ||
      !row.yes_mint ||
      !row.no_mint
    ) {
      return NextResponse.json(
        { error: "Market has no live pool on record" },
        { status: 404 },
      );
    }

    const pairAddress = new PublicKey(row.pool_address);
    const yesMint = new PublicKey(row.yes_mint);
    const noMint = new PublicKey(row.no_mint);

    const connection = getConnection();

    const poolState = await readOmnipairPoolState(connection, {
      pairAddress,
      yesMint,
      noMint,
    });

    const excludeTokenAccounts = [
      new PublicKey(poolState.reserve0Vault),
      new PublicKey(poolState.reserve1Vault),
    ];

    const { yes, no, decimals } = await fetchOutcomeTopHolders(connection, {
      yesMint,
      noMint,
      excludeTokenAccounts,
    });

    return NextResponse.json({
      slug,
      decimals,
      yes,
      no,
      excludedVaults: excludeTokenAccounts.map((p) => p.toBase58()),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[predicted][holders] error", msg);
    return NextResponse.json(
      { error: "Failed to load holders" },
      { status: 500 },
    );
  }
}

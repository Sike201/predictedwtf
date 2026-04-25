import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";

import { getConnection } from "@/lib/solana/connection";
import {
  fetchPoolSwapVolumeUsd24hWithStats,
  fetchPoolTotalSwapVolumeUsdWithStats,
} from "@/lib/solana/fetch-pool-onchain-activity";

export const maxDuration = 60;

/**
 * GET ?poolId=&yesMint=&noMint= — swap-only volume (excludes bootstrap via parser rules).
 */
export async function GET(request: NextRequest) {
  const poolId = request.nextUrl.searchParams.get("poolId");
  const yesMint = request.nextUrl.searchParams.get("yesMint");
  const noMint = request.nextUrl.searchParams.get("noMint");
  const windowParam = request.nextUrl.searchParams.get("window");
  const use24h =
    windowParam === "24h" ||
    request.nextUrl.searchParams.get("hours") === "24";

  if (!poolId || !yesMint || !noMint) {
    return NextResponse.json(
      { volumeUsd: 0, signaturesScanned: 0, swapsParsed: 0 },
      { status: 400 },
    );
  }

  try {
    const connection = getConnection();
    const { volumeUsd, signaturesScanned, swapsParsed } = use24h
      ? await fetchPoolSwapVolumeUsd24hWithStats(connection, {
          pairAddress: new PublicKey(poolId),
          yesMint: new PublicKey(yesMint),
          noMint: new PublicKey(noMint),
        })
      : await fetchPoolTotalSwapVolumeUsdWithStats(connection, {
          pairAddress: new PublicKey(poolId),
          yesMint: new PublicKey(yesMint),
          noMint: new PublicKey(noMint),
        });
    if (process.env.NODE_ENV === "development") {
      console.info("[predicted][onchain-volume-direct]", {
        component: "api_market_swap_volume",
        poolAddress: poolId,
        signaturesScanned,
        swapsParsed,
        volumeUsd,
      });
    }
    return NextResponse.json({ volumeUsd, signaturesScanned, swapsParsed });
  } catch (e) {
    console.warn("[predicted][swap-volume-api]", e);
    return NextResponse.json({
      volumeUsd: 0,
      signaturesScanned: 0,
      swapsParsed: 0,
    });
  }
}

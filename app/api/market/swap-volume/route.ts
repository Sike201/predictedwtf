import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";

import { getConnection } from "@/lib/solana/connection";
import {
  fetchPoolSwapVolumeUsd24hWithStats,
  fetchPoolTotalSwapVolumeUsdWithStats,
} from "@/lib/solana/fetch-pool-onchain-activity";
import {
  fetchPmammMarketSwapVolumeUsd24hWithStats,
  fetchPmammMarketTotalSwapVolumeUsdWithStats,
} from "@/lib/solana/pmamm-pool-activity";

export const maxDuration = 60;

/**
 * GET ?poolId=&yesMint=&noMint= — swap-only volume (excludes bootstrap via parser rules).
 */
export async function GET(request: NextRequest) {
  const poolId = request.nextUrl.searchParams.get("poolId");
  const yesMint = request.nextUrl.searchParams.get("yesMint");
  const noMint = request.nextUrl.searchParams.get("noMint");
  const engine = request.nextUrl.searchParams.get("engine")?.trim();
  const collateralMintParam =
    request.nextUrl.searchParams.get("collateralMint")?.trim();
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

  if (engine === "PM_AMM" && !collateralMintParam) {
    return NextResponse.json(
      { volumeUsd: 0, signaturesScanned: 0, swapsParsed: 0 },
      { status: 400 },
    );
  }

  try {
    const connection = getConnection();
    const yesPk = new PublicKey(yesMint);
    const noPk = new PublicKey(noMint);
    const marketPda = new PublicKey(poolId);

    const { volumeUsd, signaturesScanned, swapsParsed } =
      engine === "PM_AMM" && collateralMintParam
        ? use24h
          ? await fetchPmammMarketSwapVolumeUsd24hWithStats(connection, {
              marketPda,
              collateralMint: new PublicKey(collateralMintParam),
              yesMint: yesPk,
              noMint: noPk,
            })
          : await fetchPmammMarketTotalSwapVolumeUsdWithStats(connection, {
              marketPda,
              collateralMint: new PublicKey(collateralMintParam),
              yesMint: yesPk,
              noMint: noPk,
            })
        : use24h
          ? await fetchPoolSwapVolumeUsd24hWithStats(connection, {
              pairAddress: marketPda,
              yesMint: yesPk,
              noMint: noPk,
            })
          : await fetchPoolTotalSwapVolumeUsdWithStats(connection, {
              pairAddress: marketPda,
              yesMint: yesPk,
              noMint: noPk,
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

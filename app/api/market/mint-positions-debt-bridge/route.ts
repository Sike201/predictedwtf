import { PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";

import { isMarketRecordResolved } from "@/lib/market/market-trading-blocked";
import {
  type CloseDirection,
  buildDebtBridgeShortfallDetails,
} from "@/lib/market/leverage-debt-bridge";
import {
  buildMintPositionsTransactionEngineSigned,
  parseUsdcHumanToBaseUnits,
} from "@/lib/solana/mint-market-positions";
import { getConnection } from "@/lib/solana/connection";
import {
  getAssociatedTokenAddressForMint,
  resolveSplTokenProgramForMint,
} from "@/lib/solana/omnipair-leverage-common";
import { readOmnipairUserPositionSnapshot } from "@/lib/solana/read-omnipair-position";
import { loadMarketEngineAuthority } from "@/lib/solana/treasury";
import { formatBaseUnitsToDecimalString } from "@/lib/solana/wallet-token-balances";
import { getSupabaseAdmin } from "@/lib/supabase/server-client";
import type { MarketRecord } from "@/lib/types/market-record";

export const runtime = "nodejs";

const LOG = "[predicted][leverage-debt-bridge]";
const CALC_LOG = "[predicted][leverage-debt-bridge-calc]";
const MAX_USDC_ATOMS = 10_000_000_000_000n; // 10M USDC (6 dp) — safety cap, matches mint-positions

function hasOpenLeverage(
  snap: NonNullable<
    Awaited<ReturnType<typeof readOmnipairUserPositionSnapshot>>
  >,
): boolean {
  return (
    BigInt(snap.collateralYesAtoms) > 0n ||
    BigInt(snap.collateralNoAtoms) > 0n ||
    BigInt(snap.debtYesAtoms) > 0n ||
    BigInt(snap.debtNoAtoms) > 0n
  );
}

function isYesTrackCloseViable(
  debtNoAtoms: bigint,
  collYesAtoms: bigint,
): boolean {
  return debtNoAtoms > 0n || collYesAtoms > 0n;
}

function isNoTrackCloseViable(
  debtYesAtoms: bigint,
  collNoAtoms: bigint,
): boolean {
  return debtYesAtoms > 0n || collNoAtoms > 0n;
}

type BridgePreview = {
  closeDirection: CloseDirection;
  debtToken: "yes" | "no";
  shortfallOutcomeAtoms: string;
  minUsdcBaseUnits: string;
  minUsdcHuman: string;
};

async function readWalletYesNoBals(
  connection: Awaited<ReturnType<typeof getConnection>>,
  user: PublicKey,
  yesMint: PublicKey,
  noMint: PublicKey,
): Promise<{ yesWalletAtoms: bigint; noWalletAtoms: bigint }> {
  const yesProg = await resolveSplTokenProgramForMint(connection, yesMint);
  const noProg = await resolveSplTokenProgramForMint(connection, noMint);
  const yesAta = getAssociatedTokenAddressForMint(
    yesMint,
    user,
    yesProg,
  );
  const noAta = getAssociatedTokenAddressForMint(
    noMint,
    user,
    noProg,
  );
  const yesBal = BigInt(
    (await connection.getTokenAccountBalance(yesAta).catch(() => ({
      value: { amount: "0" },
    }))).value.amount,
  );
  const noBal = BigInt(
    (await connection.getTokenAccountBalance(noAta).catch(() => ({
      value: { amount: "0" },
    }))).value.amount,
  );
  return { yesWalletAtoms: yesBal, noWalletAtoms: noBal };
}

function logBridge(
  extra: Record<string, unknown> & { preview_or_build: "preview" | "build" },
) {
  console.info(LOG, JSON.stringify(extra));
}

/** Shared loader for GET + POST */
async function loadBridgePreview(
  slug: string,
  user: PublicKey,
  closeDirection: CloseDirection,
): Promise<
  | { error: string; status: number }
  | { preview: BridgePreview; row: MarketRecord }
> {
  const sb = getSupabaseAdmin();
  if (!sb) {
    return { error: "Supabase is not configured", status: 503 };
  }
  const { data: row, error } = await sb
    .from("markets")
    .select(
      "slug,status,resolution_status,resolve_after,expiry_ts,yes_mint,no_mint,pool_address",
    )
    .eq("slug", slug)
    .maybeSingle();
  if (error || !row) {
    return { error: "Market not found", status: 404 };
  }
  const rec = row as MarketRecord;
  if (!isMarketRecordResolved(rec)) {
    return {
      error: "Debt bridge is only for resolved markets.",
      status: 400,
    };
  }
  if (rec.status !== "live" || !rec.yes_mint || !rec.no_mint || !rec.pool_address) {
    return {
      error: "Market must be live with pool and outcome mints",
      status: 400,
    };
  }

  const connection = getConnection();
  const yesPk = new PublicKey(rec.yes_mint!);
  const noPk = new PublicKey(rec.no_mint!);
  const pairAddress = new PublicKey(rec.pool_address!);

  const snap = await readOmnipairUserPositionSnapshot({
    connection,
    pairAddress,
    yesMint: yesPk,
    noMint: noPk,
    owner: user,
  });
  if (!snap) {
    return { error: "No Omnipair lending position for this wallet and market.", status: 400 };
  }
  if (!hasOpenLeverage(snap)) {
    return { error: "No open leverage position to bridge.", status: 400 };
  }

  const debtNo = BigInt(snap.debtNoAtoms);
  const debtYes = BigInt(snap.debtYesAtoms);
  const collYes = BigInt(snap.collateralYesAtoms);
  const collNo = BigInt(snap.collateralNoAtoms);

  if (closeDirection === "yes" && !isYesTrackCloseViable(debtNo, collYes)) {
    return {
      error: "Nothing to close on the YES track for this position.",
      status: 400,
    };
  }
  if (closeDirection === "no" && !isNoTrackCloseViable(debtYes, collNo)) {
    return {
      error: "Nothing to close on the NO track for this position.",
      status: 400,
    };
  }

  const { yesWalletAtoms, noWalletAtoms } = await readWalletYesNoBals(
    connection,
    user,
    yesPk,
    noPk,
  );

  const shortfallDetails = buildDebtBridgeShortfallDetails(closeDirection, {
    debtYesAtoms: debtYes,
    debtNoAtoms: debtNo,
    yesWalletAtoms,
    noWalletAtoms,
  });
  const { shortfall, debtToken } = {
    shortfall: shortfallDetails.tokenShortfallOutcomeAtoms,
    debtToken: shortfallDetails.debtToken,
  };
  const minUsdc = shortfallDetails.minUsdcBaseUnits;

  if (shortfall > 0n) {
    console.info(
      CALC_LOG,
      JSON.stringify({
        slug,
        closeDirection: shortfallDetails.closeDirection,
        debtToken: shortfallDetails.debtToken,
        debtTokenOwedAtoms: shortfallDetails.debtTokenOwedAtoms.toString(),
        debtTokenWalletAtoms: shortfallDetails.debtTokenWalletAtoms.toString(),
        tokenShortfallOutcomeAtoms:
          shortfallDetails.tokenShortfallOutcomeAtoms.toString(),
        ceilingDivisor: shortfallDetails.ceilingDivisor.toString(),
        minUsdcBaseUnits: shortfallDetails.minUsdcBaseUnits.toString(),
        minUsdcHuman: formatBaseUnitsToDecimalString(
          shortfallDetails.minUsdcBaseUnits,
          6,
          6,
        ),
        formula:
          "minUsdcBaseUnits=ceilDiv(tokenShortfall,10^(outcomeDec-usdcDec)); outcomeDec=9,usdcDec=6",
      }),
    );
  }
  const minUsdcHuman = formatBaseUnitsToDecimalString(
    minUsdc,
    6,
    6,
  );

  return {
    preview: {
      closeDirection,
      debtToken,
      shortfallOutcomeAtoms: shortfall.toString(),
      minUsdcBaseUnits: minUsdc.toString(),
      minUsdcHuman,
    },
    row: rec,
  };
}

/**
 * Query: slug, userWallet, closeDirection=yes|no
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const slug = searchParams.get("slug")?.trim();
    const userWallet = searchParams.get("userWallet")?.trim();
    const dirRaw = searchParams.get("closeDirection")?.trim().toLowerCase();

    if (!slug || !userWallet) {
      return NextResponse.json(
        { error: "Missing slug or userWallet" },
        { status: 400 },
      );
    }
    if (dirRaw !== "yes" && dirRaw !== "no") {
      return NextResponse.json(
        { error: 'closeDirection must be "yes" or "no"' },
        { status: 400 },
      );
    }
    const closeDirection = dirRaw as CloseDirection;

    let user: PublicKey;
    try {
      user = new PublicKey(userWallet);
    } catch {
      return NextResponse.json({ error: "Invalid userWallet" }, { status: 400 });
    }

    const loaded = await loadBridgePreview(slug, user, closeDirection);
    if ("error" in loaded) {
      return NextResponse.json(
        { error: loaded.error },
        { status: loaded.status },
      );
    }
    const { preview } = loaded;

    logBridge({
      slug,
      closeDirection: preview.closeDirection,
      debtToken: preview.debtToken,
      shortfallOutcomeAtoms: preview.shortfallOutcomeAtoms,
      minUsdcBaseUnits: preview.minUsdcBaseUnits,
      providedUsdcBaseUnits: "0",
      preview_or_build: "preview",
    });

    if (BigInt(preview.shortfallOutcomeAtoms) === 0n) {
      return NextResponse.json(
        { error: "No debt-token shortfall — use normal Settle / Close only." },
        { status: 400 },
      );
    }

    return NextResponse.json({ ...preview, slug });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Bridge preview failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

type PostBody = {
  slug?: string;
  userWallet?: string;
  closeDirection?: string;
  usdcAmountHuman?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as PostBody;
    const slug = body.slug?.trim();
    const userWallet = body.userWallet?.trim();
    const dirRaw = body.closeDirection?.trim().toLowerCase();
    const usdcAmountHuman = body.usdcAmountHuman?.trim() ?? "";

    if (!slug || !userWallet) {
      return NextResponse.json(
        { error: "Missing slug or userWallet" },
        { status: 400 },
      );
    }
    if (dirRaw !== "yes" && dirRaw !== "no") {
      return NextResponse.json(
        { error: 'closeDirection must be "yes" or "no"' },
        { status: 400 },
      );
    }
    const closeDirection = dirRaw as CloseDirection;

    let user: PublicKey;
    try {
      user = new PublicKey(userWallet);
    } catch {
      return NextResponse.json({ error: "Invalid userWallet" }, { status: 400 });
    }

    const engine = loadMarketEngineAuthority();
    if (!engine) {
      return NextResponse.json(
        {
          error:
            "Server missing MARKET_ENGINE_AUTHORITY_SECRET — cannot co-sign outcome mints.",
        },
        { status: 503 },
      );
    }

    const loaded = await loadBridgePreview(slug, user, closeDirection);
    if ("error" in loaded) {
      return NextResponse.json(
        { error: loaded.error },
        { status: loaded.status },
      );
    }
    const { preview, row } = loaded;
    if (BigInt(preview.shortfallOutcomeAtoms) === 0n) {
      return NextResponse.json(
        { error: "No debt-token shortfall — nothing to bridge." },
        { status: 400 },
      );
    }

    const usdcAtoms = parseUsdcHumanToBaseUnits(usdcAmountHuman);
    if (usdcAtoms <= 0n) {
      return NextResponse.json(
        { error: "Enter a devnet USDC amount greater than zero" },
        { status: 400 },
      );
    }
    if (usdcAtoms > MAX_USDC_ATOMS) {
      return NextResponse.json({ error: "Amount exceeds cap" }, { status: 400 });
    }
    const minB = BigInt(preview.minUsdcBaseUnits);
    if (usdcAtoms < minB) {
      return NextResponse.json(
        {
          error: `USDC is below minimum required (${preview.minUsdcHuman} USDC).`,
        },
        { status: 400 },
      );
    }

    const connection = getConnection();
    const { serialized, outcomeMintAtoms } =
      await buildMintPositionsTransactionEngineSigned({
        connection,
        engine,
        user,
        yesMint: new PublicKey(row.yes_mint!),
        noMint: new PublicKey(row.no_mint!),
        usdcAmountAtoms: usdcAtoms,
      });

    logBridge({
      slug,
      closeDirection: preview.closeDirection,
      debtToken: preview.debtToken,
      shortfallOutcomeAtoms: preview.shortfallOutcomeAtoms,
      minUsdcBaseUnits: preview.minUsdcBaseUnits,
      providedUsdcBaseUnits: usdcAtoms.toString(),
      preview_or_build: "build",
    });

    return NextResponse.json({
      transaction: Buffer.from(serialized).toString("base64"),
      outcomeMintAtoms: outcomeMintAtoms.toString(),
      usdcAtoms: usdcAtoms.toString(),
      ...preview,
    });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Debt bridge build failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

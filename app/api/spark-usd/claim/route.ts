import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { ComputeBudgetProgram, PublicKey, Transaction } from "@solana/web3.js";
import { NextResponse } from "next/server";

import {
  COLLATERAL_DISPLAY_LABEL,
  SPARK_USD_SYMBOL,
  getSparkUsdMint,
} from "@/lib/config/spark-usd";
import { getConnection } from "@/lib/solana/connection";
import { resolveMintTokenProgram } from "@/lib/solana/mint-token-program";
import { getSupabaseAdmin } from "@/lib/supabase/server-client";
import { loadSparkUsdMintAuthority } from "@/lib/solana/treasury";
import {
  SPARK_USD_CLAIM_PENDING_SIG,
  SPARK_USD_DAILY_CLAIM_CAP_HUMAN,
  SPARK_USD_FAUCET_CLAIM_AMOUNT_ATOMS,
  utcDateStringYmd,
} from "@/lib/spark-usd/faucet";

export const runtime = "nodejs";

const PENDING_TTL_MS = 15 * 60 * 1000;

const ATA_MISMATCH_USER_MESSAGE =
  "Could not create SparkUSD token account. Token program mismatch.";

function isLikelyAtaOrTokenProgramError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("associated address does not match") ||
    m.includes("provided seeds do not result") ||
    m.includes("createidempotent") ||
    m.includes("invalid account data") ||
    m.includes("incorrect program id")
  );
}

function claimErrorForClient(raw: string): string {
  if (isLikelyAtaOrTokenProgramError(raw)) {
    return ATA_MISMATCH_USER_MESSAGE;
  }
  return raw;
}

function isUniqueViolation(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === "23505") return true;
  const m = err.message?.toLowerCase() ?? "";
  return m.includes("duplicate") || m.includes("unique");
}

async function cleanupStalePending(
  sb: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
) {
  const cutoff = new Date(Date.now() - PENDING_TTL_MS).toISOString();
  await sb
    .from("spark_usd_claims")
    .delete()
    .eq("tx_signature", SPARK_USD_CLAIM_PENDING_SIG)
    .lt("claimed_at", cutoff);
}

export async function GET(req: Request) {
  const wallet = new URL(req.url).searchParams.get("wallet")?.trim();
  if (!wallet) {
    return NextResponse.json({ error: "Missing wallet" }, { status: 400 });
  }
  let pk: PublicKey;
  try {
    pk = new PublicKey(wallet);
  } catch {
    return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
  }

  const day = utcDateStringYmd();
  const sb = getSupabaseAdmin();
  if (!sb) {
    return NextResponse.json(
      { error: "Supabase is not configured" },
      { status: 503 },
    );
  }

  const { data: row } = await sb
    .from("spark_usd_claims")
    .select("amount, tx_signature, claimed_at")
    .eq("wallet", pk.toBase58())
    .eq("claim_day_utc", day)
    .maybeSingle();

  const r = row as {
    amount: number;
    tx_signature: string;
    claimed_at: string;
  } | null;

  const claimedToday =
    r != null && r.tx_signature !== SPARK_USD_CLAIM_PENDING_SIG;
  const pending = r != null && r.tx_signature === SPARK_USD_CLAIM_PENDING_SIG;

  return NextResponse.json({
    wallet: pk.toBase58(),
    claimDayUtc: day,
    claimedToday,
    pending,
    maxClaimableHuman: SPARK_USD_DAILY_CLAIM_CAP_HUMAN,
    defaultClaimHuman: SPARK_USD_DAILY_CLAIM_CAP_HUMAN,
    symbol: SPARK_USD_SYMBOL,
    displayName: COLLATERAL_DISPLAY_LABEL,
    mint: getSparkUsdMint().toBase58(),
  });
}

type ClaimBody = { wallet?: string };

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ClaimBody;
    const wallet = body.wallet?.trim();
    if (!wallet) {
      return NextResponse.json({ error: "Missing wallet" }, { status: 400 });
    }

    let pk: PublicKey;
    try {
      pk = new PublicKey(wallet);
    } catch {
      return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
    }

    const sb = getSupabaseAdmin();
    if (!sb) {
      return NextResponse.json(
        { error: "Supabase is not configured" },
        { status: 503 },
      );
    }

    const authority = loadSparkUsdMintAuthority();
    if (!authority) {
      return NextResponse.json(
        {
          error:
            "Claim is not available: server mint authority is not configured.",
        },
        { status: 503 },
      );
    }

    const mintPk = getSparkUsdMint();
    const day = utcDateStringYmd();

    await cleanupStalePending(sb);

    const insertRes = await sb
      .from("spark_usd_claims")
      .insert({
        wallet: pk.toBase58(),
        amount: Number(SPARK_USD_FAUCET_CLAIM_AMOUNT_ATOMS),
        claim_day_utc: day,
        tx_signature: SPARK_USD_CLAIM_PENDING_SIG,
      })
      .select("id")
      .single();

    if (insertRes.error) {
      if (isUniqueViolation(insertRes.error)) {
        return NextResponse.json(
          {
            error: `You already claimed ${SPARK_USD_DAILY_CLAIM_CAP_HUMAN} ${COLLATERAL_DISPLAY_LABEL} today. Claim available tomorrow (UTC).`,
          },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { error: insertRes.error.message ?? "Claim record failed" },
        { status: 500 },
      );
    }

    const rowId = (insertRes.data as { id: string }).id;

    try {
      const connection = getConnection();
      const { tokenProgramId, mintOwner } = await resolveMintTokenProgram(
        connection,
        mintPk,
        "confirmed",
      );

      const userAta = getAssociatedTokenAddressSync(
        mintPk,
        pk,
        false,
        tokenProgramId,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );

      const tx = new Transaction();
      tx.add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      );
      tx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          userAta,
          pk,
          mintPk,
          tokenProgramId,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
      );
      tx.add(
        createMintToInstruction(
          mintPk,
          userAta,
          authority.publicKey,
          SPARK_USD_FAUCET_CLAIM_AMOUNT_ATOMS,
          [],
          tokenProgramId,
        ),
      );

      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.feePayer = authority.publicKey;
      tx.sign(authority);

      console.info("[sparkusd-claim-ata-debug]", {
        wallet: pk.toBase58(),
        mint: mintPk.toBase58(),
        mintAccountOwner: mintOwner.toBase58(),
        tokenProgramId: tokenProgramId.toBase58(),
        associatedTokenProgramId: ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
        derivedAta: userAta.toBase58(),
        payer: authority.publicKey.toBase58(),
        mintAuthority: authority.publicKey.toBase58(),
      });

      const sig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
      });
      await connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        "confirmed",
      );

      const up = await sb
        .from("spark_usd_claims")
        .update({ tx_signature: sig })
        .eq("id", rowId);
      if (up.error) {
        console.error("[predicted][spark-usd/claim] mint ok DB update failed", up.error);
      }

      return NextResponse.json({
        txSignature: sig,
        amountAtoms: SPARK_USD_FAUCET_CLAIM_AMOUNT_ATOMS.toString(),
        mint: mintPk.toBase58(),
      });
    } catch (e) {
      await sb.from("spark_usd_claims").delete().eq("id", rowId);
      const message = claimErrorForClient(
        e instanceof Error ? e.message : String(e),
      );
      return NextResponse.json({ error: message }, { status: 502 });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid request body";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

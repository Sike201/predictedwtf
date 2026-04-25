import { Connection, PublicKey } from "@solana/web3.js";
import {
  AccountLayout,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getMint,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import { OUTCOME_MINT_DECIMALS } from "@/lib/solana/create-outcome-mints";
import { decodeOmnipairPairAccount } from "@/lib/solana/decode-omnipair-accounts";
import { getOmnipairProgramId } from "@/lib/solana/omnipair-program";
import { getUserPositionPDA, orderMints } from "@/lib/solana/omnipair-pda";
import { readPmammLpSnapshot } from "@/lib/solana/pmamm-read-lp";
import {
  debtAtomsFromShares,
  decodeUserPositionAccount,
} from "@/lib/solana/read-omnipair-position";
import { getSupabaseAdmin } from "@/lib/supabase/server-client";

export type WalletPortfolioPosition = {
  slug: string;
  title: string;
  marketEngine: "GAMM" | "PM_AMM";
  resolutionStatus: string;
  yesAtoms: string;
  noAtoms: string;
  outcomeDecimals: number;
  lpAtoms: string;
  lpDecimals: number;
  leverage: null | {
    collateralYesAtoms: string;
    collateralNoAtoms: string;
    debtYesAtoms: string;
    debtNoAtoms: string;
  };
};

type DbRow = {
  slug: string;
  title: string;
  pool_address: string;
  yes_mint: string;
  no_mint: string;
  market_engine: string | null;
  resolution_status: string | null;
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

async function batchGetMultipleAccountsInfo(
  connection: Connection,
  keys: PublicKey[],
  chunkSize = 100,
): Promise<(import("@solana/web3.js").AccountInfo<Buffer> | null)[]> {
  const out: (import("@solana/web3.js").AccountInfo<Buffer> | null)[] = [];
  for (const part of chunk(keys, chunkSize)) {
    const partRes = await connection.getMultipleAccountsInfo(part, "confirmed");
    out.push(...partRes);
  }
  return out;
}

/**
 * Live markets with pools — includes resolved markets so redeemable / LP positions still show.
 */
export async function loadWalletPortfolioPositions(
  owner: PublicKey,
  connection: Connection,
): Promise<WalletPortfolioPosition[]> {
  const sb = getSupabaseAdmin();
  if (!sb) return [];

  const { data, error } = await sb
    .from("markets")
    .select(
      "slug,title,pool_address,yes_mint,no_mint,market_engine,resolution_status",
    )
    .eq("status", "live")
    .not("pool_address", "is", null)
    .not("yes_mint", "is", null)
    .not("no_mint", "is", null)
    .order("created_at", { ascending: false })
    .limit(400);

  if (error || !data?.length) {
    if (error) {
      console.error("[predicted][portfolio] db", error.message);
    }
    return [];
  }

  const rows = data as DbRow[];
  const programId = getOmnipairProgramId();

  type MarketWork = {
    row: DbRow;
    yesMint: PublicKey;
    noMint: PublicKey;
    poolPk: PublicKey;
    isPmamm: boolean;
    yesAta: PublicKey;
    noAta: PublicKey;
  };

  const work: MarketWork[] = [];
  for (const row of rows) {
    try {
      const yesMint = new PublicKey(row.yes_mint);
      const noMint = new PublicKey(row.no_mint);
      const poolPk = new PublicKey(row.pool_address);
      const isPmamm = row.market_engine === "PM_AMM";
      const yesAta = getAssociatedTokenAddressSync(
        yesMint,
        owner,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );
      const noAta = getAssociatedTokenAddressSync(
        noMint,
        owner,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );
      work.push({
        row,
        yesMint,
        noMint,
        poolPk,
        isPmamm,
        yesAta,
        noAta,
      });
    } catch {
      continue;
    }
  }

  if (work.length === 0) return [];

  const outcomeKeys: PublicKey[] = [];
  const outcomeKeyIndex: { w: MarketWork; side: "yes" | "no" }[] = [];
  for (const w of work) {
    outcomeKeyIndex.push({ w, side: "yes" });
    outcomeKeys.push(w.yesAta);
    outcomeKeyIndex.push({ w, side: "no" });
    outcomeKeys.push(w.noAta);
  }

  const outcomeInfos = await batchGetMultipleAccountsInfo(
    connection,
    outcomeKeys,
  );

  const yesAtomsBySlug = new Map<string, bigint>();
  const noAtomsBySlug = new Map<string, bigint>();
  for (let i = 0; i < outcomeKeyIndex.length; i++) {
    const { w, side } = outcomeKeyIndex[i]!;
    const info = outcomeInfos[i];
    let atoms = 0n;
    if (info?.data && info.data.length >= AccountLayout.span) {
      atoms = AccountLayout.decode(info.data).amount;
    }
    const slug = w.row.slug;
    if (side === "yes") yesAtomsBySlug.set(slug, atoms);
    else noAtomsBySlug.set(slug, atoms);
  }

  const gammWork = work.filter((w) => !w.isPmamm);
  const pairBySlug = new Map<
    string,
    ReturnType<typeof decodeOmnipairPairAccount>
  >();

  if (gammWork.length > 0) {
    const pairKeys = gammWork.map((w) => w.poolPk);
    const pairInfos = await batchGetMultipleAccountsInfo(connection, pairKeys);
    for (let i = 0; i < gammWork.length; i++) {
      const w = gammWork[i]!;
      const info = pairInfos[i];
      if (!info?.data) continue;
      try {
        pairBySlug.set(w.row.slug, decodeOmnipairPairAccount(Buffer.from(info.data)));
      } catch {
        continue;
      }
    }
  }

  const lpAtomsBySlug = new Map<string, bigint>();
  const lpDecimalsBySlug = new Map<string, number>();

  const gammLpJobs: { w: MarketWork; lpAta: PublicKey; lpMint: PublicKey }[] =
    [];
  for (const w of gammWork) {
    const decoded = pairBySlug.get(w.row.slug);
    if (!decoded) continue;
    const lpMint = decoded.lpMint;
    const lpAta = getAssociatedTokenAddressSync(
      lpMint,
      owner,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    gammLpJobs.push({ w, lpAta, lpMint });
  }

  if (gammLpJobs.length > 0) {
    const lpInfos = await batchGetMultipleAccountsInfo(
      connection,
      gammLpJobs.map((j) => j.lpAta),
    );
    const needsMintDecimals = new Map<string, PublicKey>();
    for (let i = 0; i < gammLpJobs.length; i++) {
      const job = gammLpJobs[i]!;
      const info = lpInfos[i];
      let atoms = 0n;
      if (info?.data && info.data.length >= AccountLayout.span) {
        atoms = AccountLayout.decode(info.data).amount;
      }
      lpAtomsBySlug.set(job.w.row.slug, atoms);
      if (atoms > 0n) {
        needsMintDecimals.set(job.lpMint.toBase58(), job.lpMint);
      }
    }
    for (const lpMint of needsMintDecimals.values()) {
      try {
        const m = await getMint(connection, lpMint, "confirmed", TOKEN_PROGRAM_ID);
        for (const job of gammLpJobs) {
          if (job.lpMint.equals(lpMint)) {
            lpDecimalsBySlug.set(job.w.row.slug, m.decimals);
          }
        }
      } catch {
        for (const job of gammLpJobs) {
          if (job.lpMint.equals(lpMint) && !lpDecimalsBySlug.has(job.w.row.slug)) {
            lpDecimalsBySlug.set(job.w.row.slug, OUTCOME_MINT_DECIMALS);
          }
        }
      }
    }
    for (const job of gammLpJobs) {
      if (!lpDecimalsBySlug.has(job.w.row.slug)) {
        lpDecimalsBySlug.set(job.w.row.slug, OUTCOME_MINT_DECIMALS);
      }
    }
  }

  const pmammWork = work.filter((w) => w.isPmamm);
  for (let i = 0; i < pmammWork.length; i += 6) {
    const slice = pmammWork.slice(i, i + 6);
    await Promise.all(
      slice.map(async (w) => {
        try {
          const snap = await readPmammLpSnapshot({
            connection,
            marketPda: w.poolPk,
            owner,
          });
          lpAtomsBySlug.set(w.row.slug, snap?.userShares ?? 0n);
          lpDecimalsBySlug.set(w.row.slug, 0);
        } catch {
          lpAtomsBySlug.set(w.row.slug, 0n);
          lpDecimalsBySlug.set(w.row.slug, 0);
        }
      }),
    );
  }

  const leverageBySlug = new Map<string, WalletPortfolioPosition["leverage"]>();

  if (gammWork.length > 0) {
    const levKeys: { slug: string; pda: PublicKey }[] = [];
    for (const w of gammWork) {
      if (!pairBySlug.has(w.row.slug)) continue;
      const [pda] = getUserPositionPDA(programId, w.poolPk, owner);
      levKeys.push({ slug: w.row.slug, pda });
    }
    if (levKeys.length > 0) {
      const levInfos = await batchGetMultipleAccountsInfo(
        connection,
        levKeys.map((k) => k.pda),
      );
      for (let i = 0; i < levKeys.length; i++) {
        const { slug } = levKeys[i]!;
        const info = levInfos[i];
        const pairDecoded = pairBySlug.get(slug);
        if (!info?.data || !pairDecoded) {
          leverageBySlug.set(slug, null);
          continue;
        }
        try {
          const raw = decodeUserPositionAccount(Buffer.from(info.data));
          const w = gammWork.find((x) => x.row.slug === slug);
          if (!w) continue;
          const [token0Mint] = orderMints(w.yesMint, w.noMint);
          const yesIsToken0 = w.yesMint.equals(token0Mint);

          const debt0Atoms = debtAtomsFromShares(
            raw.debt0Shares,
            pairDecoded.totalDebt0,
            pairDecoded.totalDebt0Shares,
          );
          const debt1Atoms = debtAtomsFromShares(
            raw.debt1Shares,
            pairDecoded.totalDebt1,
            pairDecoded.totalDebt1Shares,
          );

          const collateralYesAtoms = yesIsToken0 ? raw.collateral0 : raw.collateral1;
          const collateralNoAtoms = yesIsToken0 ? raw.collateral1 : raw.collateral0;
          const debtYesAtoms = yesIsToken0 ? debt0Atoms : debt1Atoms;
          const debtNoAtoms = yesIsToken0 ? debt1Atoms : debt0Atoms;

          const hasLev =
            collateralYesAtoms > 0n ||
            collateralNoAtoms > 0n ||
            debtYesAtoms > 0n ||
            debtNoAtoms > 0n;

          leverageBySlug.set(
            slug,
            hasLev
              ? {
                  collateralYesAtoms: collateralYesAtoms.toString(),
                  collateralNoAtoms: collateralNoAtoms.toString(),
                  debtYesAtoms: debtYesAtoms.toString(),
                  debtNoAtoms: debtNoAtoms.toString(),
                }
              : null,
          );
        } catch {
          leverageBySlug.set(slug, null);
        }
      }
    }
  }

  const positions: WalletPortfolioPosition[] = [];

  for (const w of work) {
    const slug = w.row.slug;
    const yesAtoms = yesAtomsBySlug.get(slug) ?? 0n;
    const noAtoms = noAtomsBySlug.get(slug) ?? 0n;
    const lpAtoms = lpAtomsBySlug.get(slug) ?? 0n;
    const lev = w.isPmamm ? null : (leverageBySlug.get(slug) ?? null);

    const hasAnything =
      yesAtoms > 0n ||
      noAtoms > 0n ||
      lpAtoms > 0n ||
      (lev != null &&
        (BigInt(lev.collateralYesAtoms) > 0n ||
          BigInt(lev.collateralNoAtoms) > 0n ||
          BigInt(lev.debtYesAtoms) > 0n ||
          BigInt(lev.debtNoAtoms) > 0n));

    if (!hasAnything) continue;

    positions.push({
      slug,
      title: w.row.title,
      marketEngine: w.isPmamm ? "PM_AMM" : "GAMM",
      resolutionStatus: w.row.resolution_status ?? "active",
      yesAtoms: yesAtoms.toString(),
      noAtoms: noAtoms.toString(),
      outcomeDecimals: OUTCOME_MINT_DECIMALS,
      lpAtoms: lpAtoms.toString(),
      lpDecimals: lpDecimalsBySlug.get(slug) ?? (w.isPmamm ? 0 : OUTCOME_MINT_DECIMALS),
      leverage: lev,
    });
  }

  return positions;
}

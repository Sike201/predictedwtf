import {
  Connection,
  PublicKey,
  SystemProgram,
  type Transaction,
} from "@solana/web3.js";

import { createPmammProgram } from "@/lib/solana/pmamm-program";
import { getPmammCollateralMint } from "@/lib/solana/pmamm-config";
import type { GetPmammMarketAddressOk } from "@/lib/solana/pmamm-market-address-from-row";

export const PMAMM_RESOLVE_ERROR_CODE = {
  PROGRAM_ENV_MISMATCH: "PMAMM_PROGRAM_ENV_MISMATCH",
  INVALID_MARKET_ACCOUNT: "PMAMM_INVALID_MARKET_ACCOUNT",
  AUTHORITY_MISMATCH: "PMAMM_AUTHORITY_MISMATCH",
} as const;

export type ValidatePmammMarketResolveContext = {
  slug: string;
  addressSource: GetPmammMarketAddressOk["source"];
  rpcUrl: string;
  networkEnv?: string | null;
  pmammProgramIdEnv?: string | null;
  supabaseSnapshot: {
    market_engine: string | null;
    pool_address: string | null;
    pmamm_market_address: string | null;
    market_address: string | null;
    pmamm_market_id: string | null;
    yes_mint: string | null;
    no_mint: string | null;
    onchain_program_id: string | null;
  };
  createdTxSignature: string | null;
};

export type ValidatePmammMarketResolveResult =
  | {
      ok: true;
      warnings: string[];
      authority: PublicKey | null;
    }
  | {
      ok: false;
      errorCode: (typeof PMAMM_RESOLVE_ERROR_CODE)[keyof typeof PMAMM_RESOLVE_ERROR_CODE];
      message: string;
      developerDetail?: string;
      discriminatorReceivedHex?: string;
    };

function trimPk(s: string | null | undefined): string | null {
  const t = s?.trim();
  return t?.length ? t : null;
}

export async function validatePmammMarketAccountBeforeResolve(
  connection: Connection,
  programId: PublicKey,
  marketPda: PublicKey,
  ctx: ValidatePmammMarketResolveContext,
): Promise<ValidatePmammMarketResolveResult> {
  const envId = trimPk(ctx.pmammProgramIdEnv);
  if (envId && envId !== programId.toBase58()) {
    return {
      ok: false,
      errorCode: PMAMM_RESOLVE_ERROR_CODE.PROGRAM_ENV_MISMATCH,
      message:
        "NEXT_PUBLIC_PMAMM_PROGRAM_ID does not match the program id used for this resolve.",
      developerDetail: `env=${envId}, resolve_program_id=${programId.toBase58()}`,
    };
  }

  const rowProg = trimPk(ctx.supabaseSnapshot.onchain_program_id);
  if (rowProg && rowProg !== programId.toBase58()) {
    return {
      ok: false,
      errorCode: PMAMM_RESOLVE_ERROR_CODE.PROGRAM_ENV_MISMATCH,
      message:
        "Stored onchain_program_id for this market does not match NEXT_PUBLIC_PMAMM_PROGRAM_ID.",
      developerDetail: `row_onchain_program_id=${rowProg}, resolve_program_id=${programId.toBase58()}`,
    };
  }

  const warnings: string[] = [];

  const program = createPmammProgram(connection, SystemProgram.programId);
  try {
    type MarketAcc = {
      authority: PublicKey;
      collateralMint: PublicKey;
      yesMint: PublicKey;
      noMint: PublicKey;
    };
    const fetched = await (
      program as unknown as {
        account: { market: { fetch: (p: PublicKey) => Promise<MarketAcc> } };
      }
    ).account.market.fetch(marketPda);

    const collateral = getPmammCollateralMint();
    try {
      if (!collateral.equals(fetched.collateralMint)) {
        warnings.push(
          `Collateral mint differs from NEXT_PUBLIC_PMAMM_USDC_MINT (chain=${fetched.collateralMint.toBase58()}, env_collateral_expected=${collateral.toBase58()}).`,
        );
      }
    } catch {
      /* ignore malformed env mint */
    }

    let authority: PublicKey | null = fetched.authority ?? null;

    const yesDb = trimPk(ctx.supabaseSnapshot.yes_mint);
    const noDb = trimPk(ctx.supabaseSnapshot.no_mint);
    if (yesDb) {
      try {
        if (!new PublicKey(yesDb).equals(fetched.yesMint)) {
          return {
            ok: false,
            errorCode: PMAMM_RESOLVE_ERROR_CODE.INVALID_MARKET_ACCOUNT,
            message:
              "yes_mint in the database does not match this pmAMM market account on-chain.",
            developerDetail: `db_yes_mint=${yesDb}, chain_yes_mint=${fetched.yesMint.toBase58()}, market=${marketPda.toBase58()}`,
          };
        }
      } catch {
        return {
          ok: false,
          errorCode: PMAMM_RESOLVE_ERROR_CODE.INVALID_MARKET_ACCOUNT,
          message:
            'Invalid yes_mint in database (cannot parse as PublicKey).',
          developerDetail: `db_yes_mint=${yesDb}`,
        };
      }
    }
    if (noDb) {
      try {
        if (!new PublicKey(noDb).equals(fetched.noMint)) {
          return {
            ok: false,
            errorCode: PMAMM_RESOLVE_ERROR_CODE.INVALID_MARKET_ACCOUNT,
            message:
              "no_mint in the database does not match this pmAMM market account on-chain.",
            developerDetail: `db_no_mint=${noDb}, chain_no_mint=${fetched.noMint.toBase58()}, market=${marketPda.toBase58()}`,
          };
        }
      } catch {
        return {
          ok: false,
          errorCode: PMAMM_RESOLVE_ERROR_CODE.INVALID_MARKET_ACCOUNT,
          message:
            'Invalid no_mint in database (cannot parse as PublicKey).',
          developerDetail: `db_no_mint=${noDb}`,
        };
      }
    }

    if (ctx.supabaseSnapshot.market_engine !== "PM_AMM") {
      warnings.push(
        `resolve addressSource=${ctx.addressSource} but market_engine in DB is not PM_AMM (got ${ctx.supabaseSnapshot.market_engine}).`,
      );
    }

    return { ok: true, warnings, authority };
  } catch (e) {
    const basis = e instanceof Error ? e.message : String(e);
    let discriminatorReceivedHex: string | undefined;

    try {
      const info = await connection.getAccountInfo(marketPda, "confirmed");
      if (info?.data && info.data.length >= 8) {
        discriminatorReceivedHex = Buffer.from(info.data.subarray(0, 8)).toString("hex");
      }
    } catch {
      /* ignore */
    }

    return {
      ok: false,
      errorCode: PMAMM_RESOLVE_ERROR_CODE.INVALID_MARKET_ACCOUNT,
      message:
        "Could not load a pmAMM market account at this address (wrong program, uninitialized account, or IDL mismatch).",
      developerDetail: `${basis} market_pda=${marketPda.toBase58()} slug=${ctx.slug}`,
      discriminatorReceivedHex,
    };
  }
}

export function friendlyMessageForPmammResolveRpcFailure(raw: string): string {
  const trimmed = raw.trim();
  if (/AccountNotFound/i.test(trimmed)) {
    return "On-chain account not found — check that the resolved market PDAs matches devnet.";
  }
  if (/InstructionFallbackNotFound/i.test(trimmed)) {
    return "Anchor could not deserialize the instruction — redeploy/program id mismatch.";
  }
  if (/already been processed|AlreadyProcessed/i.test(trimmed)) {
    return "Transaction duplicate — retry with a fresh blockhash if needed.";
  }
  return trimmed;
}

export function logPmammResolveMarketInstructionAccounts(opts: {
  tx: Transaction;
  programId: PublicKey;
  slug: string;
  walletLabel: string;
}): void {
  const { tx, programId, slug, walletLabel } = opts;
  for (let i = 0; i < tx.instructions.length; i++) {
    const ix = tx.instructions[i];
    if (!ix.programId.equals(programId)) continue;
    console.info("[predicted][pmamm-resolve]", "instruction_accounts", {
      slug,
      walletLabel,
      ixIndex: i,
      programId: ix.programId.toBase58(),
      accounts: ix.keys.map((m) => ({
        pubkey: m.pubkey.toBase58(),
        isSigner: m.isSigner,
        isWritable: m.isWritable,
      })),
    });
  }
}

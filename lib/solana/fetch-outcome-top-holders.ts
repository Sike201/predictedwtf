import {
  ACCOUNT_SIZE,
  TOKEN_PROGRAM_ID,
  unpackAccount,
  getMint,
} from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";

import { formatBaseUnitsToDecimalString } from "@/lib/solana/wallet-token-balances";

export type OutcomeHolderEntry = {
  rank: number;
  /** Wallet that owns the SPL token account */
  owner: string;
  amountUi: string;
};

async function topHoldersFromProgramAccounts(
  connection: Connection,
  mint: PublicKey,
  decimals: number,
  excludeTokenAccounts: Set<string>,
  topN: number,
): Promise<{ owner: string; amount: bigint }[]> {
  const accounts = await connection.getProgramAccounts(TOKEN_PROGRAM_ID, {
    commitment: "confirmed",
    filters: [
      { dataSize: ACCOUNT_SIZE },
      { memcmp: { offset: 0, bytes: mint.toBase58() } },
    ],
  });

  const rows: { owner: string; amount: bigint }[] = [];
  for (const { pubkey, account } of accounts) {
    if (!account.data || account.data.length < ACCOUNT_SIZE) continue;
    if (excludeTokenAccounts.has(pubkey.toBase58())) continue;
    try {
      const raw = unpackAccount(pubkey, account, TOKEN_PROGRAM_ID);
      if (raw.amount === 0n) continue;
      rows.push({
        owner: raw.owner.toBase58(),
        amount: raw.amount,
      });
    } catch {
      /* malformed */
    }
  }

  rows.sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
  return rows.slice(0, topN);
}

async function topHoldersFromLargestAccounts(
  connection: Connection,
  mint: PublicKey,
  excludeTokenAccounts: Set<string>,
  topN: number,
): Promise<{ owner: string; amount: bigint }[]> {
  const res = await connection.getTokenLargestAccounts(mint, "confirmed");
  const pairs = res.value.filter(
    (p) => !excludeTokenAccounts.has(p.address.toBase58()),
  );

  const infos = await connection.getMultipleAccountsInfo(
    pairs.map((p) => p.address),
    "confirmed",
  );

  const rows: { owner: string; amount: bigint }[] = [];
  for (let i = 0; i < pairs.length; i++) {
    const addr = pairs[i]!.address;
    const info = infos[i];
    if (!info?.data) continue;
    try {
      const raw = unpackAccount(addr, info, TOKEN_PROGRAM_ID);
      if (raw.amount === 0n) continue;
      rows.push({
        owner: raw.owner.toBase58(),
        amount: raw.amount,
      });
    } catch {
      /* skip */
    }
  }

  rows.sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
  return rows.slice(0, topN);
}

function toEntries(
  rows: { owner: string; amount: bigint }[],
  decimals: number,
): OutcomeHolderEntry[] {
  return rows.map((r, i) => ({
    rank: i + 1,
    owner: r.owner,
    amountUi: formatBaseUnitsToDecimalString(r.amount, decimals, 6),
  }));
}

const TOP_PER_SIDE = 50;

/**
 * Top wallet holders of YES and NO outcome mints (excludes pool reserve vault ATAs).
 * Uses `getProgramAccounts` when possible; falls back to `getTokenLargestAccounts` (max ~20/side on RPC).
 */
export async function fetchOutcomeTopHolders(
  connection: Connection,
  params: {
    yesMint: PublicKey;
    noMint: PublicKey;
    excludeTokenAccounts: PublicKey[];
  },
): Promise<{ yes: OutcomeHolderEntry[]; no: OutcomeHolderEntry[]; decimals: number }> {
  const exclude = new Set(params.excludeTokenAccounts.map((p) => p.toBase58()));

  const mintInfo = await getMint(connection, params.yesMint);
  const decimals = mintInfo.decimals;

  async function load(mint: PublicKey): Promise<OutcomeHolderEntry[]> {
    try {
      const rows = await topHoldersFromProgramAccounts(
        connection,
        mint,
        decimals,
        exclude,
        TOP_PER_SIDE,
      );
      return toEntries(rows, decimals);
    } catch (e) {
      console.warn(
        "[predicted][outcome-holders] GPA failed, using largest accounts",
        e,
      );
      const rows = await topHoldersFromLargestAccounts(
        connection,
        mint,
        exclude,
        TOP_PER_SIDE,
      );
      return toEntries(rows, decimals);
    }
  }

  const [yes, no] = await Promise.all([load(params.yesMint), load(params.noMint)]);

  return { yes, no, decimals };
}

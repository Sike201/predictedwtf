import type { Connection, PublicKey } from "@solana/web3.js";

import {
  createPmammProgram,
  fetchPmammMarketAccount,
} from "@/lib/solana/pmamm-program";
import { derivePmammLpPda } from "@/lib/solana/pmamm-pda";
import { requirePmammProgramId } from "@/lib/solana/pmamm-config";

async function fetchLpPositionShares(
  program: ReturnType<typeof createPmammProgram>,
  lpPda: PublicKey,
): Promise<bigint> {
  type Lp = { shares: { toString: () => string } };
  const raw = program as unknown as {
    account: { lpPosition: { fetch: (p: PublicKey) => Promise<Lp> } };
  };
  const lp = await raw.account.lpPosition.fetch(lpPda);
  return BigInt(lp.shares.toString());
}

export async function readPmammLpSnapshot(params: {
  connection: Connection;
  marketPda: PublicKey;
  owner: PublicKey;
}): Promise<{
  lpPositionPda: string;
  userShares: bigint;
  totalLpShares: bigint;
} | null> {
  const programId = requirePmammProgramId();
  const lpPda = derivePmammLpPda(
    params.marketPda,
    params.owner,
    programId,
  );
  const info = await params.connection.getAccountInfo(lpPda, "confirmed");
  if (!info?.data?.length) {
    return {
      lpPositionPda: lpPda.toBase58(),
      userShares: 0n,
      totalLpShares: 0n,
    };
  }
  const program = createPmammProgram(params.connection, params.owner);
  const [userShares, market] = await Promise.all([
    fetchLpPositionShares(program, lpPda),
    fetchPmammMarketAccount(program, params.marketPda),
  ]);
  return {
    lpPositionPda: lpPda.toBase58(),
    userShares,
    totalLpShares: market.totalLpShares,
  };
}

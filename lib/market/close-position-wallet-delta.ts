import type { Connection, PublicKey } from "@solana/web3.js";

import {
  readOutcomeBalances,
  readUsdcBalance,
} from "@/lib/solana/wallet-token-balances";

export type WalletOutcomeSnapshot = {
  yesRaw: bigint;
  noRaw: bigint;
  usdcRaw: bigint;
  yesDecimals: number;
  noDecimals: number;
  usdcDecimals: number;
};

export async function readWalletOutcomeSnapshot(params: {
  connection: Connection;
  owner: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
}): Promise<WalletOutcomeSnapshot> {
  const { connection, owner, yesMint, noMint } = params;
  const [o, u] = await Promise.all([
    readOutcomeBalances(connection, owner, yesMint, noMint),
    readUsdcBalance(connection, owner),
  ]);
  return {
    yesRaw: o.yes.raw,
    noRaw: o.no.raw,
    usdcRaw: u.raw,
    yesDecimals: o.yes.decimals,
    noDecimals: o.no.decimals,
    usdcDecimals: u.decimals,
  };
}

/** Net tokens credited to the wallet between snapshots (close + any same-slot activity). */
export function walletOutcomeReturnDelta(
  before: WalletOutcomeSnapshot,
  after: WalletOutcomeSnapshot,
): { returnedYes: bigint; returnedNo: bigint } {
  const returnedYes = after.yesRaw > before.yesRaw ? after.yesRaw - before.yesRaw : 0n;
  const returnedNo = after.noRaw > before.noRaw ? after.noRaw - before.noRaw : 0n;
  return { returnedYes, returnedNo };
}

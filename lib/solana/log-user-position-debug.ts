/**
 * Client-side diagnostics for Omnipair user position after leverage txs.
 */
import type { Connection, PublicKey } from "@solana/web3.js";

import { decodeUserPositionAccount } from "@/lib/solana/read-omnipair-position";
import { getUserPositionPDA } from "@/lib/solana/omnipair-pda";
import { requireOmnipairProgramId } from "@/lib/solana/omnipair-program";

const TAG = "[predicted][leverage][position-debug]";

export async function logUserPositionAccountAfterLeverageTx(params: {
  connection: Connection;
  pairAddress: PublicKey;
  user: PublicKey;
}): Promise<void> {
  try {
    const programId = requireOmnipairProgramId();
    const [pda] = getUserPositionPDA(
      programId,
      params.pairAddress,
      params.user,
    );
    const info = await params.connection.getAccountInfo(pda, "confirmed");
    let decodeOk = false;
    let decodeError: string | undefined;
    if (info?.data && info.data.length > 0) {
      try {
        decodeUserPositionAccount(Buffer.from(info.data));
        decodeOk = true;
      } catch (e) {
        decodeError = e instanceof Error ? e.message : String(e);
      }
    }
    console.info(
      TAG,
      JSON.stringify({
        derivedUserPositionPda: pda.toBase58(),
        accountExists: !!info,
        dataLength: info?.data.length ?? 0,
        decodeSucceeded: decodeOk,
        decodeError: decodeError ?? null,
      }),
    );
  } catch (e) {
    console.warn(
      TAG,
      "diagnostic_failed",
      e instanceof Error ? e.message : String(e),
    );
  }
}

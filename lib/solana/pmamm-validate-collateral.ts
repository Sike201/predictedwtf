import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";

/**
 * Validates SPL mint before pmAMM `initialize_market` (program requires 6 decimals).
 */
export async function validatePmammCollateralMint(
  connection: Connection,
  mint: PublicKey,
): Promise<void> {
  const info = await getMint(connection, mint, "confirmed");
  const authority =
    info.mintAuthority === null ? null : info.mintAuthority.toBase58();
  console.info("[predicted][pmamm] collateral mint", {
    address: mint.toBase58(),
    decimals: info.decimals,
    mintAuthority: authority,
  });
  if (info.decimals !== 6) {
    throw new Error(
      `pmAMM requires USDC with 6 decimals; mint ${mint.toBase58()} has decimals=${info.decimals}.`,
    );
  }
}

import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

const MARKET_SEED = Buffer.from("market");
const YES_MINT_SEED = Buffer.from("yes_mint");
const NO_MINT_SEED = Buffer.from("no_mint");
const VAULT_SEED = Buffer.from("vault");
const LP_SEED = Buffer.from("lp");

/** Metaplex token metadata program */
export const PMAMM_TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);

export function pmammMetadataPda(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      PMAMM_TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    PMAMM_TOKEN_METADATA_PROGRAM_ID,
  );
  return pda;
}

export function derivePmammMarketPdas(marketId: BN, programId: PublicKey) {
  const [marketPda, marketBump] = PublicKey.findProgramAddressSync(
    [MARKET_SEED, marketId.toArrayLike(Buffer, "le", 8)],
    programId,
  );
  const [yesMint] = PublicKey.findProgramAddressSync(
    [YES_MINT_SEED, marketPda.toBuffer()],
    programId,
  );
  const [noMint] = PublicKey.findProgramAddressSync(
    [NO_MINT_SEED, marketPda.toBuffer()],
    programId,
  );
  const [vault] = PublicKey.findProgramAddressSync(
    [VAULT_SEED, marketPda.toBuffer()],
    programId,
  );
  return { marketPda, marketBump, yesMint, noMint, vault };
}

export function derivePmammLpPda(
  marketPda: PublicKey,
  owner: PublicKey,
  programId: PublicKey,
): PublicKey {
  const [lp] = PublicKey.findProgramAddressSync(
    [LP_SEED, marketPda.toBuffer(), owner.toBuffer()],
    programId,
  );
  return lp;
}

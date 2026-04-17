import { Keypair, PublicKey } from "@solana/web3.js";

let devProgramId: PublicKey | null = null;

/** Program id for PDA math when no deploy is configured (mock / dry layout only). */
export function getOmnipairProgramId(): PublicKey {
  const raw = process.env.NEXT_PUBLIC_OMNIPAIR_PROGRAM_ID?.trim();
  if (raw) return new PublicKey(raw);
  if (!devProgramId) {
    console.warn(
      "[predicted][omnipair-program] NEXT_PUBLIC_OMNIPAIR_PROGRAM_ID is unset — using deterministic dev-only pubkey for mock PDA layout; real RPC sends require a deployed Omnipair program id.",
    );
    const s = new Uint8Array(32);
    s.set(Buffer.from("predicted.omnipair.dev.v1"));
    devProgramId = Keypair.fromSeed(s).publicKey;
  }
  return devProgramId;
}

/** Required for real transactions — throws if `NEXT_PUBLIC_OMNIPAIR_PROGRAM_ID` is missing. */
export function requireOmnipairProgramId(): PublicKey {
  const raw = process.env.NEXT_PUBLIC_OMNIPAIR_PROGRAM_ID?.trim();
  if (!raw) {
    throw new Error(
      "Set NEXT_PUBLIC_OMNIPAIR_PROGRAM_ID to your deployed Omnipair program on devnet.",
    );
  }
  return new PublicKey(raw);
}

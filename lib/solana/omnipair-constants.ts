import { PublicKey } from "@solana/web3.js";

/** https://github.com/omnipair/omnipair-rs — `programs/omnipair/src/constants.rs` */
export const OMNIPAIR_PROTOCOL_VERSION = 1;

export const PAIR_SEED_PREFIX = Buffer.from("gamm_pair", "utf8");
/** Per-user lending position — `programs/omnipair/src/constants.rs` `POSITION_SEED_PREFIX`. */
export const POSITION_SEED_PREFIX = Buffer.from("gamm_position", "utf8");
export const RESERVE_VAULT_SEED_PREFIX = Buffer.from("reserve_vault", "utf8");
export const COLLATERAL_VAULT_SEED_PREFIX = Buffer.from(
  "collateral_vault",
  "utf8",
);
/** Single global PDA — not per-pair. */
export const FUTARCHY_AUTHORITY_SEED_PREFIX = Buffer.from(
  "futarchy_authority",
  "utf8",
);

/** Metaplex Token Metadata (same seed layout as Anchor `METADATA_SEED_PREFIX`). */
export const MPL_TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);

export const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
);

export const PAIR_CREATION_FEE_LAMPORTS = 200_000_000n; // 0.2 SOL — omnipair-rs constants

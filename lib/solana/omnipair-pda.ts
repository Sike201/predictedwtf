import { PublicKey } from "@solana/web3.js";

import {
  COLLATERAL_VAULT_SEED_PREFIX,
  FUTARCHY_AUTHORITY_SEED_PREFIX,
  PAIR_SEED_PREFIX,
  POSITION_SEED_PREFIX,
  RESERVE_VAULT_SEED_PREFIX,
  MPL_TOKEN_METADATA_PROGRAM_ID,
} from "@/lib/solana/omnipair-constants";
import {
  computeOmnipairParamsHash,
  DEFAULT_OMNIPAIR_POOL_PARAMS,
  type OmnipairParamsHashInput,
} from "@/lib/solana/omnipair-params-hash";

/**
 * Omnipair enforces `token1_mint.key() > token0_mint.key()` (lexicographic).
 * Smaller pubkey → token0, larger → token1.
 */
export function orderMints(
  a: PublicKey,
  b: PublicKey,
): readonly [PublicKey, PublicKey] {
  const cmp = Buffer.compare(a.toBuffer(), b.toBuffer());
  if (cmp === 0) throw new Error("orderMints: identical mint addresses");
  return cmp < 0 ? ([a, b] as const) : ([b, a] as const);
}

/** Pair PDA — `omnipair-rs`: seeds `[b"gamm_pair", token0, token1, params_hash]`. */
export function getPairPDA(
  programId: PublicKey,
  token0Mint: PublicKey,
  token1Mint: PublicKey,
  paramsHash: Buffer,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      PAIR_SEED_PREFIX,
      token0Mint.toBuffer(),
      token1Mint.toBuffer(),
      paramsHash.subarray(0, 32),
    ],
    programId,
  );
}

/** @deprecated Use `getPairPDA` + `computeOmnipairParamsHash`. */
export function predictionMarketParamsHash(): Buffer {
  return computeOmnipairParamsHash(DEFAULT_OMNIPAIR_POOL_PARAMS);
}

/** Backwards-compatible alias for older call sites. */
export function getPoolPDA(
  programId: PublicKey,
  yesMint: PublicKey,
  noMint: PublicKey,
  paramsHash: Buffer,
): [PublicKey, number] {
  const [t0, t1] = orderMints(yesMint, noMint);
  return getPairPDA(programId, t0, t1, paramsHash);
}

/** Reserve vault — seeds `[b"reserve_vault", pair, mint]`. */
export function getReserveVaultPDA(
  programId: PublicKey,
  pair: PublicKey,
  mint: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [RESERVE_VAULT_SEED_PREFIX, pair.toBuffer(), mint.toBuffer()],
    programId,
  );
}

/** @deprecated Use `getReserveVaultPDA`. */
export function getVaultAPDA(
  programId: PublicKey,
  pair: PublicKey,
  token0Mint: PublicKey,
): [PublicKey, number] {
  return getReserveVaultPDA(programId, pair, token0Mint);
}

/** @deprecated Use `getReserveVaultPDA`. */
export function getVaultBPDA(
  programId: PublicKey,
  pair: PublicKey,
  token1Mint: PublicKey,
): [PublicKey, number] {
  return getReserveVaultPDA(programId, pair, token1Mint);
}

/**
 * User lending position PDA — `programs/omnipair/src/instructions/lending/add_collateral.rs`
 * seeds `[POSITION_SEED_PREFIX, pair, user]`.
 */
export function getUserPositionPDA(
  programId: PublicKey,
  pairAddress: PublicKey,
  user: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [POSITION_SEED_PREFIX, pairAddress.toBuffer(), user.toBuffer()],
    programId,
  );
}

/** Collateral vault — seeds `[b"collateral_vault", pair, mint]`. */
export function getCollateralVaultPDA(
  programId: PublicKey,
  pair: PublicKey,
  mint: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [COLLATERAL_VAULT_SEED_PREFIX, pair.toBuffer(), mint.toBuffer()],
    programId,
  );
}

/**
 * Global futarchy config PDA — seeds `[b"futarchy_authority"]` only
 * (`programs/omnipair/src/instructions/liquidity/initialize.rs`).
 */
export function getGlobalFutarchyAuthorityPDA(
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [FUTARCHY_AUTHORITY_SEED_PREFIX],
    programId,
  );
}

/** Anchor `#[event_cpi]` — `programs/omnipair` `InitializeAndBootstrap` appends this after `rent`. */
const EVENT_AUTHORITY_SEED = Buffer.from("__event_authority", "utf8");

export function getEventAuthorityPDA(programId: PublicKey): {
  publicKey: PublicKey;
  bump: number;
} {
  const [publicKey, bump] = PublicKey.findProgramAddressSync(
    [EVENT_AUTHORITY_SEED],
    programId,
  );
  return { publicKey, bump };
}

/** @deprecated Futarchy authority is global, not per-pair. Use `getGlobalFutarchyAuthorityPDA`. */
export function getFutarchyAuthorityPDA(
  programId: PublicKey,
  _pair: PublicKey,
): [PublicKey, number] {
  return getGlobalFutarchyAuthorityPDA(programId);
}

/** Metaplex token-metadata account for an LP mint. */
export function getLpTokenMetadataPDA(lpMint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata", "utf8"),
      MPL_TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      lpMint.toBuffer(),
    ],
    MPL_TOKEN_METADATA_PROGRAM_ID,
  );
  return pda;
}

export type DerivedOmnipairLayout = {
  paramsHash: Buffer;
  poolParams: OmnipairParamsHashInput;
  token0Mint: PublicKey;
  token1Mint: PublicKey;
  pairAddress: PublicKey;
  reserve0Vault: PublicKey;
  reserve1Vault: PublicKey;
  collateralForMint: (mint: PublicKey) => PublicKey;
};

export function deriveOmnipairLayout(
  programId: PublicKey,
  yesMint: PublicKey,
  noMint: PublicKey,
  poolParams: OmnipairParamsHashInput = DEFAULT_OMNIPAIR_POOL_PARAMS,
): DerivedOmnipairLayout {
  const paramsHash = computeOmnipairParamsHash(poolParams);
  const [token0Mint, token1Mint] = orderMints(yesMint, noMint);
  const [pairAddress] = getPairPDA(programId, token0Mint, token1Mint, paramsHash);
  const [reserve0] = getReserveVaultPDA(programId, pairAddress, token0Mint);
  const [reserve1] = getReserveVaultPDA(programId, pairAddress, token1Mint);
  return {
    paramsHash,
    poolParams,
    token0Mint,
    token1Mint,
    pairAddress,
    reserve0Vault: reserve0,
    reserve1Vault: reserve1,
    collateralForMint(mint: PublicKey) {
      return getCollateralVaultPDA(programId, pairAddress, mint)[0];
    },
  };
}

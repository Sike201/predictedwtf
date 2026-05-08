import { PublicKey } from "@solana/web3.js";

import { PMAMM_MARKET_RESOLVER_BODY_OFFSET } from "@/lib/solana/pmamm-config";

const DISC_LEN = 8;

/** `resolver` pubkey body offset for v2 accounts (`layout_version` byte, then resolver, then name). */
export const PMAMM_MARKET_RESOLVER_V2_BODY_OFFSET = PMAMM_MARKET_RESOLVER_BODY_OFFSET;

/**
 * Legacy chain layout: `name[64]` immediately after `bump`, then `resolver`, then `reserved`.
 * (No `layout_version` byte.)
 */
export const PMAMM_MARKET_LEGACY_NAME_START_BODY_OFFSET = 307;
export const PMAMM_MARKET_LEGACY_RESOLVER_BODY_OFFSET = 371;

/** When v2 had no `layout_version` byte, `resolver` started here, `name` at 339. */
export const PMAMM_MARKET_V1_RESOLVER_BEFORE_NAME_BODY_OFFSET = 307;
export const PMAMM_MARKET_V1_NAME_START_BODY_OFFSET = 339;

function absBody(bodyOffset: number): number {
  return DISC_LEN + bodyOffset;
}

function readPk(u8: Buffer, bodyOffset: number): string | null {
  const start = absBody(bodyOffset);
  if (u8.length < start + 32) return null;
  return new PublicKey(u8.subarray(start, start + 32)).toBase58();
}

function readUtf8Prefix(u8: Buffer, bodyOffset: number, len: number): string | null {
  const start = absBody(bodyOffset);
  if (u8.length < start + len) return null;
  return Buffer.from(u8.subarray(start, start + len))
    .toString("utf8")
    .replace(/\0+$/g, "");
}

/**
 * Temporary diagnostics: interpret the same bytes under multiple Market layouts
 * to see whether devnet matches IDL (resolver-before-name) or legacy name-before-resolver.
 */
export function logPmammMarketAccountRawLayoutProbe(opts: {
  label: string;
  rawData: Buffer;
  nextPublicPmammProgramId: string | null;
  anchorProgramId: string;
}): void {
  const u8 = opts.rawData;
  const discHex = u8.subarray(0, DISC_LEN).toString("hex");
  const authority = u8.length >= 40 ? new PublicKey(u8.subarray(8, 40)).toBase58() : null;

  const layoutVersionAtBody307 =
    u8.length > absBody(307) ? u8[absBody(307)] : null;

  const probe = {
    total_account_len: u8.length,
    discriminator_hex: discHex,
    authority_at_body0_abs8: authority,
    byte_at_body307_abs315_layoutVersion_or_legacy_name0: layoutVersionAtBody307,
    pubkey_read_as_resolver_v2_at_body308: readPk(u8, PMAMM_MARKET_RESOLVER_V2_BODY_OFFSET),
    pubkey_read_as_resolver_v1_no_lv_at_body307: readPk(u8, PMAMM_MARKET_V1_RESOLVER_BEFORE_NAME_BODY_OFFSET),
    pubkey_read_as_resolver_legacy_after_name_at_body371: readPk(
      u8,
      PMAMM_MARKET_LEGACY_RESOLVER_BODY_OFFSET,
    ),
    name_first32_utf8_v2_at_body340: readUtf8Prefix(u8, 340, 32),
    name_first32_utf8_v1_at_body339: readUtf8Prefix(u8, PMAMM_MARKET_V1_NAME_START_BODY_OFFSET, 32),
    name_first32_utf8_legacy_at_body307: readUtf8Prefix(
      u8,
      PMAMM_MARKET_LEGACY_NAME_START_BODY_OFFSET,
      32,
    ),
    NEXT_PUBLIC_PMAMM_PROGRAM_ID: opts.nextPublicPmammProgramId,
    anchor_program_programId: opts.anchorProgramId,
  };

  console.info(`[pmAMM market raw layout probe] ${opts.label}`, probe);
}

import { createHash } from "crypto";

/** Anchor ix discriminator (8 bytes): sha256("global:<name>")[0..8]. */
export function anchorDiscriminator(name: string): Buffer {
  return Buffer.from(
    createHash("sha256").update(`global:${name}`).digest().subarray(0, 8),
  );
}

export function u64le(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n, 0);
  return b;
}

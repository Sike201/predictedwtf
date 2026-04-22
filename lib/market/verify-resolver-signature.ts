import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";

import { TRUSTED_RESOLVER_ADDRESS } from "@/lib/market/trusted-resolver";

const enc = new TextEncoder();

/**
 * True if `signatureBase64` is a valid ed25519 detached signature on `message`
 * by `TRUSTED_RESOLVER_ADDRESS` (raw message bytes, Solana `signMessage` style).
 */
export function verifyTrustedResolverMessageSignature(
  message: string,
  signatureBase64: string,
): boolean {
  try {
    const msg = enc.encode(message);
    const raw = Buffer.from(signatureBase64.trim(), "base64");
    if (raw.length !== 64) return false;
    const sig = new Uint8Array(raw);
    const pk = new PublicKey(TRUSTED_RESOLVER_ADDRESS.trim()).toBytes();
    return nacl.sign.detached.verify(msg, sig, pk);
  } catch {
    return false;
  }
}

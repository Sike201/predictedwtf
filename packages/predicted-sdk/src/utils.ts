import { PublicKey } from "@solana/web3.js";

export function toPublicKey(
  k: string | PublicKey,
  label: string = "publicKey",
): PublicKey {
  if (k instanceof PublicKey) return k;
  try {
    return new PublicKey(k);
  } catch {
    throw new Error(`Invalid ${label}: not a valid public key string.`);
  }
}

/**
 * Human decimal string to fixed-point bigint (e.g. lp or outcome "12.34" with given decimals).
 */
export function humanToTokenAtoms(
  human: string,
  decimals: number,
  label: string = "amount",
): bigint {
  const cleaned = human.trim().replace(/,/g, "");
  if (!cleaned) throw new Error(`${label} is empty.`);
  const m = cleaned.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!m) {
    throw new Error(`${label} must be a decimal string, e.g. "1.5".`);
  }
  const neg = m[1] === "-";
  const whole = m[2] ?? "0";
  const frac = (m[3] ?? "").padEnd(decimals, "0").slice(0, decimals);
  if (frac.length > decimals) {
    throw new Error(`${label}: too many decimal places (max ${decimals}).`);
  }
  const base = 10n ** BigInt(decimals);
  const w = BigInt(whole);
  const f = frac.length ? BigInt(frac) : 0n;
  let out = w * base + f;
  if (neg) out = -out;
  return out;
}

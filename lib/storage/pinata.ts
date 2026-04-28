/**
 * Pinata IPFS — cover images for markets.
 * Prefer `PINATA_JWT`, or legacy `PINATA_API_KEY` + `PINATA_API_SECRET`.
 */

function parseDataUrl(dataUrl: string): { mime: string; buffer: Buffer } {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error("Invalid image data URL");
  return { mime: m[1], buffer: Buffer.from(m[2], "base64") };
}

/** @returns IPFS CID (v0/v1 hash string from Pinata) */
export async function pinMarketImageToIpfs(
  dataUrl: string,
  filename = "market-cover",
): Promise<string> {
  const jwt = process.env.PINATA_JWT?.trim();
  const key = process.env.PINATA_API_KEY?.trim();
  const secret = process.env.PINATA_API_SECRET?.trim();

  const { mime, buffer } = parseDataUrl(dataUrl);
  const ext = mime.includes("png")
    ? "png"
    : mime.includes("webp")
      ? "webp"
      : mime.includes("jpeg") || mime.includes("jpg")
        ? "jpg"
        : "bin";

  const blob = new Blob([new Uint8Array(buffer)], { type: mime });
  const form = new FormData();
  form.append("file", blob, `${filename}.${ext}`);

  let res: Response;
  if (jwt) {
    res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}` },
      body: form,
    });
  } else if (key && secret) {
    res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
      method: "POST",
      headers: {
        pinata_api_key: key,
        pinata_secret_api_key: secret,
      },
      body: form,
    });
  } else {
    throw new Error(
      "Configure PINATA_JWT or PINATA_API_KEY + PINATA_API_SECRET for image uploads.",
    );
  }

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Pinata pin failed (${res.status}): ${t.slice(0, 400)}`);
  }

  const json = (await res.json()) as { IpfsHash: string };
  if (!json.IpfsHash) throw new Error("Pinata response missing IpfsHash");
  return json.IpfsHash;
}

export function pinataGatewayUrl(cid: string): string {
  const c = cid.trim();
  if (!c) return "";
  return `https://gateway.pinata.cloud/ipfs/${c}`;
}

/**
 * Resolves DB `markets.image_cid` to a usable `src` for `next/image`.
 * Accepts bare CIDs, `ipfs://…`, full gateway URLs, and legacy double-wrapped
 * `…/ipfs/https://gateway…/ipfs/…` rows (would break if prefixed again).
 */
export function marketCoverImageUrlFromStored(
  stored: string | null | undefined,
  slugFallback: string,
): string {
  const fb = `https://picsum.photos/seed/${encodeURIComponent(slugFallback)}/640/360`;
  let raw = stored?.trim();
  if (!raw) return fb;

  while (/\/ipfs\/https?:\/\//i.test(raw)) {
    const idx = raw.search(/\/ipfs\/https?:\/\//i);
    raw = raw.slice(idx + "/ipfs/".length);
  }

  if (/^ipfs:\/\//i.test(raw)) {
    raw = raw.replace(/^ipfs:\/\//i, "").replace(/^\/+/, "");
  }

  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  return `https://gateway.pinata.cloud/ipfs/${raw.replace(/^\/+/, "")}`;
}

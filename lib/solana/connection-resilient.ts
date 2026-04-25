import type {
  AccountInfo,
  Commitment,
  Connection,
  GetMultipleAccountsConfig,
  PublicKey,
} from "@solana/web3.js";

/** Short TTL to collapse duplicate reads in one render / burst (ms). */
export const SOLANA_RPC_READ_CACHE_TTL_MS = 8_000;

const RETRY_BACKOFF_MS = [300, 800, 1500, 2500, 3500];

type CacheEntry<T> = { exp: number; v: T };

const accountInfoCache = new Map<string, CacheEntry<AccountInfo<Buffer> | null>>();
type TokenAccountBalanceResponse = Awaited<
  ReturnType<Connection["getTokenAccountBalance"]>
>;

const tokenBalCache = new Map<string, CacheEntry<TokenAccountBalanceResponse>>();
const inflightAccount = new Map<string, Promise<AccountInfo<Buffer> | null>>();
const inflightTokenBal = new Map<string, Promise<TokenAccountBalanceResponse>>();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function commitmentKey(
  commitmentOrConfig?: Commitment | GetMultipleAccountsConfig,
): string {
  if (commitmentOrConfig == null) return "confirmed";
  if (typeof commitmentOrConfig === "string") return commitmentOrConfig;
  const c = commitmentOrConfig as GetMultipleAccountsConfig & {
    commitment?: Commitment;
  };
  return typeof c.commitment === "string" ? c.commitment : "cfg";
}

export function isRetriableSolanaRpcError(err: unknown): boolean {
  if (err == null) return false;
  const msg = err instanceof Error ? err.message : String(err);
  const s = msg.toLowerCase();
  return (
    s.includes("429") ||
    s.includes("too many requests") ||
    s.includes("rate limit") ||
    s.includes("rate-limited") ||
    s.includes("fetch failed") ||
    s.includes("econnreset") ||
    s.includes("etimedout") ||
    s.includes("socket hang up") ||
    s.includes("service unavailable") ||
    s.includes(" 503") ||
    s.includes(" 502") ||
    s.includes("bad gateway")
  );
}

export async function withSolanaRpcRetry<T>(
  fn: () => Promise<T>,
): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (
        !isRetriableSolanaRpcError(e) ||
        attempt === RETRY_BACKOFF_MS.length
      ) {
        throw e;
      }
      await sleep(RETRY_BACKOFF_MS[attempt]);
    }
  }
  throw last;
}

/** Drop cached reads (e.g. after a confirmed trade). */
export function clearSolanaRpcReadCache(): void {
  accountInfoCache.clear();
  tokenBalCache.clear();
  inflightAccount.clear();
  inflightTokenBal.clear();
}

function accCacheKey(
  rpcUrl: string,
  kind: "ai",
  commitment: string,
  address: string,
): string {
  return `${rpcUrl}\0${kind}\0${commitment}\0${address}`;
}

function tbCacheKey(
  rpcUrl: string,
  commitment: string,
  address: string,
): string {
  return `${rpcUrl}\0tb\0${commitment}\0${address}`;
}

/**
 * Wraps a Connection so `getAccountInfo`, `getMultipleAccountsInfo`, and
 * `getTokenAccountBalance` use retry + backoff and a short TTL cache.
 * Other methods pass through unchanged (including transaction RPCs).
 */
export function wrapSolanaConnection(
  inner: Connection,
  opts: { rpcUrl: string },
): Connection {
  const rpcUrl = opts.rpcUrl;
  const ttl = SOLANA_RPC_READ_CACHE_TTL_MS;
  const now = () => Date.now();

  async function getAccountInfoImpl(
    publicKey: PublicKey,
    commitmentOrConfig?: Commitment | GetMultipleAccountsConfig,
  ): Promise<AccountInfo<Buffer> | null> {
    const ck = commitmentKey(commitmentOrConfig);
    const key = accCacheKey(rpcUrl, "ai", ck, publicKey.toBase58());
    const t = now();
    const hit = accountInfoCache.get(key);
    if (hit && hit.exp > t) return hit.v;

    const pending = inflightAccount.get(key);
    if (pending) return pending;

    const p = (async () => {
      try {
        const v = await withSolanaRpcRetry(() =>
          inner.getAccountInfo(publicKey, commitmentOrConfig),
        );
        accountInfoCache.set(key, { exp: now() + ttl, v });
        return v;
      } finally {
        inflightAccount.delete(key);
      }
    })();
    inflightAccount.set(key, p);
    return p;
  }

  async function getMultipleAccountsInfoImpl(
    publicKeys: PublicKey[],
    commitmentOrConfig?: Commitment | GetMultipleAccountsConfig,
  ): Promise<(AccountInfo<Buffer> | null)[]> {
    const ck = commitmentKey(commitmentOrConfig);
    const t = now();
    const results: (AccountInfo<Buffer> | null)[] = new Array(
      publicKeys.length,
    );
    const miss: { i: number; pk: PublicKey }[] = [];

    for (let i = 0; i < publicKeys.length; i++) {
      const pk = publicKeys[i]!;
      const key = accCacheKey(rpcUrl, "ai", ck, pk.toBase58());
      const hit = accountInfoCache.get(key);
      if (hit && hit.exp > t) results[i] = hit.v;
      else miss.push({ i, pk });
    }

    if (miss.length === 0) return results;

    const fetched = await withSolanaRpcRetry(() =>
      inner.getMultipleAccountsInfo(
        miss.map((m) => m.pk),
        commitmentOrConfig,
      ),
    );

    for (let j = 0; j < miss.length; j++) {
      const { i, pk } = miss[j]!;
      const v = fetched[j] ?? null;
      results[i] = v;
      const key = accCacheKey(rpcUrl, "ai", ck, pk.toBase58());
      accountInfoCache.set(key, { exp: now() + ttl, v });
    }

    return results;
  }

  async function getTokenAccountBalanceImpl(
    tokenAddress: PublicKey,
    commitment?: Commitment,
  ): Promise<TokenAccountBalanceResponse> {
    const ck = commitment ?? "confirmed";
    const key = tbCacheKey(rpcUrl, ck, tokenAddress.toBase58());
    const t = now();
    const hit = tokenBalCache.get(key);
    if (hit && hit.exp > t) return hit.v;

    let p = inflightTokenBal.get(key);
    if (!p) {
      p = (async () => {
        const res = await withSolanaRpcRetry(() =>
          inner.getTokenAccountBalance(tokenAddress, commitment),
        );
        tokenBalCache.set(key, { exp: now() + ttl, v: res });
        return res;
      })();
      inflightTokenBal.set(key, p);
      void p.finally(() => {
        inflightTokenBal.delete(key);
      });
    }
    return p;
  }

  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === "getAccountInfo") return getAccountInfoImpl;
      if (prop === "getMultipleAccountsInfo")
        return getMultipleAccountsInfoImpl;
      if (prop === "getTokenAccountBalance") return getTokenAccountBalanceImpl;
      return Reflect.get(target, prop, receiver);
    },
  }) as Connection;
}

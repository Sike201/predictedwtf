import { computeMarketLifecycle } from "@/lib/market/market-lifecycle";
import { TRUSTED_RESOLVER_ADDRESS } from "@/lib/market/trusted-resolver";
import type { MarketRecord } from "@/lib/types/market-record";
import type { Market, Resolution } from "@/lib/types/market";

const demoImg = (seed: string) =>
  `https://picsum.photos/seed/${encodeURIComponent(seed)}/640/360`;

type LegacyMarket = Omit<Market, "resolution" | "resolverPubkey"> & {
  resolution: Partial<Resolution> & Pick<Resolution, "rules" | "source" | "resolverWallet">;
  resolverPubkey?: string;
};

function normalizeMockMarket(m: LegacyMarket): Market {
  const rw = m.resolution.resolverWallet || TRUSTED_RESOLVER_ADDRESS;
  const resolveAfter = m.resolution.resolveAfter ?? m.expiry;
  const res: Resolution = {
    ...m.resolution,
    status: m.resolution.status ?? "active",
    resolveAfter,
    resolverWallet: rw,
  };
  const dbStatus: "active" | "resolved" =
    res.status === "resolved" ? "resolved" : "active";
  const partial: Pick<
    MarketRecord,
    "slug" | "status" | "resolution_status" | "resolve_after" | "expiry_ts"
  > = {
    slug: m.id,
    status: m.phase === "raising" ? "creating" : "live",
    resolution_status: dbStatus as MarketRecord["resolution_status"],
    resolve_after: resolveAfter,
    expiry_ts: m.expiry,
  };
  const { lifecycle, phase: computed } = computeMarketLifecycle(
    partial as MarketRecord,
    Date.now(),
    m.id,
  );
  return {
    ...m,
    phase: m.phase === "raising" ? "raising" : computed,
    resolverPubkey: m.resolverPubkey ?? rw,
    resolution: {
      ...res,
      status: lifecycle,
    },
  };
}

const MOCK_MARKETS_RAW: LegacyMarket[] = [
  {
    id: "sol-300-jul-2026",
    question: "Will SOL reach $300 before July 2026?",
    description:
      "Resolves YES if any major exchange prints SOL/USD or SOL/USDT ≥ $300 before 2026-07-01 00:00 UTC.",
    imageUrl: demoImg("sol300"),
    category: "crypto",
    poolApy: 14.2,
    kind: "binary",
    cardLayout: "a",
    yesProbability: 0.63,
    expiry: "2026-06-30T23:59:59.000Z",
    phase: "trading",
    createdAt: Date.now() - 86400000 * 4,
    snapshot: { liquidityUsd: 12430, volumeUsd: 2103 },
    resolution: {
      rules:
        "Resolve YES if SOL trades at or above $300 on Binance, Coinbase, or Kraken spot before July 1, 2026 UTC. Otherwise NO.",
      source: "Verified exchange tick APIs + CoinGecko spot high.",
      resolverWallet: "9rVYFD...yR4k",
    },
    pool: {
      poolId: "pool_sol_300",
      yesMint: "YES111...",
      noMint: "NO222...",
      yesPrice: 0.62,
      noPrice: 0.38,
    },
    chartSeries: buildSeries(0.58, 0.63),
  },
  {
    id: "fed-cut-q2",
    question: "When will the Fed first cut rates in 2026?",
    description:
      "Resolves to the window that contains the first 25bp+ cut from current levels.",
    imageUrl: demoImg("fed"),
    category: "politics",
    poolApy: 9.4,
    kind: "dates",
    cardLayout: "c",
    yesProbability: 0.41,
    dateOutcomes: [
      { id: "o1", label: "Apr – Jun 2026", probability: 0.41 },
      { id: "o2", label: "Jul – Sep 2026", probability: 0.33 },
      { id: "o3", label: "Oct – Dec 2026", probability: 0.19 },
      { id: "o4", label: "Not in 2026", probability: 0.07 },
    ],
    expiry: "2026-12-31T23:59:59.000Z",
    phase: "raising",
    createdAt: Date.now() - 86400000 * 2,
    snapshot: { liquidityUsd: 0, volumeUsd: 0 },
    resolution: {
      rules:
        "YES window wins if the first cut lands in that quarter range. Oracle: FOMC statements.",
      source: "Federal Reserve press releases.",
      resolverWallet: "Govx7...9pQm",
    },
    raise: {
      targetUsd: 500,
      endsAt: new Date(Date.now() + 3600000 * 6).toISOString(),
      raisedUsd: 312,
      initialLiquidityUsd: 500,
    },
    chartSeries: buildSeries(0.5, 0.41),
    creatorHandle: "@macro",
    views: 4200,
    aiOverview:
      "Calendar bucket market for the first Fed cut in 2026. Implied odds typically reprice around CPI prints, payrolls, and FOMC statements.\n\nResolution follows official Fed communications — whichever quarter window contains the first 25bp+ cut from the stated baseline wins.",
  },
  {
    id: "gpt6-2026",
    question: "Will OpenAI ship GPT-6 in 2026?",
    imageUrl: demoImg("gpt"),
    description:
      "YES if OpenAI publicly releases a flagship model branded GPT-6 by Dec 31, 2026 UTC.",
    category: "tech",
    poolApy: 11.8,
    kind: "binary",
    cardLayout: "b",
    yesProbability: 0.55,
    expiry: "2026-12-31T23:59:59.000Z",
    phase: "trading",
    createdAt: Date.now() - 86400000,
    snapshot: { liquidityUsd: 90420, volumeUsd: 41200 },
    resolution: {
      rules:
        "YES if OpenAI blog or product pages announce GPT-6 class model by deadline.",
      source: "Official OpenAI communications.",
      resolverWallet: "ResA1...z88",
    },
    pool: {
      poolId: "pool_gpt6",
      yesMint: "YES333...",
      noMint: "NO444...",
      yesPrice: 0.55,
      noPrice: 0.45,
    },
    chartSeries: buildSeries(0.62, 0.55),
  },
  {
    id: "nfl-sb-2026",
    question: "Will the Chiefs win Super Bowl LXI?",
    imageUrl: demoImg("nfl"),
    description: "Resolves on official NFL result for Super Bowl LXI.",
    category: "sports",
    poolApy: 18.6,
    kind: "binary",
    cardLayout: "a",
    yesProbability: 0.22,
    expiry: "2027-02-15T12:00:00.000Z",
    phase: "trading",
    createdAt: Date.now() - 3600000 * 10,
    snapshot: { liquidityUsd: 22100, volumeUsd: 15020 },
    resolution: {
      rules: "YES if Kansas City wins Super Bowl LXI; else NO.",
      source: "NFL official game result.",
      resolverWallet: "Sport...k7",
    },
    pool: {
      poolId: "pool_chiefs",
      yesMint: "YES555...",
      noMint: "NO666...",
      yesPrice: 0.22,
      noPrice: 0.78,
    },
    chartSeries: buildSeries(0.28, 0.22),
  },
  {
    id: "btc-150k",
    question: "When will Bitcoin reach $150k?",
    imageUrl: demoImg("btc"),
    description: "First print at or above $150k on tracked venues wins the bucket.",
    category: "crypto",
    poolApy: 16.1,
    kind: "dates",
    cardLayout: "d",
    yesProbability: 0.42,
    dateOutcomes: [
      { id: "b1", label: "H1 2026", probability: 0.42 },
      { id: "b2", label: "H2 2026", probability: 0.31 },
      { id: "b3", label: "2027+", probability: 0.22 },
      { id: "b4", label: "After 2028", probability: 0.05 },
    ],
    expiry: "2028-12-31T23:59:59.000Z",
    phase: "trading",
    createdAt: Date.now() - 86400000 * 6,
    snapshot: { liquidityUsd: 187000, volumeUsd: 92000 },
    resolution: {
      rules: "Earliest qualifying candle high assigns the winning date bucket.",
      source: "Exchange candle highs.",
      resolverWallet: "BtcR...m2",
    },
    pool: {
      poolId: "pool_btc_150k",
      yesMint: "YES777...",
      noMint: "NO888...",
      yesPrice: 0.38,
      noPrice: 0.62,
    },
    chartSeries: buildSeries(0.32, 0.38),
  },
  {
    id: "new-market-example",
    question: "Will US CPI YoY be below 2.5% by Oct 2026?",
    imageUrl: demoImg("cpi"),
    description: "CPI-U YoY change for Oct 2026 release vs Jul 2025 baseline.",
    category: "politics",
    poolApy: 7.2,
    kind: "binary",
    cardLayout: "b",
    yesProbability: 0.5,
    expiry: "2026-11-15T18:00:00.000Z",
    phase: "raising",
    createdAt: Date.now() - 3600000 * 2,
    snapshot: { liquidityUsd: 0, volumeUsd: 0 },
    resolution: {
      rules: "YES if BLS Oct 2026 CPI-U YoY < 2.5%.",
      source: "BLS CPI release.",
      resolverWallet: "Macro...n1",
    },
    raise: {
      targetUsd: 2000,
      endsAt: new Date(Date.now() + 3600000 * 48).toISOString(),
      raisedUsd: 420,
      initialLiquidityUsd: 2000,
    },
    chartSeries: buildSeries(0.5, 0.5),
  },
  {
    id: "eth-etf-flows",
    question: "When will weekly ETH ETF inflows first exceed $500M?",
    imageUrl: demoImg("ethfin"),
    description: "Per calendar week, US-listed ETH spot ETF aggregate inflows.",
    category: "finance",
    poolApy: 12.4,
    kind: "dates",
    cardLayout: "c",
    yesProbability: 0.38,
    dateOutcomes: [
      { id: "e1", label: "Q2 2026", probability: 0.38 },
      { id: "e2", label: "Q3 2026", probability: 0.35 },
      { id: "e3", label: "Q4 2026", probability: 0.2 },
      { id: "e4", label: "2027+", probability: 0.07 },
    ],
    expiry: "2027-06-30T23:59:59.000Z",
    phase: "trading",
    createdAt: Date.now() - 86400000 * 3,
    snapshot: { liquidityUsd: 45200, volumeUsd: 19800 },
    resolution: {
      rules:
        "First week crossing the threshold assigns the calendar bucket.",
      source: "Issuer + Bloomberg ETF flow data.",
      resolverWallet: "FinRs...p2",
    },
    pool: {
      poolId: "pool_eth_etf",
      yesMint: "YESaa...",
      noMint: "NObb...",
      yesPrice: 0.44,
      noPrice: 0.56,
    },
    chartSeries: buildSeries(0.5, 0.44),
  },
  {
    id: "predicted-brand-trend",
    question: "Will “predicted” hit 10k mentions in a day on X before 2027?",
    imageUrl: demoImg("predx"),
    description:
      "YES if a credible analytics snapshot shows ≥10k mentions in any 24h window.",
    category: "predicted",
    poolApy: 21.0,
    kind: "binary",
    cardLayout: "a",
    yesProbability: 0.14,
    expiry: "2027-01-01T12:00:00.000Z",
    phase: "trading",
    createdAt: Date.now() - 3600000 * 4,
    snapshot: { liquidityUsd: 18100, volumeUsd: 40200 },
    resolution: {
      rules: "YES verifiable via third-party mention counts + archive.",
      source: "X + brand analytics APIs.",
      resolverWallet: "PRD...01",
    },
    pool: {
      poolId: "pool_predicted_mentions",
      yesMint: "YEScc...",
      noMint: "NOdd...",
      yesPrice: 0.14,
      noPrice: 0.86,
    },
    chartSeries: buildSeries(0.19, 0.14),
  },
  {
    id: "aurora-solstice",
    question: "Will the northern lights be visible from Reykjavik on winter solstice 2026?",
    imageUrl: demoImg("aurora"),
    description: "YES if a major observatory or Iceland Met confirms visible aurora that night.",
    category: "predicted",
    poolApy: 8.6,
    kind: "binary",
    cardLayout: "d",
    yesProbability: 0.48,
    expiry: "2026-12-22T23:59:59.000Z",
    phase: "trading",
    createdAt: Date.now() - 86400000 * 5,
    snapshot: { liquidityUsd: 6200, volumeUsd: 3100 },
    resolution: {
      rules: "YES if public aurora forecast or ground truth confirms visibility.",
      source: "IMO + partner observatories.",
      resolverWallet: "Ice...sk",
    },
    pool: {
      poolId: "pool_aurora",
      yesMint: "YEa1...",
      noMint: "NOa2...",
      yesPrice: 0.48,
      noPrice: 0.52,
    },
    chartSeries: buildSeries(0.44, 0.48),
  },
  {
    id: "march-madness-undefeated",
    question: "Will any NCAA D1 team go undefeated in the 2026 regular season?",
    imageUrl: demoImg("ncaa"),
    description: "YES if at least one team finishes 0 losses before tournament week.",
    category: "sports",
    poolApy: 15.3,
    kind: "binary",
    cardLayout: "b",
    yesProbability: 0.31,
    expiry: "2026-03-10T12:00:00.000Z",
    phase: "trading",
    createdAt: Date.now() - 86400000 * 12,
    snapshot: { liquidityUsd: 28000, volumeUsd: 11200 },
    resolution: {
      rules: "YES per NCAA official standings at end of regular season.",
      source: "NCAA.com.",
      resolverWallet: "Cbb...ff",
    },
    pool: {
      poolId: "pool_undefeated",
      yesMint: "Ybb1...",
      noMint: "Nob2...",
      yesPrice: 0.31,
      noPrice: 0.69,
    },
    chartSeries: buildSeries(0.36, 0.31),
  },
  {
    id: "quantum-chip-1000",
    question: "Will a 1000+ logical qubit chip ship to customers before 2027?",
    imageUrl: demoImg("quant"),
    description: "YES if a vendor announces shipment of ≥1000 logical qubits in a single system SKU.",
    category: "tech",
    poolApy: 6.9,
    kind: "binary",
    cardLayout: "c",
    yesProbability: 0.18,
    expiry: "2026-12-31T23:59:59.000Z",
    phase: "raising",
    createdAt: Date.now() - 3600000 * 8,
    snapshot: { liquidityUsd: 0, volumeUsd: 0 },
    resolution: {
      rules: "YES if press + spec sheets match threshold for a paid customer.",
      source: "Vendor communications + third-party labs.",
      resolverWallet: "Qit...mm",
    },
    raise: {
      targetUsd: 1200,
      endsAt: new Date(Date.now() + 3600000 * 72).toISOString(),
      raisedUsd: 210,
      initialLiquidityUsd: 1200,
    },
    chartSeries: buildSeries(0.22, 0.18),
  },
  {
    id: "yield-curve-2026",
    question: "When will the 10Y – 2Y spread first go positive in 2026?",
    imageUrl: demoImg("yc"),
    description: "Resolves to the calendar quarter of first positive close on Treasury curve.",
    category: "finance",
    poolApy: 10.2,
    kind: "dates",
    cardLayout: "a",
    yesProbability: 0.36,
    dateOutcomes: [
      { id: "y1", label: "Q1 2026", probability: 0.22 },
      { id: "y2", label: "Q2 2026", probability: 0.36 },
      { id: "y3", label: "Q3 2026", probability: 0.28 },
      { id: "y4", label: "Q4+ 2026", probability: 0.14 },
    ],
    expiry: "2027-01-01T00:00:00.000Z",
    phase: "trading",
    createdAt: Date.now() - 86400000 * 9,
    snapshot: { liquidityUsd: 33100, volumeUsd: 8800 },
    resolution: {
      rules: "First daily close with 10Y > 2Y assigns the quarter bucket.",
      source: "US Treasury.",
      resolverWallet: "Tyld...zz",
    },
    pool: {
      poolId: "pool_yc",
      yesMint: "Yyy...",
      noMint: "Nyy...",
      yesPrice: 0.4,
      noPrice: 0.6,
    },
    chartSeries: buildSeries(0.3, 0.36),
  },
  {
    id: "spotify-wrapped-2026",
    question: "Will Taylor Swift top Spotify Wrapped global artists in 2026?",
    imageUrl: demoImg("wrap"),
    description: "YES if Spotify Wrapped 2026 lists the artist at #1 worldwide.",
    category: "predicted",
    poolApy: 13.7,
    kind: "binary",
    cardLayout: "d",
    yesProbability: 0.52,
    expiry: "2026-12-01T12:00:00.000Z",
    phase: "trading",
    createdAt: Date.now() - 86400000 * 1,
    snapshot: { liquidityUsd: 15400, volumeUsd: 22100 },
    resolution: {
      rules: "YES from official Spotify Wrapped release only.",
      source: "Spotify.",
      resolverWallet: "Spt...fy",
    },
    pool: {
      poolId: "pool_spotify",
      yesMint: "Yss...",
      noMint: "Nss...",
      yesPrice: 0.52,
      noPrice: 0.48,
    },
    chartSeries: buildSeries(0.55, 0.52),
  },
  {
    id: "mars-sample-return",
    question: "Will NASA confirm Mars sample return launch slips past 2030?",
    imageUrl: demoImg("mars"),
    description: "YES if official NASA communication moves the nominal launch window beyond 2030.",
    category: "tech",
    poolApy: 5.4,
    kind: "binary",
    cardLayout: "b",
    yesProbability: 0.67,
    expiry: "2027-06-01T00:00:00.000Z",
    phase: "trading",
    createdAt: Date.now() - 86400000 * 18,
    snapshot: { liquidityUsd: 9200, volumeUsd: 1900 },
    resolution: {
      rules: "YES if a press release or congressional testimony confirms slip.",
      source: "NASA.",
      resolverWallet: "Jpl...xx",
    },
    pool: {
      poolId: "pool_mars",
      yesMint: "Yms...",
      noMint: "Nms...",
      yesPrice: 0.67,
      noPrice: 0.33,
    },
    chartSeries: buildSeries(0.6, 0.67),
  },
];

export const MOCK_MARKETS: Market[] = MOCK_MARKETS_RAW.map(normalizeMockMarket);

function buildSeries(from: number, to: number) {
  const points = 48;
  const out: { t: number; p: number }[] = [];
  const now = Date.now();
  for (let i = 0; i < points; i++) {
    const t = now - (points - i) * 3600000 * 2;
    const blend = i / (points - 1);
    const noise = Math.sin(i * 0.7) * 0.02;
    const p = from + (to - from) * blend + noise;
    out.push({ t, p: Math.min(0.99, Math.max(0.01, p)) });
  }
  return out;
}

export function getMarketById(id: string) {
  return MOCK_MARKETS.find((m) => m.id === id);
}

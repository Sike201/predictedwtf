# Predicted SDK

A TypeScript SDK for building prediction markets on top of **Omnipair GAMM**.

Create markets, trade outcomes, provide liquidity, and withdraw to USDC — without dealing with pool mechanics, token accounts, or low-level Solana logic.

---

## Features

- Create prediction markets
- Buy / sell YES or NO outcomes
- Provide and withdraw liquidity
- Withdraw LP positions directly to USDC
- Redeem winnings after market resolution
- Built on Omnipair GAMM (leverage-ready architecture)

---

## Installation

**From GitHub** (for now, replace the placeholder with your org/repo and branch):

```bash
npm install github:YOUR_USERNAME/YOUR_REPO#main
```

**From the monorepo** (workspace):

```bash
npm install predicted-sdk
```

**From npm** (after publish):

```bash
npm install predicted-sdk @solana/web3.js @solana/spl-token
```

Peer dependencies: `@solana/web3.js`, `@solana/spl-token` (align versions with your app).

The build targets **Node** (`crypto` for params hashing). Browser apps should bundle with your stack (Vite, Next, etc.); most Solana setups polyfill Node builtins for `web3.js`.

---

## Quickstart

Map your app’s `marketId` (or slug) to on-chain accounts — you need the **Omnipair pool address** and **YES/NO mints** (from your API, indexer, or `deriveOmnipairLayout`-style derivation). The SDK does not look up by `marketId` alone.

```ts
import { Connection, Keypair } from "@solana/web3.js";
import { PredictedClient } from "predicted-sdk";

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const engine = Keypair.fromSecretKey(/* market engine: custody + mint co-signer */);

const wallet = {
  publicKey: userPublicKey,
  signTransaction: async (tx) => {
    /* @solana/wallet-adapter: return await wallet.signTransaction(tx); */
    return tx;
  },
};

const client = new PredictedClient({
  connection,
  wallet,
  cluster: "devnet",
  omnipairProgramId: process.env.NEXT_PUBLIC_OMNIPAIR_PROGRAM_ID!,
  engine,
  // optional: team treasury for `createMarket` (or pass per call)
  teamTreasury: process.env.OMNIPAIR_TEAM_TREASURY,
});

// Resolve marketId -> { pairAddress, yesMint, noMint } in your app
const market = {
  pairAddress: "POOL_PDA",
  yesMint: "YES_MINT",
  noMint: "NO_MINT",
};

// Buy YES (USDC as a decimal string, 6 dp on devnet)
await client.buyOutcome(market, "yes", "10.0", { marketSlug: "my-market" });

// Provide liquidity
await client.depositLiquidity(market, "50.0", { marketSlug: "my-market" });

// Withdraw to USDC — pass a human omLP string (e.g. "1.25"). For “max”,
// read the user’s omLP balance on-chain, format to the LP decimals, and pass that string.
await client.withdrawLiquidity(market, "1.25", { slippageBps: 100 });
```

Sides are `"yes" | "no"` (lowercase) to match the on-chain types. The client sets `process.env.NEXT_PUBLIC_OMNIPAIR_PROGRAM_ID` for shared helpers; use one program id per process.

---

## Devnet warning

**This SDK is implemented for Solana devnet first.** Mainnet differs (program id, USDC mint, custody, RPC). `cluster: "mainnet-beta"` currently throws; search the source for `TODO: mainnet`.

---

## Create market

Bootstraps YES/NO into engine ATAs, then runs the Omnipair `initialize` sequence. Fund the engine ATAs to at least `bootstrapPerSide` on each leg before calling.

```ts
await client.createMarket({
  yesMint: "…",
  noMint: "…",
  authorityYesAta: "…",
  authorityNoAta: "…",
  bootstrapPerSide: "1000", // human outcome units (devnet, typically 9 dp)
  // teamTreasury: "…",     // optional if already set on the client
});
```

Returns multiple signatures and Solana Explorer URLs (pre-init, bootstrap mint, initialize).

---

## Redeem after resolution

`resolveMarket` is the **post-resolution** path: burn **winning** outcome tokens and receive USDC from custody (not an oracle “resolve” instruction on-chain).

```ts
await client.resolveMarket(
  market,
  "yes",  // side you hold
  "yes",  // winning outcome
  "10.0", // human burn on winning leg
  { marketSlug: "my-market" },
);
```

---

## More API

- **Sell** — `client.sellOutcome(market, "yes" | "no", outcomeAmount, opts)`
- **Lower-level** — exports like `runBuyOutcome`, `runCreateOmnipairMarket` if you prefer not to use the class
- **Explorer URLs** — `solanaTransactionExplorerUrl` for custom links

## License

See the repository root (`package.json` when published).

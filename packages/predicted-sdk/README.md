# predicted-sdk

TypeScript client for building on the **Predicted Omnipair GAMM** prediction market layer on Solana. This package wraps the same transaction flows as the Predicted web app (`lib/solana`), with **human-sized amounts** (USDC and outcome strings) and **transaction signatures + explorer links** in the response.

## Devnet warning

**This SDK is tested and implemented for Solana devnet first.** Mainnet support is not wired in this release—program id, USDC mint, custody accounts, and RPC defaults differ. Using `cluster: "mainnet-beta"` throws until that work is completed (search the source for `TODO: mainnet`).

## Installation

From the monorepo (workspace):

```bash
npm install predicted-sdk
```

From npm (after publish):

```bash
npm install predicted-sdk @solana/web3.js @solana/spl-token
```

Peer dependencies: `@solana/web3.js`, `@solana/spl-token` (match versions to your app).

The build targets **Node** (`crypto` for params hashing). Browser apps should bundle with your framework (Vite, Next, etc.); most Solana stacks already polyfill Node builtins for `web3.js`.

## Quickstart

```ts
import { Connection, Keypair } from "@solana/web3.js";
import { PredictedClient } from "predicted-sdk";

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const engine = Keypair.fromSecretKey(...); // market engine (custody / mint co-signer)

const wallet = {
  publicKey: userPublicKey,
  signTransaction: async (tx) => {
    /* wallet-adapter sign */
    return signed;
  },
};

const client = new PredictedClient({
  connection,
  wallet,
  cluster: "devnet",
  omnipairProgramId: process.env.NEXT_PUBLIC_OMNIPAIR_PROGRAM_ID!,
  engine,
  teamTreasury: process.env.OMNIPAIR_TEAM_TREASURY!, // optional if you pass per `createMarket`
});
```

`PredictedClient` sets `process.env.NEXT_PUBLIC_OMNIPAIR_PROGRAM_ID` so shared on-chain helpers match the web app. Run only one client per process if you rely on different program IDs.

## Create market example

Pool creation bootstraps YES/NO into engine ATAs, then runs the Omnipair `initialize` sequence. You must fund the engine ATAs with at least `bootstrapPerSide` on each leg before calling.

```ts
await client.createMarket({
  yesMint: "…",
  noMint: "…",
  authorityYesAta: "…",
  authorityNoAta: "…",
  bootstrapPerSide: "1000", // human outcome units (devnet 9 dp)
  // teamTreasury: "…", // optional override; else use client `teamTreasury`
});
```

Returns multiple signatures and Solana Explorer URLs for the pre-init, bootstrap mint, and initialize steps.

## Buy YES example

USDC is provided as a **decimal string** (6 dp on devnet USDC).

```ts
const market = {
  pairAddress: "POOL_PDA",
  yesMint: "YES_MINT",
  noMint: "NO_MINT",
};

const result = await client.buyOutcome(market, "yes", "25.50", {
  slippageBps: 100,
  marketSlug: "my-market",
});

console.log(result.signature, result.explorerUrl);
console.log("Estimated chosen-side exposure (atoms, see on-chain):", result.estimated.chosenSideTokens);
```

## Deposit liquidity example

```ts
await client.depositLiquidity(market, "100.0", { marketSlug: "my-market" });
```

## Withdraw to USDC example

Pass **human omLP** (decimal string). The SDK reads LP mint decimals from chain; you never pass raw LP atoms.

```ts
await client.withdrawLiquidity(market, "1.25", { slippageBps: 100 });
```

## Resolver example

`resolveMarket` is the **post-resolution redemption** path: burn **winning** outcome tokens and receive devnet USDC from custody (not an on-chain “resolve oracle” instruction—name matches the product flow).

```ts
await client.resolveMarket(
  market,
  "yes", // side you hold
  "yes", // winning outcome after resolution
  "10.0", // human burn on winning leg
  { marketSlug: "my-market" },
);
```

## Lower-level runners

The package also exports `runBuyOutcome`, `runCreateOmnipairMarket`, etc., if you prefer not to use the class.

## License

See the repository root. (Package `license` field in `package.json` applies when published.)

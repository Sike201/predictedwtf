/**
 * From repo root (after `npm install` in the monorepo):
 *   npx tsx packages/predicted-sdk/examples/basic.ts
 *
 * Replace with your devnet keypairs, funded accounts, and real market PDAs before sending txs.
 * For a published build: `import { PredictedClient } from "predicted-sdk"`.
 */
import { Connection, Keypair } from "@solana/web3.js";
import { PredictedClient } from "predicted-sdk";

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const user = Keypair.generate();
  const engine = Keypair.generate();
  const programId = Keypair.generate().publicKey;
  const team = Keypair.generate().publicKey;

  const wallet = {
    publicKey: user.publicKey,
    signTransaction: async (tx: import("@solana/web3.js").Transaction) => {
      tx.partialSign(user);
      return tx;
    },
  };

  const client = new PredictedClient({
    connection,
    wallet,
    cluster: "devnet",
    omnipairProgramId: programId.toBase58(),
    engine,
    teamTreasury: team,
  });

  const market = {
    pairAddress: Keypair.generate().publicKey,
    yesMint: Keypair.generate().publicKey,
    noMint: Keypair.generate().publicKey,
  };

  // Uncomment with real on-chain account addresses and funded wallets:
  // await client.buyOutcome(market, "yes", "10.0", { marketSlug: "example" });
  // await client.sellOutcome(market, "no", "1.0");
  // await client.depositLiquidity(market, "5.0");
  // await client.withdrawLiquidity(market, "0.1");
  // await client.resolveMarket(market, "yes", "yes", "1.0");
  // await client.createMarket({
  //   yesMint: market.yesMint,
  //   noMint: market.noMint,
  //   authorityYesAta: "…",
  //   authorityNoAta: "…",
  //   bootstrapPerSide: "1000",
  // });

  console.log("predicted-sdk client ready:", client.wallet.publicKey.toBase58());
}

main().catch(console.error);

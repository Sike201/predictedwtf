import type { Keypair, PublicKey, Connection } from "@solana/web3.js";
import { initializeOmnipairMarket } from "@/lib/solana/init-omnipair-market";
import { parseOutcomeHumanToBaseUnits } from "@/lib/solana/mint-market-positions";
import { withCreateMarketEnv } from "./env-apply.js";
import { solanaTransactionExplorerUrl } from "./explorer.js";
import type { CreateMarketResult, PredictedCluster } from "./types.js";
import { toPublicKey } from "./utils.js";

export type CreateMarketCallParams = {
  connection: Connection;
  engine: Keypair;
  cluster: PredictedCluster;
  teamTreasury: string | PublicKey;
  yesMint: string | PublicKey;
  noMint: string | PublicKey;
  authorityYesAta: string | PublicKey;
  authorityNoAta: string | PublicKey;
  /**
   * Human-sized bootstrap for each leg (outcome token decimals on devnet, typically 9),
   * e.g. "1000" mints 1000 YES and 1000 NO into the engine ATAs before `initialize` pulls it.
   */
  bootstrapPerSide: string;
};

/**
 * **Devnet (current):** run the three-step bootstrap + `initialize` flow for a YES/NO pair that already
 * exists. Supply engine-funded outcome token ATAs with enough balance for the bootstrap.
 *
 * // TODO: mainnet — fee payer / rent policy, `production` metadata constraints, and audited keys.
 */
export async function runCreateOmnipairMarket(
  params: CreateMarketCallParams,
): Promise<CreateMarketResult> {
  const team = toPublicKey(params.teamTreasury, "teamTreasury").toBase58();
  const yesMint = toPublicKey(params.yesMint, "yesMint");
  const noMint = toPublicKey(params.noMint, "noMint");
  const authorityYesAta = toPublicKey(params.authorityYesAta, "authorityYesAta");
  const authorityNoAta = toPublicKey(params.authorityNoAta, "authorityNoAta");
  const bootstrapPerSide = parseOutcomeHumanToBaseUnits(
    params.bootstrapPerSide.trim(),
  );
  if (bootstrapPerSide <= 0n) {
    throw new Error("bootstrapPerSide must be greater than zero.");
  }

  const r = await withCreateMarketEnv(team, () =>
    initializeOmnipairMarket({
      connection: params.connection,
      payer: params.engine,
      yesMint,
      noMint,
      authorityYesAta,
      authorityNoAta,
      bootstrapPerSide,
    }),
  );

  const ex = (sig: string) => solanaTransactionExplorerUrl(sig, params.cluster);

  return {
    preInitializeSignature: r.preInitializeSignature,
    bootstrapLiquiditySignature: r.bootstrapLiquiditySignature,
    initializeSignature: r.initializeSignature,
    initSignature: r.initSignature,
    programId: r.programId.toBase58(),
    pairAddress: r.pairAddress.toBase58(),
    yesMint: r.yesMint.toBase58(),
    noMint: r.noMint.toBase58(),
    explorer: {
      preInitialize: ex(r.preInitializeSignature),
      bootstrap: ex(r.bootstrapLiquiditySignature),
      initialize: ex(r.initializeSignature),
    },
  };
}

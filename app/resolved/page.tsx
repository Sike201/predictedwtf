import Link from "next/link";
import { MarketCard } from "@/components/markets/market-card";
import { fetchResolvedMarketsForArchive } from "@/lib/market/fetch-markets";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ResolvedMarketsPage() {
  const markets = await fetchResolvedMarketsForArchive(80);

  return (
    <div className="min-h-screen bg-black px-3 pb-24 pt-6 text-zinc-100 sm:px-4 lg:px-6">
      <div className="mx-auto max-w-[1920px]">
        <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3 border-b border-white/[0.06] pb-4">
          <h1 className="text-lg font-semibold text-white sm:text-xl">
            Resolved markets
          </h1>
          <Link
            href="/"
            className="text-[13px] font-medium text-zinc-500 transition hover:text-zinc-300"
          >
            ← Back to live markets
          </Link>
        </div>

        {markets.length === 0 ? (
          <p className="py-12 text-center text-sm text-zinc-500">
            No resolved markets yet.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 min-[560px]:grid-cols-2 xl:grid-cols-4">
            {markets.map((m) => (
              <MarketCard key={m.id} market={m} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

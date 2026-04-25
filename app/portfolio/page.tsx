import { PortfolioView } from "@/components/portfolio/portfolio-view";

export default function PortfolioPage() {
  return (
    <div className="px-6 pb-12 pt-6">
      <div className="mx-auto max-w-[1000px]">
        <h1 className="text-2xl font-semibold text-white">Portfolio</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Outcome balances, pool liquidity, and Omnipair leverage from your
          connected wallet across live markets.
        </p>
        <PortfolioView />
      </div>
    </div>
  );
}

export default function PortfolioPage() {
  return (
    <div className="px-6 pb-12 pt-6">
      <div className="mx-auto max-w-[1000px]">
        <h1 className="text-2xl font-semibold text-white">Portfolio</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Positions, PnL, and redeemable winnings will surface here from your
          connected wallet.
        </p>
        <div className="mt-10 rounded-2xl border border-stroke-subtle bg-canvas-surface/50 p-10 text-center text-sm text-zinc-500">
          No wallet connected · MVP placeholder
        </div>
      </div>
    </div>
  );
}

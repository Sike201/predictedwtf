export default function ProfilePage() {
  return (
    <div className="px-6 pb-12 pt-6">
      <div className="mx-auto max-w-[720px]">
        <h1 className="text-2xl font-semibold text-white">Profile</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Public handle, reputation, and resolver eligibility — hook to on-chain
          identity when ready.
        </p>
        <div className="mt-10 rounded-2xl border border-stroke-subtle bg-canvas-surface/50 p-10 text-center text-sm text-zinc-500">
          Profile settings · MVP placeholder
        </div>
      </div>
    </div>
  );
}

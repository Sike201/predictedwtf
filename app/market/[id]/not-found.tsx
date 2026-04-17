import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-6">
      <p className="text-sm font-medium text-zinc-400">Market not found</p>
      <Link
        href="/"
        className="mt-4 text-sm font-semibold text-accent hover:underline"
      >
        Back to markets
      </Link>
    </div>
  );
}

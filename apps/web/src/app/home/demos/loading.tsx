/** Demo-library-shaped skeleton: heading, sub, then list rows. */
export default function DemosLoading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-16 pt-8 sm:pt-10">
      <div className="h-7 w-64 animate-pulse rounded-lg bg-ink/[0.06]" />
      <div className="mt-2 h-4 w-80 max-w-full animate-pulse rounded-lg bg-ink/[0.06]" />
      <div className="mt-6 flex flex-col gap-3">
        <div className="h-20 animate-pulse rounded-xl border border-ink/[0.08] bg-white" />
        <div className="h-20 animate-pulse rounded-xl border border-ink/[0.08] bg-white" />
        <div className="h-20 animate-pulse rounded-xl border border-ink/[0.08] bg-white" />
      </div>
    </div>
  );
}

/** Plan-page skeleton: heading, subline, then three card-shaped pulses. */
export default function PlanLoading() {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 pb-16 pt-8 sm:pt-10">
      <div className="h-7 w-40 motion-safe:animate-pulse rounded-lg bg-ink/[0.06]" />
      <div className="mt-2 h-4 w-96 max-w-full motion-safe:animate-pulse rounded-lg bg-ink/[0.06]" />
      <div className="mt-8 grid gap-5 md:grid-cols-3">
        <div className="h-[26rem] motion-safe:animate-pulse rounded-xl border border-ink/[0.08] bg-white" />
        <div className="h-[26rem] motion-safe:animate-pulse rounded-xl border border-ink/[0.08] bg-white" />
        <div className="h-[26rem] motion-safe:animate-pulse rounded-xl border border-ink/[0.08] bg-white" />
      </div>
    </div>
  );
}

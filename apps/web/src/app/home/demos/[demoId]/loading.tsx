/** Plan-editor-shaped skeleton: the demo header, then step cards. */
export default function DemoPlanLoading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-16 pt-8 sm:pt-10">
      <div className="flex items-start gap-4">
        <div className="aspect-[9/16] w-16 shrink-0 animate-pulse rounded-lg bg-ink/10" />
        <div className="min-w-0 flex-1">
          <div className="h-7 w-56 animate-pulse rounded-lg bg-ink/[0.06]" />
          <div className="mt-3 h-4 w-64 max-w-full animate-pulse rounded-lg bg-ink/[0.06]" />
          <div className="mt-2 h-4 w-80 max-w-full animate-pulse rounded-lg bg-ink/[0.06]" />
        </div>
      </div>
      {/* StepPlan brings its own header (back link, h2, sub) below the demo
          strip — leaving it out here drops every card ~115px on hydration. */}
      <div className="mt-8">
        <div className="h-4 w-16 animate-pulse rounded bg-ink/[0.06]" />
        <div className="mt-4 h-7 w-48 animate-pulse rounded-lg bg-ink/[0.06]" />
        <div className="mt-2 h-4 w-80 max-w-full animate-pulse rounded-lg bg-ink/[0.06]" />
      </div>
      <div className="mt-6 flex flex-col gap-2">
        <div className="h-28 animate-pulse rounded-xl border border-ink/[0.08] bg-white" />
        <div className="h-28 animate-pulse rounded-xl border border-ink/[0.08] bg-white" />
        <div className="h-28 animate-pulse rounded-xl border border-ink/[0.08] bg-white" />
      </div>
    </div>
  );
}

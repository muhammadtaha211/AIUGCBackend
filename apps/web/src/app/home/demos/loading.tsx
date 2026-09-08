/** Demo-library-shaped skeleton: heading, sub, the explainer line, then list
 *  rows — h-40, because a ready row now stacks a 9:16 thumb, the status line,
 *  the plan-editor button and the note field. */
export default function DemosLoading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-16 pt-8 sm:pt-10">
      <div className="h-7 w-64 animate-pulse rounded-lg bg-ink/[0.06]" />
      <div className="mt-2 h-4 w-80 max-w-full animate-pulse rounded-lg bg-ink/[0.06]" />
      <div className="mt-8 h-4 w-96 max-w-full animate-pulse rounded-lg bg-ink/[0.06]" />
      <div className="mt-4 flex flex-col gap-4">
        <div className="h-40 animate-pulse rounded-xl border border-ink/[0.08] bg-white" />
        <div className="h-40 animate-pulse rounded-xl border border-ink/[0.08] bg-white" />
        <div className="h-40 animate-pulse rounded-xl border border-ink/[0.08] bg-white" />
      </div>
    </div>
  );
}

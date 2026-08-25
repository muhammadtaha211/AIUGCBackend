/** Wizard-shaped skeleton: mirrors AWizard's shell (title row over a card
 *  column) so the pane stops jumping when the real step mounts. Symmetric
 *  pulse blocks — RTL needs nothing. */
export default function AWizardLoading() {
  return (
    <div className="flex flex-col items-center px-6 pb-8">
      <div className="w-full max-w-2xl pt-4 sm:pt-6 lg:max-w-4xl">
        <div className="flex items-center justify-between">
          <div className="h-5 w-24 animate-pulse rounded-lg bg-ink/[0.06]" />
          <div className="h-4 w-32 animate-pulse rounded-lg bg-ink/[0.06]" />
        </div>
        <div className="mt-6 rounded-xl border border-ink/[0.08] bg-white p-5">
          <div className="h-6 w-56 animate-pulse rounded-lg bg-ink/[0.06]" />
          <div className="mt-4 h-4 w-full animate-pulse rounded-lg bg-ink/[0.06]" />
          <div className="mt-2 h-4 w-3/4 animate-pulse rounded-lg bg-ink/[0.06]" />
          <div className="mt-6 h-28 animate-pulse rounded-xl bg-ink/[0.06]" />
        </div>
      </div>
    </div>
  );
}

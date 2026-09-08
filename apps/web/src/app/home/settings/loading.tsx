/** Settings-shaped skeleton: heading, the account card, then business cards. */
export default function SettingsLoading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-16 pt-8 sm:pt-10">
      <div className="h-7 w-32 animate-pulse rounded-lg bg-ink/[0.06]" />
      <div className="mt-2 h-4 w-80 max-w-full animate-pulse rounded-lg bg-ink/[0.06]" />
      <div className="mt-8 h-5 w-24 animate-pulse rounded-lg bg-ink/[0.06]" />
      <div className="mt-3 h-20 animate-pulse rounded-xl border border-ink/[0.08] bg-white" />
      <div className="mt-10 h-5 w-32 animate-pulse rounded-lg bg-ink/[0.06]" />
      <div className="mt-3 flex flex-col gap-4">
        <div className="h-24 animate-pulse rounded-xl border border-ink/[0.08] bg-white" />
        <div className="h-24 animate-pulse rounded-xl border border-ink/[0.08] bg-white" />
      </div>
    </div>
  );
}

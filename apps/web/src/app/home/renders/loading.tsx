/** Library-shaped skeleton: heading, sub, then a grid of 9:16 tiles. */
export default function RendersLoading() {
  return (
    <div className="mx-auto w-full max-w-4xl px-6 pb-16 pt-8 sm:pt-10">
      <div className="h-7 w-64 animate-pulse rounded-lg bg-ink/[0.06]" />
      <div className="mt-2 h-4 w-80 max-w-full animate-pulse rounded-lg bg-ink/[0.06]" />
      <div className="mt-8 grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
        {Array.from({ length: 12 }, (_, index) => (
          <div
            key={index}
            className="aspect-[9/16] animate-pulse rounded-lg border border-ink/10 bg-ink/[0.04]"
          />
        ))}
      </div>
    </div>
  );
}

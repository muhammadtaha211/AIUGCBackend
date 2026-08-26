/**
 * Suspense fallback for every route under /home — and the boundary prefetch
 * paints at click time (prefetch stops at the FIRST loading.tsx, and the
 * children slot's fallback is the parent segment's loading module), so this
 * fronts every navigation, wizard clicks included. Deliberately
 * shape-AGNOSTIC: a home-shaped skeleton here would flash the wrong shape on
 * the way into a wizard. The leaf segments carry the shaped skeletons; the
 * sidebar lives in the layout and never unmounts.
 */
export default function HomeLoading() {
  return (
    <div className="mx-auto w-full max-w-2xl px-6 pt-8">
      <div className="h-7 w-48 animate-pulse rounded-lg bg-ink/[0.06]" />
      <div className="mt-4 h-40 animate-pulse rounded-xl border border-ink/[0.08] bg-white" />
    </div>
  );
}

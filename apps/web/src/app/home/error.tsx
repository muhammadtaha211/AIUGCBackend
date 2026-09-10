"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/**
 * The app's only error boundary. Anything under /home that throws lands here
 * instead of on Next's built-in fallback, which is a client component that
 * replaces the WHOLE document with an English, LTR "Application error" screen —
 * and, for a throw behind /home's Suspense, does it at HTTP 200.
 *
 * It renders inside home/layout.tsx, in the same <main> slot as home/loading.tsx
 * (same wrapper, so the swap does not jump): the sidebar, the switcher and the
 * credits card all stay on screen and only the content pane changes. It covers
 * home/page.tsx and every nested segment — /home/a/new, /home/b/new, the
 * libraries — because none of them declares a boundary of its own.
 *
 * Its one blind spot is home/layout.tsx ITSELF. A layout is rendered by its
 * PARENT's boundary, and there is no app/error.tsx, so a throw in the layout
 * still reaches the default screen. That is why the layout logs its failed
 * businesses read instead of throwing on it.
 *
 * Keep the imports lean: this module is fetched and evaluated on every /home
 * page load whether or not anything throws, even though it renders nothing
 * until it trips.
 */
export default function HomeError({
  error,
  reset,
}: {
  // Next types this internally as { error: Error; reset?: () => void } and
  // attaches `digest` at runtime, so the honest prop type is ours to write.
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const [retrying, startRetry] = useTransition();

  return (
    <div className="mx-auto w-full max-w-2xl px-6 pt-8">
      <div className="rounded-xl border border-ink/[0.08] bg-white p-6 text-center shadow-xl shadow-ink/[0.05] sm:p-10">
        <h1 className="text-lg font-medium text-ink">לא הצלחנו לטעון את הדף</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink/60">התקלה אצלנו, לא בצד שלכם.</p>

        <div className="mt-6 flex items-center justify-center gap-3">
          <Button
            type="button"
            loading={retrying}
            // reset() alone is a no-op for a failed server read: it clears the
            // boundary's state and React re-reads the SAME rejected payload,
            // so the boundary trips again on the next frame and the button
            // looks dead. router.refresh() is what re-runs the server tree;
            // reset() then lets the fresh one render. Both in one transition,
            // refresh first.
            onClick={() =>
              startRetry(() => {
                router.refresh();
                reset();
              })
            }
          >
            נסה שוב
          </Button>
          <Button
            type="button"
            variant="secondary"
            // A hard navigation, not <Link>: the boundary only auto-clears on a
            // PATHNAME change, so a client nav from /home back to /home would
            // leave this screen up and the click would read as broken. Same
            // reason settings/sign-out-button.tsx assigns instead of pushing.
            onClick={() => window.location.assign("/home")}
          >
            חזרה לדף הבית
          </Button>
        </div>

        {/* In production React replaces a server error's message with a fixed
            English sentence, so `digest` is the only thing here worth showing —
            and it is the join key into the Vercel function logs, where the real
            error is. LTR-isolated like every other id in the app. */}
        {error.digest && (
          <details className="mt-6">
            <summary className="cursor-pointer text-xs text-ink/50">פרטים טכניים</summary>
            {/* Inherits the card's text-center rather than carrying an
                alignment of its own: `dir="ltr"` on a block makes text-start
                resolve to the LEFT, which would strand the digest on the
                opposite side of the card from its own label. */}
            <code dir="ltr" className="mt-1 block break-all text-xs text-ink/50">
              {error.digest}
            </code>
          </details>
        )}
      </div>
    </div>
  );
}

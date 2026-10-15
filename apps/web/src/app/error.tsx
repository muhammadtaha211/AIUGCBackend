"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { captureError } from "@/lib/analytics-client";

/**
 * The root error boundary: everything app/home/error.tsx does not reach. The
 * marketing page, /start, /login, forgot/reset-password, (legal) — and, the
 * reason it was written, home/layout.tsx itself, which a segment boundary
 * cannot catch because a layout is rendered by its PARENT's boundary. Without
 * this file a throw in the dashboard shell reached Next's built-in screen:
 * English, LTR, unbranded, on a Hebrew-first RTL product.
 *
 * DELIBERATELY NOT a shared component with home/error.tsx, and the difference
 * is not cosmetic. That one renders inside home/layout.tsx, which supplies
 * `theme-light`; this one renders directly under the root layout, whose body
 * is `text-gray-100` over the charcoal background globals.css paints. Every
 * page outside /home wraps itself in `theme-light` too — but a page that
 * THREW rendered no wrapper, so what is on screen behind this card is always
 * the dark surface. Hence the dark card (the same
 * `border-white/10 bg-white/5` pair onboarding-flow.tsx:260 uses as the dark
 * half of that exact card) and the full-height centering: there is no shell
 * left to sit inside.
 *
 * Two instances is not a pattern. If a third boundary ever appears, extract
 * then.
 */
export default function RootError({
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
  // A boundary's catch never reaches window.onerror; report it here (vault 0104).
  useEffect(() => {
    captureError(error);
  }, [error]);

  return (
    <div className="flex min-h-dvh items-center justify-center px-6 py-16">
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-white/5 p-6 text-center sm:p-10">
        <h1 className="text-lg font-medium text-gray-100">לא הצלחנו לטעון את הדף</h1>
        <p className="mt-3 text-sm leading-relaxed text-gray-400">התקלה אצלנו, לא בצד שלכם.</p>

        <div className="mt-6 flex items-center justify-center gap-3">
          <Button
            type="button"
            loading={retrying}
            // reset() alone is a no-op for a failed server read: it clears the
            // boundary's state and React re-reads the SAME rejected payload,
            // so the boundary trips again on the next frame and the button
            // looks dead. router.refresh() is what re-runs the server tree;
            // reset() then lets the fresh one render. Both in one transition,
            // refresh first. Measured on home/error.tsx, same mechanism.
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
            // "/" and not "/home": this boundary sits above the signed-out
            // surface too, and / is the one destination that is right either
            // way — the middleware sends a signed-in owner on to /home, and
            // anyone else belongs on the landing page.
            //
            // A hard navigation, not <Link>: the boundary only auto-clears on
            // a PATHNAME change, and the throw that got us here may have been
            // in home/layout.tsx, whose client chunk is already loaded.
            onClick={() => window.location.assign("/")}
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
            <summary className="cursor-pointer text-xs text-gray-500">פרטים טכניים</summary>
            {/* Inherits the card's text-center rather than carrying an
                alignment of its own: `dir="ltr"` on a block makes text-start
                resolve to the LEFT, which would strand the digest on the
                opposite side of the card from its own label. */}
            <code dir="ltr" className="mt-1 block break-all text-xs text-gray-500">
              {error.digest}
            </code>
          </details>
        )}
      </div>
    </div>
  );
}

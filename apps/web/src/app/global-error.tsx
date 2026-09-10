"use client";

/**
 * Last resort: the only boundary that catches a throw in the ROOT layout, and
 * the only one that has to be self-contained. Next renders it INSTEAD of
 * app/layout.tsx, so it gets no <html>/<body> from us, no globals.css and
 * therefore no Tailwind, and none of the next/font faces — the Heebo and
 * Secular One variables are declared on the <html> element it is replacing.
 * Hence the hand-written document, the system stack, and the inline styles.
 *
 * `lang="he" dir="rtl"` is the load-bearing part: without them the browser
 * lays this out LTR and the Hebrew punctuation lands on the wrong side.
 *
 * The retry is a hard reload, not router.refresh(): if the root layout is what
 * threw, there is no rendered app left to refresh into. Everything else about
 * this file is deliberately not clever — it runs on the day nothing else works.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="he" dir="rtl">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          backgroundColor: "#111111",
          color: "#f3f4f6",
          fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif',
          textAlign: "center",
        }}
      >
        <div>
          <h1 style={{ fontSize: "1.125rem", fontWeight: 500, margin: 0 }}>
            לא הצלחנו לטעון את הדף
          </h1>
          <p style={{ margin: "0.75rem 0 1.5rem", fontSize: "0.875rem", color: "#9ca3af" }}>
            התקלה אצלנו, לא בצד שלכם.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              font: "inherit",
              fontWeight: 600,
              cursor: "pointer",
              border: 0,
              borderRadius: "0.5rem",
              padding: "0.625rem 1.25rem",
              backgroundColor: "#b6ff00",
              color: "#111111",
            }}
          >
            נסה שוב
          </button>
          {/* The join key into the Vercel logs — in production the message
              itself is masked. LTR-isolated like every other id in the app. */}
          {error.digest && (
            <p dir="ltr" style={{ margin: "1.5rem 0 0", fontSize: "0.75rem", color: "#6b7280" }}>
              {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}

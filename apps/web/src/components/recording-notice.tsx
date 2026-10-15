import Link from "next/link";

/**
 * Shown on the first screen of /start, on the three auth pages (vault 0104,
 * decision 6) and in the footer of every public page (vault 0110).
 */
export const RECORDING_NOTICE = "השימוש באתר מוקלט כדי לשפר את השירות.";

/**
 * The visitor is told, in one quiet line, that their use of the site is
 * recorded. A notice, not an accept/decline banner: whether capture may start
 * is decided in one place, captureDecision in lib/analytics-client.ts.
 *
 * As small and as faint as the site's own text goes while staying readable
 * without zooming on a 375 px screen (vault 0110): 11 px, the public pages'
 * smallest size, at the footer copyright's 45% ink (3.0:1 on paper and white).
 */
export function RecordingNotice({ className = "" }: { className?: string }) {
  return (
    <p className={`text-[11px] text-ink/45 ${className}`}>
      {RECORDING_NOTICE}{" "}
      <Link
        href="/privacy"
        className="underline decoration-ink/25 underline-offset-2 hover:text-ink"
      >
        מדיניות הפרטיות
      </Link>
    </p>
  );
}

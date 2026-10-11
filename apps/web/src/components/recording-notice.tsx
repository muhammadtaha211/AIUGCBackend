import Link from "next/link";

/** Shown on the first screen of /start and on the three auth pages (vault 0104, decision 6). */
export const RECORDING_NOTICE = "השימוש באתר מוקלט כדי לשפר את השירות.";

/**
 * The visitor is told, in one quiet line, that their use of the site is
 * recorded. A notice, not an accept/decline banner: whether capture may start
 * is decided in one place, captureDecision in lib/analytics-client.ts.
 */
export function RecordingNotice({ className = "" }: { className?: string }) {
  return (
    <p className={`text-xs text-ink/50 ${className}`} data-ph-unmask>
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

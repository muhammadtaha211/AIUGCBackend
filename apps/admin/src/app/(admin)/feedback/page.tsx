import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb, listFeedback } from "@aiugc/core";
import { adminSession } from "@/lib/api";
import { CopyId } from "../personas/copy-id";

/**
 * The in-app "צור קשר" inbox — everything customers wrote at /home/feedback,
 * newest first. Read-only on purpose: there is no handled/resolved state to
 * keep in sync and nothing here sends anything anywhere. The founder answers
 * from his own mail client, to the address in the row.
 */

const PAGE_SIZE = 100;

/**
 * dd.MM.yyyy HH:mm in Israel time, whatever the server's zone is. Built from
 * parts rather than a locale string: he-IL and en-GB disagree on separators,
 * and this format is the founder's, not a locale's.
 */
const FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jerusalem",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatJerusalem(at: Date): string {
  const parts = new Map(FORMATTER.formatToParts(at).map((part) => [part.type, part.value]));
  return `${parts.get("day")}.${parts.get("month")}.${parts.get("year")} ${parts.get("hour")}:${parts.get("minute")}`;
}

export default async function AdminFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string }>;
}) {
  const db = getDb();
  const session = await adminSession(db);
  if (!session) redirect("/login");

  // A hand-edited ?before= must not 500 the page — an unparseable value just
  // means "from the top".
  const { before } = await searchParams;
  const cursor = before ? new Date(before) : undefined;
  const rows = await listFeedback(db, {
    limit: PAGE_SIZE,
    before: cursor && !Number.isNaN(cursor.getTime()) ? cursor : undefined,
  });
  // A full page means there may be more; a short one is the end.
  const nextCursor = rows.length === PAGE_SIZE ? rows[rows.length - 1]!.createdAt : null;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-white">משוב</h1>
        {before && (
          <Link href="/feedback" className="text-[13px] text-gray-400 hover:text-white">
            חזרה להודעות האחרונות
          </Link>
        )}
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-[13px] text-gray-500">
              <th className="px-4 py-2.5 text-start font-medium">מתי</th>
              <th className="px-4 py-2.5 text-start font-medium">משתמש</th>
              <th className="px-4 py-2.5 text-start font-medium">עסק</th>
              <th className="px-4 py-2.5 text-start font-medium">הודעה</th>
              <th className="px-4 py-2.5 text-start font-medium">עמוד</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-white/5 align-top last:border-b-0">
                {/* dir=ltr, not decoration: "08.09.2026 14:30" is two number
                    runs separated by a space, and in the RTL page that space
                    resolves RTL and swaps them — measured in a browser as
                    "14:30 08.09.2026". On the span, like the email and the
                    pathname below, so the cell keeps the table's text-start. */}
                <td className="whitespace-nowrap px-4 py-2.5 text-gray-400 tabular-nums">
                  <span dir="ltr">{formatJerusalem(row.createdAt)}</span>
                </td>
                <td className="px-4 py-2.5">
                  <span className="font-medium text-white" dir="ltr">
                    {row.userEmail ?? "—"}
                  </span>
                  {row.userId && (
                    <span className="ms-2">
                      <CopyId id={row.userId} />
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-gray-300">
                  {row.businessName ?? <span className="text-gray-500">—</span>}
                </td>
                {/* Full text, never truncated: a message the founder has to
                    click to finish reading is a message he skims. dir=auto
                    because the message is arbitrary customer text — a message
                    opening in Latin renders its first clause last inside a
                    hard RTL cell. */}
                <td
                  dir="auto"
                  className="max-w-md whitespace-pre-wrap break-words px-4 py-2.5 text-gray-200"
                >
                  {row.message}
                </td>
                <td className="px-4 py-2.5 text-gray-500">
                  {row.page ? (
                    <span dir="ltr" className="font-mono text-xs">
                      {row.page}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                  {before ? "אין הודעות נוספות." : "אין משוב עדיין."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {nextCursor && (
        <div className="mt-4 text-center">
          <Link
            href={`/feedback?before=${encodeURIComponent(nextCursor.toISOString())}`}
            className="rounded-lg px-3 py-1.5 text-sm text-gray-300 hover:bg-white/10 hover:text-white"
          >
            עוד הודעות
          </Link>
        </div>
      )}
    </div>
  );
}

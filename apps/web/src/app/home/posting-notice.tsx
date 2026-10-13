"use client";

import { useState } from "react";
import Link from "next/link";
import { isolated } from "@/lib/social-ui";
import {
  EXPIRED_NOTICE_LINK,
  expiredNoticeLine,
  failedNoticeLine,
  NOTICE_ACK,
  TO_CALENDAR,
} from "@/lib/social-posting-ui";
import { postJson } from "@/lib/use-api";

/**
 * The /home notice (Appendix A, decision 0101): a strip above the recent
 * renders while a post failed in the last 7 days and nobody said "הבנתי", and
 * while a connected account is expired with posts still waiting. The page
 * renders it only for an account the switch allows. "הבנתי" clears the failure
 * line only; the failure email (0107) is the worker's and never depends on it.
 */
export function PostingNotice({
  failures,
  expired,
}: {
  failures: number;
  expired: { id: string; name: string; pendingPosts: number }[];
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const showFailures = failures > 0 && !acknowledged;
  if (!showFailures && expired.length === 0) return null;

  async function acknowledge() {
    setBusy(true);
    const result = await postJson<{ ok: true }>("/api/social/posts/acknowledge-failures");
    setBusy(false);
    if (result.ok) setAcknowledged(true);
  }

  return (
    <div className="mt-6 space-y-2" role="status">
      {showFailures && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span className="font-medium">{failedNoticeLine(failures)}</span>
          <span className="ms-auto flex items-center gap-3">
            <Link href="/calendar" className="font-medium underline underline-offset-4">
              {TO_CALENDAR}
            </Link>
            <button
              type="button"
              disabled={busy}
              onClick={() => void acknowledge()}
              className="text-red-700 hover:text-red-900 disabled:opacity-50"
            >
              {NOTICE_ACK}
            </button>
          </span>
        </div>
      )}
      {expired.map((account) => (
        <div
          key={account.id}
          className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <span>{expiredNoticeLine(isolated(account.name), account.pendingPosts)}</span>
          <Link
            href="/home/settings#connections"
            className="ms-auto font-medium underline underline-offset-4"
          >
            {EXPIRED_NOTICE_LINK}
          </Link>
        </div>
      ))}
    </div>
  );
}

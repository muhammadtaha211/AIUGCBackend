"use client";

import Link from "next/link";
import { useState } from "react";
import { Amounts } from "@/components/plans/plan-cards";
import { Button } from "@/components/ui/button";
import {
  checkoutPath,
  CONTINUE_BUSY_LINE,
  CONTINUE_DECLINED_LINK,
  CONTINUE_ORPHANED,
  CONTINUE_UNCONFIRMED_LINE,
  continueButton,
  TERMS_CHECKBOX_PREFIX,
  TERMS_LINK_LABEL,
} from "@/lib/plans-ui";
import { postJson } from "@/lib/use-api";

type Outcome = { outcome: "activated" } | { outcome: "pending" } | { outcome: "orphaned" };

/**
 * The bottom of the continue page (decision 0109): the required terms checkbox
 * and one button that charges the saved card at once. Its own form, not
 * CheckoutForm: there is no page to leave for, and every answer stays here —
 *
 *   activated     a full load of /home/plan?checkout=continued, which also
 *                 refreshes the credits pill
 *   pending       the charge's answer was lost — "do not try again", the form
 *                 locked; the plan page shows the same until it settles
 *   orphaned      charged, but the account had joined a plan another way —
 *                 "do not pay again, write to us", the form locked
 *   402           declined: the line, and the hosted checkout with another card
 *   409, 400, 503 the server's line (a refusal before any charge)
 *   no answer     a network error, a timeout, a 5xx — nobody knows whether the
 *                 card was charged, so it reads exactly like pending. Never
 *                 "try again".
 */
export function ContinueForm({ planCode, priceAgorot }: { planCode: string; priceAgorot: number }) {
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);
  const [locked, setLocked] = useState(false);

  async function charge() {
    setBusy(true);
    setError(null);
    setDeclined(false);
    const result = await postJson<Outcome>("/api/account/intro/continue", {
      planCode,
      acceptedTerms: true,
    });
    if (result.ok && result.body.outcome === "activated") {
      // Stays busy while the browser leaves.
      window.location.assign("/home/plan?checkout=continued");
      return;
    }
    if (result.ok) {
      setLocked(true);
      setError(result.body.outcome === "orphaned" ? CONTINUE_ORPHANED : CONTINUE_UNCONFIRMED_LINE);
      setBusy(false);
      return;
    }
    if (result.status === 0 || (result.status >= 500 && result.status !== 503)) {
      setLocked(true);
      setError(CONTINUE_UNCONFIRMED_LINE);
      setBusy(false);
      return;
    }
    setDeclined(result.status === 402);
    setError(result.error);
    setBusy(false);
  }

  return (
    <div className="mt-6">
      {/* The prefix ends in the preposition ל, so the link follows it with no space. */}
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-ink/[0.08] bg-paper px-3 py-2.5 text-sm text-ink">
        <input
          type="checkbox"
          checked={accepted}
          disabled={busy || locked}
          onChange={(event) => setAccepted(event.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-accent"
        />
        <span>
          {TERMS_CHECKBOX_PREFIX}
          <Link
            href="/terms"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-ink/30 underline-offset-4 hover:decoration-ink"
          >
            {TERMS_LINK_LABEL}
          </Link>
        </span>
      </label>
      {busy && (
        <p role="status" className="mt-4 text-sm text-ink/65">
          {CONTINUE_BUSY_LINE}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className={`mt-4 rounded-lg px-3 py-2.5 text-sm ${
            locked ? "bg-amber-100 text-amber-900" : "bg-red-100 text-red-700"
          }`}
        >
          {error}{" "}
          {declined && (
            <Link href={checkoutPath(planCode)} className="underline underline-offset-2">
              {CONTINUE_DECLINED_LINK}
            </Link>
          )}
        </p>
      )}
      <Button
        type="button"
        size="lg"
        className="mt-5 w-full"
        disabled={!accepted || locked}
        loading={busy}
        onClick={() => void charge()}
      >
        <Amounts line={continueButton(priceAgorot)} />
      </Button>
    </div>
  );
}

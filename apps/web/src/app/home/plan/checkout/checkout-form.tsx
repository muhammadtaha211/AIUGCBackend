"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics-client";
import {
  CHECKOUT_NO_REDIRECT,
  CHECKOUT_PAY_ACTION,
  TERMS_CHECKBOX_PREFIX,
  TERMS_LINK_LABEL,
} from "@/lib/plans-ui";
import { postJson } from "@/lib/use-api";

/**
 * The bottom of the checkout page: the required terms checkbox (exactly the
 * one the plan dialog used to carry — /checkout refuses a body without
 * acceptedTerms: true, and this is where that true comes from) and the one
 * button. A 200 carrying redirectUrl sends the whole window to Sumit's page;
 * anything else stays here with the server's Hebrew line — today's 503 when
 * the pages are not configured, a 400, a 5xx.
 */
export function CheckoutForm({ planCode }: { planCode: string }) {
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    setBusy(true);
    setError(null);
    const result = await postJson<{ redirectUrl?: string }>("/api/account/checkout", {
      planCode,
      acceptedTerms: true,
    });
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }
    if (result.body.redirectUrl) {
      // Stays busy: the button is locked while the browser leaves for Sumit.
      // A beacon, so the step survives the navigation; the redirect URL itself
      // (it carries the email and the business name) is never sent.
      track("checkout_started", { plan: planCode }, { beacon: true });
      window.location.assign(result.body.redirectUrl);
      return;
    }
    setError(CHECKOUT_NO_REDIRECT);
    setBusy(false);
  }

  return (
    <div className="mt-6">
      {/* The prefix ends in the preposition ל, so the link follows it with no space. */}
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-ink/[0.08] bg-paper px-3 py-2.5 text-sm text-ink">
        <input
          type="checkbox"
          checked={accepted}
          disabled={busy}
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
      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}
      <Button
        type="button"
        size="lg"
        className="mt-5 w-full"
        disabled={!accepted}
        loading={busy}
        onClick={() => void pay()}
      >
        {CHECKOUT_PAY_ACTION}
      </Button>
    </div>
  );
}

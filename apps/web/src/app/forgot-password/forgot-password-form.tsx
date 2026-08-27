"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { requestPasswordReset } from "@/lib/auth";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ForgotPasswordForm({ linkExpired }: { linkExpired: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(
    linkExpired ? "הקישור פג תוקף או שכבר נעשה בו שימוש — בקשו קישור חדש." : null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!EMAIL_PATTERN.test(email.trim())) {
      setError("כתובת המייל לא נראית תקינה.");
      return;
    }
    setError(null);
    setSubmitting(true);
    const result = await requestPasswordReset(email.trim());
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // Drop a stale ?error=expired so a refresh shows the clean form again,
    // not last link's failure over the one that was just sent.
    router.replace("/forgot-password");
    setSent(true);
  }

  if (sent) {
    // The PKCE verifier lives in this browser's cookies, so the link only
    // works where it was requested — hence the "same browser" line.
    return (
      <div className="mt-6">
        <p
          role="alert"
          className="rounded-lg bg-accent/10 px-3 py-2.5 text-sm leading-relaxed text-gray-200 light:text-ink"
        >
          אם קיים חשבון עם האימייל הזה, הקישור בדרך אליכם. פתחו אותו כאן, באותו דפדפן שממנו ביקשתם
          אותו.
        </p>
        <p className="mt-4 text-center text-sm text-gray-400 light:text-ink/60">
          <button
            type="button"
            onClick={() => setSent(false)}
            className="font-medium text-white underline decoration-white/30 underline-offset-4 light:text-ink light:decoration-ink/30"
          >
            לא הגיע? שליחה מחדש
          </button>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-6">
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-red-500/10 px-3 py-2.5 text-sm text-red-300 light:bg-red-100 light:text-red-700"
        >
          {error}
        </p>
      )}

      <TextField
        label="אימייל"
        type="email"
        dir="ltr"
        autoComplete="email"
        placeholder="name@business.co.il"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <Button type="submit" size="lg" className="mt-5 w-full" loading={submitting}>
        שליחת קישור לאיפוס
      </Button>
    </form>
  );
}

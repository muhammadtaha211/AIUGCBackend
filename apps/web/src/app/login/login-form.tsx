"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { GoogleG } from "@/components/ui/icons";
import { GOOGLE_SIGN_IN_ENABLED, signIn, signUpWithGoogle } from "@/lib/auth";
import {
  afterSignupPath,
  DRAFT_WAITING_PARAM,
  peekDraftPlan,
  postParkedDraft,
} from "@/lib/onboarding";

/** `initialError` seeds the inline message — a Google failure sent here by
 *  /auth/callback. Any later submit replaces it. */
export function LoginForm({ initialError = null }: { initialError?: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(initialError);
  const [submitting, setSubmitting] = useState<"email" | "google" | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim() || !password) {
      setError("מלאו אימייל וסיסמה כדי להיכנס.");
      return;
    }
    setError(null);
    setSubmitting("email");
    const result = await signIn(email.trim(), password);
    if (!result.ok) {
      setSubmitting(null);
      setError(result.error);
      return;
    }
    // A wizard draft left from before the account existed: finish it now.
    //
    // A 200 does NOT mean it was saved. The route is idempotent by OWNER, not
    // by content: someone who already has a business gets that business back
    // and `stored: false`, and the answers they just filled in were never
    // written. Clearing on any 200 destroyed exactly that questionnaire —
    // docs/vault/defects/login-clears-a-draft-the-server-never-stored.md.
    //
    // "parked" also covers a 200 whose body we could not read. That is the
    // rule, not an edge case: never clear a draft on a response we did not
    // understand. The draft is the only copy of those answers; the response is
    // a guess about them.
    // Read before the post: a stored draft is cleared from localStorage, and
    // the plan the visitor picked on /pricing rides in it. Someone who
    // confirmed their email and came back through this form is the same
    // signup the wizard's own completion sends to /home/plan.
    const plan = peekDraftPlan();
    const handoff = await postParkedDraft();
    // The marker is read by /home/new-business/page.tsx, which opens the
    // "הוסף עסק" wizard with the kept answers already filled in.
    router.push(
      handoff === "parked"
        ? `/home/new-business?${DRAFT_WAITING_PARAM}=1`
        : handoff === "stored"
          ? afterSignupPath(plan)
          : "/home",
    );
  }

  async function handleGoogle() {
    setError(null);
    setSubmitting("google");
    // On success the browser navigates to Google — we only return on failure.
    const result = await signUpWithGoogle();
    if (!result.ok) {
      setSubmitting(null);
      setError(result.error);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-6">
      {/* Above both buttons, so the line covers Google and email alike. */}
      <p className="mb-4 text-sm text-gray-400 light:text-ink/60">
        הכניסה מהווה הסכמה ל
        <Link
          href="/terms"
          target="_blank"
          rel="noopener"
          className="font-medium text-white underline decoration-white/30 underline-offset-4 light:text-ink light:decoration-ink/30"
        >
          תנאי השימוש
        </Link>{" "}
        ול
        <Link
          href="/privacy"
          target="_blank"
          rel="noopener"
          className="font-medium text-white underline decoration-white/30 underline-offset-4 light:text-ink light:decoration-ink/30"
        >
          מדיניות הפרטיות
        </Link>
        .
      </p>

      {/* Button and divider together: a divider with nothing above it reads
          as a broken layout, not as "email only". */}
      {GOOGLE_SIGN_IN_ENABLED && (
        <>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="w-full"
            onClick={handleGoogle}
            loading={submitting === "google"}
            disabled={submitting === "email"}
          >
            {submitting !== "google" && <GoogleG />}
            כניסה עם Google
          </Button>

          <div className="my-4 flex items-center gap-3 text-xs text-gray-400 light:text-ink/60">
            <span className="h-px flex-1 bg-white/10 light:bg-ink/10" />
            או
            <span className="h-px flex-1 bg-white/10 light:bg-ink/10" />
          </div>
        </>
      )}

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-red-500/10 px-3 py-2.5 text-sm text-red-300 light:bg-red-100 light:text-red-700"
        >
          {error}
        </p>
      )}

      <div className="space-y-4">
        <TextField
          label="אימייל"
          type="email"
          dir="ltr"
          autoComplete="email"
          placeholder="name@business.co.il"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <TextField
          label="סיסמה"
          type="password"
          dir="ltr"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <Button
        type="submit"
        size="lg"
        className="mt-5 w-full"
        loading={submitting === "email"}
        disabled={submitting === "google"}
      >
        כניסה
      </Button>
    </form>
  );
}

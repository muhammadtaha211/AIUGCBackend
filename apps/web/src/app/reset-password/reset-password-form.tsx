"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { updatePassword, verifyRecoveryToken } from "@/lib/auth";
import { createClient } from "@/lib/supabase/client";

export function ResetPasswordForm({ tokenHash }: { tokenHash?: string }) {
  const router = useRouter();
  const [session, setSession] = useState<"checking" | "ok" | "missing">("checking");
  const [verified, setVerified] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (tokenHash) {
      // Token from the email itself — nothing to check until submit.
      setSession("ok");
      return;
    }
    createClient()
      .auth.getSession()
      .then(({ data }) => setSession(data.session ? "ok" : "missing"))
      .catch(() => setSession("missing"));
  }, [tokenHash]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const nextErrors: typeof errors = {};
    if (password.length < 8) nextErrors.password = "לפחות 8 תווים";
    if (confirm !== password) nextErrors.confirm = "הסיסמאות לא זהות";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setFormError(null);
    setSubmitting(true);
    // The token is one-time: verify it once, so a failed password update
    // (e.g. same_password) can be retried without burning another link.
    if (tokenHash && !verified) {
      const verifyResult = await verifyRecoveryToken(tokenHash);
      if (!verifyResult.ok) {
        setSubmitting(false);
        setSession("missing");
        return;
      }
      setVerified(true);
    }
    const result = await updatePassword(password);
    if (!result.ok) {
      setFormError(result.error);
      setSubmitting(false);
      return;
    }
    router.push("/home");
  }

  if (session === "checking") return null;

  if (session === "missing") {
    return (
      <div className="mt-6">
        <p
          role="alert"
          className="rounded-lg bg-red-500/10 px-3 py-2.5 text-sm text-red-300 light:bg-red-100 light:text-red-700"
        >
          אין כאן איפוס פעיל — הקישור פג תוקף או שנפתח בדפדפן אחר.
        </p>
        <p className="mt-4 text-center text-sm text-gray-400 light:text-ink/60">
          <Link
            href="/forgot-password"
            className="font-medium text-white underline decoration-white/30 underline-offset-4 light:text-ink light:decoration-ink/30"
          >
            לבקשת קישור חדש
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-6">
      {formError && (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-red-500/10 px-3 py-2.5 text-sm text-red-300 light:bg-red-100 light:text-red-700"
        >
          {formError}
        </p>
      )}

      <div className="space-y-4">
        <TextField
          label="סיסמה חדשה"
          hint="8 תווים לפחות"
          type="password"
          dir="ltr"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
        />
        <TextField
          label="אימות סיסמה"
          type="password"
          dir="ltr"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={errors.confirm}
        />
      </div>

      <Button type="submit" size="lg" className="mt-5 w-full" loading={submitting}>
        שמירת הסיסמה
      </Button>
    </form>
  );
}

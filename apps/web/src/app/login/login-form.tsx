"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { GoogleG } from "@/components/ui/icons";
import { signIn, signUpWithGoogle } from "@/lib/auth";
import { clearDraft, loadDraft } from "@/lib/onboarding";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
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
    // The server is idempotent — existing owners just get their business back.
    const draft = loadDraft();
    if (draft) {
      try {
        const response = await fetch("/api/onboarding/complete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(draft),
        });
        if (response.ok) clearDraft();
      } catch {
        // Leave the draft in place; /home works without it.
      }
    }
    router.push("/home");
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

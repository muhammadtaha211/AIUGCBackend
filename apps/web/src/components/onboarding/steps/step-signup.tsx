"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { Check, GoogleG } from "@/components/ui/icons";
import { signUp, signUpWithGoogle } from "@/lib/auth";
import { StepHeader } from "./step-chrome";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type StepSignupProps = {
  productName: string;
  whatItDoes: string;
  benefitCount: number;
  audience: string;
  /** Surfaced when a signed-in return visit failed to save the draft. */
  initialError?: string | null;
  /** Persists the draft; resolves to a Hebrew error, or null when navigating away. */
  onDone: () => Promise<string | null>;
  onBack: () => void;
};

export function StepSignup({
  productName,
  whatItDoes,
  benefitCount,
  audience,
  initialError,
  onDone,
  onBack,
}: StepSignupProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string; confirm?: string }>({});
  const [formError, setFormError] = useState<string | null>(initialError ?? null);
  const [submitting, setSubmitting] = useState<"email" | "google" | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const nextErrors: typeof errors = {};
    if (!EMAIL_PATTERN.test(email.trim())) nextErrors.email = "כתובת המייל לא נראית תקינה";
    if (password.length < 8) nextErrors.password = "לפחות 8 תווים";
    if (confirm !== password) nextErrors.confirm = "הסיסמאות לא זהות";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setFormError(null);
    setSubmitting("email");
    const result = await signUp(email.trim(), password);
    if (!result.ok) {
      setFormError(result.error);
      setSubmitting(null);
      return;
    }
    const doneError = await onDone();
    if (doneError) {
      setFormError(doneError);
      setSubmitting(null);
    }
  }

  async function handleGoogle() {
    setFormError(null);
    setSubmitting("google");
    // On success the browser navigates to Google — we only return on failure.
    const result = await signUpWithGoogle();
    if (!result.ok) {
      setFormError(result.error);
      setSubmitting(null);
    }
  }

  const recap = [
    `${productName} · ${whatItDoes}`,
    benefitCount === 1 ? "יתרון אחד להדגשה" : `${benefitCount} יתרונות להדגשה`,
    `קהל היעד: ${audience}`,
  ];

  return (
    <form onSubmit={handleSubmit} noValidate>
      <StepHeader
        title="שומרים ויוצרים את המודעות"
        sub="הכל מוכן. נשאר רק לחבר את זה לחשבון, וכל מה שמילאתם נשמר."
        onBack={onBack}
      />

      <ul className="mt-6 space-y-2 rounded-xl bg-white/5 p-4 light:bg-paper">
        {recap.map((line, index) => (
          <li
            key={index}
            className="flex items-start gap-2 text-sm text-gray-300 light:text-ink/75"
          >
            <Check className="mt-0.5 size-4 shrink-0 text-accent" />
            <span dir="auto" className="min-w-0 truncate">
              {line}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-6">
        {formError && (
          <p
            role="alert"
            className="mb-4 rounded-lg bg-red-500/10 px-3 py-2.5 text-sm text-red-300 light:bg-red-100 light:text-red-700"
          >
            {formError}
          </p>
        )}

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
          המשך עם Google
        </Button>

        <div className="my-5 flex items-center gap-3 text-xs text-gray-500 light:text-ink/60">
          <span className="h-px flex-1 bg-white/10 light:bg-ink/10" />
          או
          <span className="h-px flex-1 bg-white/10 light:bg-ink/10" />
        </div>

        <div className="space-y-5">
          <TextField
            label="אימייל"
            type="email"
            dir="ltr"
            autoComplete="email"
            placeholder="name@business.co.il"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={errors.email}
          />
          <TextField
            label="סיסמה"
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

        <Button
          type="submit"
          size="lg"
          className="mt-7 w-full"
          loading={submitting === "email"}
          disabled={submitting === "google"}
        >
          {submitting === "email" ? "שומרים…" : "המשך"}
        </Button>

        <p className="mt-5 text-center text-sm text-gray-400 light:text-ink/60">
          כבר יש לכם חשבון?{" "}
          <Link
            href="/login"
            className="font-medium text-white underline decoration-white/30 underline-offset-4 light:text-ink light:decoration-ink/30"
          >
            כניסה
          </Link>
        </p>
      </div>
    </form>
  );
}

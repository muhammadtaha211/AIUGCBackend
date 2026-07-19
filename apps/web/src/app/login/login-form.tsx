"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { GoogleG } from "@/components/ui/icons";
import { signIn } from "@/lib/auth";

export function LoginForm() {
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
    setSubmitting(null);
    if (!result.ok) setError(result.error);
  }

  async function handleGoogle() {
    setError(null);
    setSubmitting("google");
    const result = await signIn("", "");
    setSubmitting(null);
    if (!result.ok) setError(result.error);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-8">
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

      <div className="my-5 flex items-center gap-3 text-xs text-gray-400">
        <span className="h-px flex-1 bg-white/10" />
        או
        <span className="h-px flex-1 bg-white/10" />
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="space-y-5">
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
        className="mt-7 w-full"
        loading={submitting === "email"}
        disabled={submitting === "google"}
      >
        כניסה
      </Button>
    </form>
  );
}

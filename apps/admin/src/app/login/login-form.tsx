"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { signIn, signOut } from "@/lib/auth";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim() || !password) {
      setError("מלאו אימייל וסיסמה כדי להיכנס.");
      return;
    }
    setError(null);
    setSubmitting(true);
    const result = await signIn(email.trim(), password);
    if (!result.ok) {
      setSubmitting(false);
      setError(result.error);
      return;
    }

    // Valid credentials but not an admin: sign the session back out and show
    // the same generic rejection as bad credentials — this origin reveals
    // nothing about which accounts exist or what roles are.
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: rows } = user
      ? await supabase.from("users").select("role").eq("id", user.id).limit(1)
      : { data: null };
    if (rows?.[0]?.role !== "admin") {
      await signOut();
      setSubmitting(false);
      setError("לא מצאנו חשבון עם הפרטים האלה.");
      return;
    }

    // Full navigation so the middleware re-evaluates with the fresh cookies.
    window.location.assign("/personas");
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-8">
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

      <Button type="submit" size="lg" className="mt-7 w-full" loading={submitting}>
        כניסה
      </Button>
    </form>
  );
}

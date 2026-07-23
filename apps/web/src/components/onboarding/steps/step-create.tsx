"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Check } from "@/components/ui/icons";
import { StepHeader } from "./step-chrome";

type StepCreateProps = {
  productName: string;
  whatItDoes: string;
  benefitCount: number;
  audience: string;
  /** Persists the business; resolves to a Hebrew error, or null when navigating away. */
  onCreate: () => Promise<string | null>;
  onBack: () => void;
};

/**
 * Final step of the signed-in "הוסף עסק" wizard — the account already exists,
 * so instead of signup there is only a recap and a create button.
 */
export function StepCreate({
  productName,
  whatItDoes,
  benefitCount,
  audience,
  onCreate,
  onBack,
}: StepCreateProps) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleCreate() {
    setError(null);
    setSubmitting(true);
    const createError = await onCreate();
    if (createError) {
      setError(createError);
      setSubmitting(false);
    }
  }

  const recap = [
    `${productName} — ${whatItDoes}`,
    benefitCount === 1 ? "יתרון אחד להדגשה" : `${benefitCount} יתרונות להדגשה`,
    `קהל היעד: ${audience}`,
  ];

  return (
    <div>
      <StepHeader
        title="מוסיפים את העסק"
        sub="ככה שמרנו את הפרטים — אפשר לחזור אחורה ולתקן, או להוסיף את העסק לחשבון."
        onBack={onBack}
      />

      <ul className="mt-6 space-y-2 rounded-xl bg-white/5 p-4">
        {recap.map((line, index) => (
          <li key={index} className="flex items-start gap-2 text-sm text-gray-300">
            <Check className="mt-0.5 size-4 shrink-0 text-accent" />
            <span dir="auto" className="min-w-0 truncate">
              {line}
            </span>
          </li>
        ))}
      </ul>

      {error && (
        <p role="alert" className="mt-6 rounded-lg bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
          {error}
        </p>
      )}

      <Button
        type="button"
        size="lg"
        className="mt-7 w-full"
        onClick={handleCreate}
        loading={submitting}
      >
        {submitting ? "שומרים…" : "הוסף את העסק"}
      </Button>
    </div>
  );
}

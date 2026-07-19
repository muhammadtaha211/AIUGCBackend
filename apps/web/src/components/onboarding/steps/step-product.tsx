"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TextField, TextAreaField } from "@/components/ui/field";
import type { BusinessType } from "@/lib/onboarding";
import { StepHeader } from "./step-chrome";

const PLACEHOLDERS: Record<BusinessType | "default", { name: string; what: string }> = {
  physical: { name: "למשל: קרם לחות אלוורה", what: "למשל: קרם טבעי שמרגיע עור יבש תוך שבוע" },
  app: { name: "למשל: FitTime", what: "למשל: אפליקציה לאימונים קצרים בבית, בלי ציוד" },
  service: { name: "למשל: קליניקת גלואו", what: "למשל: קליניקה לטיפולי פנים מתקדמים בתל אביב" },
  other: { name: "השם שהלקוחות מכירים", what: "מה אתם מציעים ולמה זה טוב, במשפט אחד" },
  default: { name: "השם שהלקוחות מכירים", what: "מה המוצר עושה ולמה הוא טוב, במשפט אחד" },
};

type StepProductProps = {
  businessType: BusinessType | null;
  productName: string;
  whatItDoes: string;
  link: string;
  onSubmit: (values: { productName: string; whatItDoes: string; link: string }) => void;
  onBack: () => void;
};

export function StepProduct({
  businessType,
  productName,
  whatItDoes,
  link,
  onSubmit,
  onBack,
}: StepProductProps) {
  const [name, setName] = useState(productName);
  const [what, setWhat] = useState(whatItDoes);
  const [siteLink, setSiteLink] = useState(link);
  const [showLink, setShowLink] = useState(link !== "");
  const [errors, setErrors] = useState<{ name?: string; what?: string }>({});

  const placeholders = PLACEHOLDERS[businessType ?? "default"];
  const isService = businessType === "service";

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const nextErrors: typeof errors = {};
    if (!name.trim()) nextErrors.name = "צריך שם כדי להמשיך";
    if (!what.trim()) nextErrors.what = "משפט אחד קצר מספיק";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    onSubmit({ productName: name.trim(), whatItDoes: what.trim(), link: siteLink.trim() });
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <StepHeader title={isService ? "איך קוראים לעסק?" : "איך קוראים למוצר?"} onBack={onBack} />

      <div className="mt-7 space-y-6">
        <TextField
          label={isService ? "שם העסק" : "שם המוצר"}
          placeholder={placeholders.name}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
          autoFocus
        />
        <TextAreaField
          label="מה הוא עושה? משפט אחד."
          placeholder={placeholders.what}
          rows={2}
          value={what}
          onChange={(e) => setWhat(e.target.value)}
          error={errors.what}
        />

        {showLink ? (
          <TextField
            label="קישור לאתר או לעמוד המוצר"
            hint="רשות"
            placeholder="https://"
            dir="ltr"
            inputMode="url"
            value={siteLink}
            onChange={(e) => setSiteLink(e.target.value)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowLink(true)}
            className="text-[13px] text-gray-400 underline decoration-white/25 underline-offset-4 transition-colors duration-150 hover:text-gray-200"
          >
            הוספת קישור לאתר (רשות)
          </button>
        )}
      </div>

      <Button type="submit" size="lg" className="mt-9 w-full sm:w-auto sm:min-w-36">
        המשך
      </Button>
    </form>
  );
}

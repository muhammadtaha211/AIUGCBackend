"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import type { BusinessType } from "@/lib/onboarding";
import { StepHeader } from "./step-chrome";

/** questionnaireSchema allows up to 8 features. */
const MAX_BENEFITS = 8;

const EXAMPLES: Record<BusinessType | "default", string[]> = {
  physical: ["מרגיע עור יבש תוך שבוע", "100% טבעי, מיוצר בישראל", "משלוח חינם עד הבית"],
  app: ["אימון של 20 דקות בבית", "בלי ציוד ובלי מנוי לחדר כושר", "שבוע ניסיון חינם"],
  service: ["תוצאות כבר מהטיפול הראשון", "צוות עם ניסיון של 10+ שנים", "קביעת תור אונליין תוך דקה"],
  other: ["מה מייחד אתכם מהמתחרים", "יתרון שכל לקוח מציין", "מבצע או הטבה שרצה עכשיו"],
  default: ["מה מייחד אתכם מהמתחרים", "יתרון שכל לקוח מציין", "מבצע או הטבה שרצה עכשיו"],
};

type StepBenefitsProps = {
  businessType: BusinessType | null;
  benefits: string[];
  onChange: (benefits: string[]) => void;
  onSubmit: () => void;
  onBack: () => void;
};

export function StepBenefits({
  businessType,
  benefits,
  onChange,
  onSubmit,
  onBack,
}: StepBenefitsProps) {
  const [error, setError] = useState<string | null>(null);
  const examples = EXAMPLES[businessType ?? "default"];

  function setBenefit(index: number, value: string) {
    const next = [...benefits];
    next[index] = value;
    onChange(next);
    if (error && value.trim()) setError(null);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!benefits.some((benefit) => benefit.trim())) {
      setError("יתרון אחד מספיק כדי להמשיך");
      return;
    }
    onSubmit();
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <StepHeader
        title="מה חשוב שהלקוחות ידעו?"
        sub="כל יתרון שתכתבו יהפוך לכתובית במודעה. אחד מספיק בשביל להתחיל."
        onBack={onBack}
      />

      <div className="mt-7 space-y-4">
        {benefits.map((benefit, index) => (
          <TextField
            key={index}
            label={`יתרון ${index + 1}`}
            hint={index > 0 ? "רשות" : undefined}
            placeholder={`למשל: ${examples[index % examples.length]}`}
            value={benefit}
            onChange={(e) => setBenefit(index, e.target.value)}
            error={index === 0 ? (error ?? undefined) : undefined}
            autoFocus={index === 0}
          />
        ))}

        {benefits.length < MAX_BENEFITS && (
          <button
            type="button"
            onClick={() => onChange([...benefits, ""])}
            className="text-[13px] text-gray-400 underline decoration-white/25 underline-offset-4 transition-colors duration-150 hover:text-gray-200"
          >
            עוד יתרון
          </button>
        )}
      </div>

      <Button type="submit" size="lg" className="mt-9 w-full sm:w-auto sm:min-w-36">
        המשך
      </Button>
    </form>
  );
}

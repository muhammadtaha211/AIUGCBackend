"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { OptionCard } from "@/components/ui/option-card";
import { recommendedTone, TONE_LABELS, type BusinessType, type Tone } from "@/lib/onboarding";
import { StepHeader } from "./step-chrome";

const AUDIENCE_SUGGESTIONS = [
  "נשים 25–45",
  "גברים 25–45",
  "הורים לילדים קטנים",
  "בעלי עסקים",
  "צעירים 18–30",
];

const TONES: Tone[] = ["friendly", "direct", "professional"];

type StepAudienceProps = {
  businessType: BusinessType | null;
  audience: string;
  tone: Tone;
  onAudienceChange: (audience: string) => void;
  onToneChange: (tone: Tone) => void;
  onSubmit: () => void;
  onBack: () => void;
};

export function StepAudience({
  businessType,
  audience,
  tone,
  onAudienceChange,
  onToneChange,
  onSubmit,
  onBack,
}: StepAudienceProps) {
  const [error, setError] = useState<string | null>(null);
  const recommended = recommendedTone(businessType);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!audience.trim()) {
      setError("כמה מילים על קהל היעד יעזרו לכתוב מודעה מדויקת");
      return;
    }
    onSubmit();
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <StepHeader title="למי המודעה מיועדת?" sub="שאלה אחרונה לפני שיוצרים." onBack={onBack} />

      <div className="mt-7">
        <TextField
          label="קהל היעד"
          placeholder="למשל: נשים 30–50 שמתעניינות בטיפוח טבעי"
          value={audience}
          onChange={(e) => {
            onAudienceChange(e.target.value);
            if (error && e.target.value.trim()) setError(null);
          }}
          error={error ?? undefined}
          autoFocus
        />
        <div className="mt-2.5 flex flex-wrap gap-2">
          {AUDIENCE_SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => {
                onAudienceChange(suggestion);
                setError(null);
              }}
              className="rounded-full border border-white/15 px-3 py-1 text-[13px] text-gray-300 transition-colors duration-150 hover:border-white/30 hover:text-white"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-8">
        <p className="mb-3 text-sm font-medium text-gray-200">באיזה סגנון המודעה תדבר?</p>
        <div role="radiogroup" aria-label="סגנון המודעה" className="grid gap-3 sm:grid-cols-3">
          {TONES.map((value) => (
            <OptionCard
              key={value}
              title={TONE_LABELS[value].title}
              description={TONE_LABELS[value].description}
              selected={tone === value}
              badge={value === recommended ? "מומלץ" : undefined}
              onSelect={() => onToneChange(value)}
            />
          ))}
        </div>
      </div>

      <Button type="submit" size="lg" className="mt-9 w-full sm:w-auto sm:min-w-36">
        המשך
      </Button>
    </form>
  );
}

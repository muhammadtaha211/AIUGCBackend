"use client";

import { StepHeader } from "@/components/onboarding/steps/step-chrome";
import { Button } from "@/components/ui/button";
import { TextAreaField } from "@/components/ui/field";

type StepPointersProps = {
  pointers: string;
  setPointers: (value: string) => void;
  onBack: () => void;
  onContinue: () => void;
};

/**
 * Step 2: what the persona should say — free-text pointers for the script
 * call. Optional; the questionnaire alone is enough to write from. The
 * script itself is generated on the next step, so nothing is spent here.
 */
export function StepPointers({ pointers, setPointers, onBack, onContinue }: StepPointersProps) {
  return (
    <div>
      <StepHeader
        title="מה הדמות אומרת?"
        sub="כמה מילים על מה חשוב להדגיש, ואנחנו נכתוב תסריט בעברית לפי שאלון העסק."
        onBack={onBack}
      />

      <div className="mt-6 space-y-6">
        <TextAreaField
          label="הנחיות לתסריט"
          hint="לא חובה"
          rows={3}
          maxLength={500}
          placeholder="למשל: לפתוח עם המשלוח המהיר, להזכיר את ההנחה של החודש"
          value={pointers}
          onChange={(event) => setPointers(event.target.value)}
        />

        {/* No concrete duration: the 15s preset is a word budget (15 ×
            app_config.words_per_second), and words_per_second is uncalibrated —
            measured narration runs ~2.1–3.8 words/sec, so real output spans
            roughly 9–16s. Naming a number HERE would be naming the preset,
            which is exactly the uncalibrated thing. The script step does name
            one (step-script.tsx), but only once there is text to measure and
            only hedged with בערך — a different claim, from different data. */}
        <p className="text-sm text-ink/60">
          הסרטון יהיה קצר וקולע, באורך שמתאים לפרסום ברשתות החברתיות.
        </p>
      </div>

      <Button type="button" size="lg" className="mt-7 w-full" onClick={onContinue}>
        המשך
      </Button>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { saveSession } from "@/lib/auth";
import {
  clearDraft,
  emptyDraft,
  loadDraft,
  recommendedTone,
  saveDraft,
  STEP_PROGRESS,
  STEPS,
  type BusinessType,
  type OnboardingDraft,
} from "@/lib/onboarding";
import { OnboardingShell } from "./onboarding-shell";
import { StepAudience } from "./steps/step-audience";
import { StepBenefits } from "./steps/step-benefits";
import { StepBusiness } from "./steps/step-business";
import { StepProduct } from "./steps/step-product";
import { StepSignup } from "./steps/step-signup";

function ProgressHeader({ value }: { value: number }) {
  // Starts at 0 and fills on the next frame, so the first appearance animates too.
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setWidth(value));
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium text-gray-300">
          {value >= STEP_PROGRESS.signup ? "שלב אחרון" : "המודעה הראשונה שלכם"}
        </span>
        <span dir="ltr" className="tabular-nums text-gray-500">
          {value}%
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

export function OnboardingFlow() {
  const router = useRouter();
  const [draft, setDraft] = useState<OnboardingDraft>(emptyDraft);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const saved = loadDraft();
    if (saved) setDraft(saved);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) saveDraft(draft);
  }, [draft, hydrated]);

  const patch = (partial: Partial<OnboardingDraft>) => setDraft((d) => ({ ...d, ...partial }));

  const goTo = (step: number) => {
    patch({ step });
    window.scrollTo({ top: 0 });
  };

  function selectBusiness(businessType: BusinessType) {
    setDraft((d) => ({
      ...d,
      businessType,
      tone: d.tone ?? recommendedTone(businessType),
      step: 1,
    }));
  }

  /** Signup done: open the dev session, drop the draft, land on the homepage. */
  function completeSignup(email: string) {
    saveSession(email);
    clearDraft();
    router.push("/home");
  }

  const stepId = STEPS[draft.step] ?? "business";

  if (!hydrated) {
    // One frame at most — avoids flashing step 0 before the saved draft loads.
    return <div className="min-h-dvh" />;
  }

  const step = (() => {
    switch (stepId) {
      case "business":
        return <StepBusiness selected={draft.businessType} onSelect={selectBusiness} />;
      case "product":
        return (
          <StepProduct
            businessType={draft.businessType}
            productName={draft.productName}
            whatItDoes={draft.whatItDoes}
            link={draft.link}
            onSubmit={(values) => {
              patch(values);
              goTo(2);
            }}
            onBack={() => goTo(0)}
          />
        );
      case "benefits":
        return (
          <StepBenefits
            businessType={draft.businessType}
            benefits={draft.benefits}
            onChange={(benefits) => patch({ benefits })}
            onSubmit={() => goTo(3)}
            onBack={() => goTo(1)}
          />
        );
      case "audience":
        return (
          <StepAudience
            businessType={draft.businessType}
            audience={draft.audience}
            tone={draft.tone ?? recommendedTone(draft.businessType)}
            onAudienceChange={(audience) => patch({ audience })}
            onToneChange={(tone) => patch({ tone })}
            onSubmit={() => goTo(4)}
            onBack={() => goTo(2)}
          />
        );
      case "signup":
        return (
          <StepSignup
            productName={draft.productName}
            whatItDoes={draft.whatItDoes}
            benefitCount={draft.benefits.filter((benefit) => benefit.trim()).length}
            audience={draft.audience}
            onDone={completeSignup}
            onBack={() => goTo(3)}
          />
        );
    }
  })();

  // One shell for every step: the scene stays put, only the questionnaire changes.
  return (
    <OnboardingShell>
      {stepId === "business" ? (
        <div key={draft.step} className="step-in w-full">
          {step}
        </div>
      ) : (
        <div id="onboarding-content" className="w-full max-w-2xl pt-6 sm:pt-10">
          <ProgressHeader value={STEP_PROGRESS[stepId]} />
          <div key={draft.step} className="step-in mt-5">
            <div className="rounded-xl border border-white/10 bg-white/5 p-6 sm:p-10">{step}</div>
          </div>
        </div>
      )}
    </OnboardingShell>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
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
import { BUSINESS_COOKIE } from "@/lib/service-b-ui";
import { OnboardingShell } from "./onboarding-shell";
import { StepAudience } from "./steps/step-audience";
import { StepBenefits } from "./steps/step-benefits";
import { StepBusiness } from "./steps/step-business";
import { StepCreate } from "./steps/step-create";
import { StepProduct } from "./steps/step-product";
import { StepSignup } from "./steps/step-signup";

function ProgressHeader({ value, label }: { value: number; label: string }) {
  // Starts at 0 and fills on the next frame, so the first appearance animates too.
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setWidth(value));
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium text-gray-300 light:text-ink/70">
          {value >= STEP_PROGRESS.signup ? "שלב אחרון" : label}
        </span>
        <span dir="ltr" className="tabular-nums text-gray-500 light:text-ink/60">
          {value}%
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10 light:bg-ink/10">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

/** POST the draft to the server; resolves to the created business, or a Hebrew error. */
async function postDraft(
  draft: OnboardingDraft,
  allowCreate = false,
): Promise<{ businessId: string } | { error: string }> {
  try {
    const response = await fetch("/api/onboarding/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(allowCreate ? { ...draft, allowCreate } : draft),
    });
    const body = (await response.json().catch(() => null)) as {
      error?: string;
      businessId?: string;
    } | null;
    if (!response.ok || !body?.businessId) {
      return { error: body?.error ?? "השמירה נכשלה. נסו שוב בעוד רגע." };
    }
    return { businessId: body.businessId };
  } catch {
    return { error: "בעיית תקשורת — בדקו את החיבור ונסו שוב." };
  }
}

type OnboardingFlowProps = {
  /**
   * "signup" — the public wizard: draft persisted to localStorage, ends with
   * account creation. "additional" — the signed-in "הוסף עסק" wizard: state is
   * in-memory only and the final step creates another business (allowCreate).
   */
  mode?: "signup" | "additional";
};

export function OnboardingFlow({ mode = "signup" }: OnboardingFlowProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<OnboardingDraft>(emptyDraft);
  const [hydrated, setHydrated] = useState(mode === "additional");
  const [completionError, setCompletionError] = useState<string | null>(null);

  useEffect(() => {
    if (mode === "additional") return;
    const saved = loadDraft();
    if (saved) setDraft(saved);

    // Returning from the OAuth redirect (or already signed in) with a finished
    // draft: persist it server-side and land on the homepage — no wizard flash.
    (async () => {
      if (saved && saved.step === STEPS.length - 1) {
        const { data } = await createClient().auth.getSession();
        if (data.session) {
          const result = await postDraft(saved);
          if ("businessId" in result) {
            clearDraft();
            router.replace("/home");
            return;
          }
          setCompletionError("החשבון מחובר אבל השמירה נכשלה — רעננו את העמוד כדי לנסות שוב.");
        }
      }
      setHydrated(true);
    })();
  }, [mode, router]);

  useEffect(() => {
    if (hydrated && mode === "signup") saveDraft(draft);
  }, [draft, hydrated, mode]);

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

  /** Account exists (password or OAuth): persist the draft, land on the homepage. */
  async function completeSignup(): Promise<string | null> {
    const result = await postDraft(draft);
    if ("error" in result) return result.error;
    clearDraft();
    router.push("/home");
    return null;
  }

  /** Signed-in "הוסף עסק": create an additional business and make it the selected one. */
  async function completeAdditional(): Promise<string | null> {
    const result = await postDraft(draft, true);
    if ("error" in result) return result.error;
    document.cookie = `${BUSINESS_COOKIE}=${result.businessId}; path=/; max-age=31536000`;
    router.push("/home");
    return null;
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
            wow={draft.wow}
            onChange={(benefits) => patch({ benefits })}
            onWowChange={(wow) => patch({ wow })}
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
        return mode === "additional" ? (
          <StepCreate
            productName={draft.productName}
            whatItDoes={draft.whatItDoes}
            benefitCount={draft.benefits.filter((benefit) => benefit.trim()).length}
            audience={draft.audience}
            onCreate={completeAdditional}
            onBack={() => goTo(3)}
          />
        ) : (
          <StepSignup
            productName={draft.productName}
            whatItDoes={draft.whatItDoes}
            benefitCount={draft.benefits.filter((benefit) => benefit.trim()).length}
            audience={draft.audience}
            initialError={completionError}
            onDone={completeSignup}
            onBack={() => goTo(3)}
          />
        );
    }
  })();

  // One shell for every step: the scene stays put, only the questionnaire changes.
  const content =
    stepId === "business" ? (
      <div key={draft.step} className="step-in w-full">
        {step}
      </div>
    ) : (
      <div id="onboarding-content" className="w-full max-w-2xl pt-6 sm:pt-10">
        <ProgressHeader
          value={STEP_PROGRESS[stepId]}
          label={mode === "additional" ? "עסק חדש" : "המודעה הראשונה שלכם"}
        />
        <div key={draft.step} className="step-in mt-5">
          <div className="rounded-xl border border-white/10 bg-white/5 p-6 light:border-ink/[0.08] light:bg-white light:shadow-xl light:shadow-ink/[0.05] sm:p-10">
            {step}
          </div>
        </div>
      </div>
    );

  // In additional mode the /home/new-business page provides the chrome.
  return mode === "signup" ? <OnboardingShell>{content}</OnboardingShell> : content;
}

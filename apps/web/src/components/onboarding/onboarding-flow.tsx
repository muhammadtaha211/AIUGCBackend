"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { isNewGoogleAccount } from "@/lib/analytics";
import { track } from "@/lib/analytics-client";
import { createClient } from "@/lib/supabase/client";
import {
  additionalWizardDraft,
  afterSignupPath,
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
): Promise<{ businessId: string; stored: boolean } | { error: string }> {
  try {
    const response = await fetch("/api/onboarding/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(allowCreate ? { ...draft, allowCreate } : draft),
    });
    const body = (await response.json().catch(() => null)) as {
      error?: string;
      businessId?: string;
      stored?: boolean;
    } | null;
    if (!response.ok || !body?.businessId) {
      return { error: body?.error ?? "השמירה נכשלה. נסו שוב בעוד רגע." };
    }
    // stored: true only when this post created the account's first business.
    return { businessId: body.businessId, stored: body.stored === true };
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
  /**
   * "additional" only: open with the questionnaire /login could not store,
   * which it left in localStorage and flagged with `?draft=1`.
   */
  seedFromDraft?: boolean;
  /**
   * "signup" only: the plan code the visitor picked on /pricing, off
   * `/start?plan=` (already validated by parsePlanParam). Merged into the
   * draft at mount so it rides localStorage through the signup round-trip,
   * and read back to land them on /home/plan instead of /home.
   */
  plan?: string | null;
  /**
   * "additional" only: the account has no business yet, so completing this
   * wizard is its first arrival home (a signup whose questionnaire was not in
   * this browser, or a Google account made from /login).
   */
  firstBusiness?: boolean;
};

export function OnboardingFlow({
  mode = "signup",
  seedFromDraft = false,
  plan = null,
  firstBusiness = false,
}: OnboardingFlowProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<OnboardingDraft>(emptyDraft);
  // Seeding needs a frame, the same way the public wizard's saved draft does —
  // start unhydrated so step 0 never flashes before the answers arrive.
  const [hydrated, setHydrated] = useState(mode === "additional" && !seedFromDraft);
  const [completionError, setCompletionError] = useState<string | null>(null);
  // Pinned at mount, and read instead of the prop everywhere below. The
  // sidebar's "הוספת עסק" link points at /home/new-business with no query, so
  // clicking it FROM this page is a same-route navigation that flips the prop
  // true -> false without unmounting: reading the prop in the effect would
  // re-seed to emptyDraft and wipe whatever the customer had typed.
  const seeded = useRef(seedFromDraft);

  useEffect(() => {
    if (mode === "additional") {
      // Read ONCE, here, at mount — and never written back. This wizard keeps
      // its state in memory BY DESIGN (docs/vault/decisions/0015-signed-in-
      // without-business-lands-on-new-business.md): no saveDraft, so nothing
      // the customer types here outlives the tab. Do not "fix" this into a
      // persisted wizard. What DOES come back on a reload is the seed itself —
      // /login left that questionnaire in localStorage and only a created
      // business spends it (completeAdditional), so a refresh re-opens on the
      // parked answers rather than on an empty wizard.
      setDraft(additionalWizardDraft(seeded.current));
      setHydrated(true);
      return;
    }
    const saved = loadDraft();
    // A plan off the URL is merged OVER the saved draft rather than replacing
    // it: someone who started the wizard, went back to /pricing and picked a
    // card keeps their answers and gains the plan. The save effect below
    // persists the merged draft, so a later cold visit to /start still has it.
    if (plan) setDraft({ ...(saved ?? emptyDraft), plan });
    else if (saved) setDraft(saved);

    // Returning from the OAuth redirect (or already signed in): a finished
    // draft is persisted server-side and lands on the homepage; anyone else
    // with an account is handed to the dashboard's wizard, because the public
    // one has nothing to say to someone who is already signed in.
    // getUser(), not getSession(): the decision has to be server-validated —
    // a stale local session would send them to /home/new-business, whose own
    // getUser() fails and redirects back here, and the two would loop.
    (async () => {
      const {
        data: { user },
      } = await createClient().auth.getUser();

      if (user) {
        if (saved && saved.step === STEPS.length - 1) {
          const result = await postDraft(saved);
          if ("businessId" in result) {
            clearDraft();
            if (result.stored) {
              // A Google signup's account is born on this round trip; an email
              // one was counted at signUp, before the confirmation mail.
              if (user.app_metadata?.provider === "google") {
                track("account_created", { method: "google" });
              }
              track("home_first_arrival", { to: (plan ?? saved.plan) ? "plan" : "home" });
            }
            // The URL's plan is the newest intent, exactly as the merge above
            // treats it; `saved` (the localStorage draft, which carries the
            // plan from the visit before the OAuth hop) is the fallback —
            // /auth/callback returns to /start with no query, so it is what
            // usually decides.
            router.replace(afterSignupPath(plan ?? saved.plan));
            return;
          }
          // The draft is worth more than the redirect — keep them here with it.
          setCompletionError("החשבון מחובר אבל השמירה נכשלה — רעננו את העמוד כדי לנסות שוב.");
        } else {
          // A Google account created from /login (or with the questionnaire
          // unfinished) lands here; it finishes its first business in the
          // signed-in wizard, which reports the arrival.
          if (isNewGoogleAccount(user)) track("account_created", { method: "google" });
          // Before setHydrated, so the wizard never flashes on the way out.
          router.replace("/home/new-business");
          return;
        }
      }

      setHydrated(true);
    })();
    // `plan` is in the deps honestly: it is a server prop pinned for the life
    // of the page (start/page.tsx reads the URL once), so it never changes on
    // a rerender and cannot re-run the OAuth branch above.
  }, [mode, router, plan]);

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

  /**
   * Account exists (password or OAuth): persist the draft, land on the
   * homepage — or on /home/plan when the draft carries the plan they picked.
   */
  async function completeSignup(): Promise<string | null> {
    const result = await postDraft(draft);
    if ("error" in result) return result.error;
    clearDraft();
    if (result.stored) track("home_first_arrival", { to: draft.plan ? "plan" : "home" });
    router.push(afterSignupPath(draft.plan));
    return null;
  }

  /** Signed-in "הוסף עסק": create an additional business and make it the selected one. */
  async function completeAdditional(): Promise<string | null> {
    const result = await postDraft(draft, true);
    if ("error" in result) return result.error;
    if (firstBusiness) track("home_first_arrival", { to: "home" });
    // The parked draft is a business now — this is where it is spent. Guarded,
    // so an ordinary "הוסף עסק" never deletes someone's public-wizard draft;
    // `seeded`, not the prop, so a navigation that dropped the marker cannot
    // strand the copy in localStorage.
    if (seeded.current) clearDraft();
    document.cookie = `${BUSINESS_COOKIE}=${result.businessId}; path=/; max-age=31536000`;
    router.push("/home");
    // The push alone re-fetches only the page segment: home/layout.tsx (the
    // sidebar's business list and balance) stays mounted and stale, so the
    // new business is missing from the switcher until a hard reload.
    router.refresh();
    return null;
  }

  const stepId = STEPS[draft.step] ?? "business";

  // Each questionnaire step, the public wizard only; a restored draft counts
  // as a view of the step it reopens on.
  useEffect(() => {
    if (hydrated && mode === "signup") track("start_step_viewed", { step: stepId });
  }, [hydrated, mode, stepId]);

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
            productKind={draft.productKind}
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

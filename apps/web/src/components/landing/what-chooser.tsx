"use client";

import { useRouter } from "next/navigation";
import {
  emptyDraft,
  loadDraft,
  recommendedTone,
  saveDraft,
  type BusinessType,
} from "@/lib/onboarding";

const OPTIONS: { value: BusinessType; label: string }[] = [
  { value: "physical", label: "מוצר פיזי" },
  { value: "app", label: "אפליקציה או מוצר דיגיטלי" },
  { value: "service", label: "שירות או עסק מקומי" },
  { value: "other", label: "משהו אחר" },
];

/**
 * The landing page's answer to Lovable's prompt box: the first onboarding
 * question, answered in place. A click writes the answer into the draft and
 * lands on /start at the next step — the visitor never re-answers it.
 */
export function WhatChooser() {
  const router = useRouter();

  function choose(businessType: BusinessType) {
    const draft = loadDraft() ?? emptyDraft;
    saveDraft({
      ...draft,
      businessType,
      tone: draft.tone ?? recommendedTone(businessType),
      step: 1,
    });
    router.push("/start");
  }

  return (
    <div className="rounded-2xl bg-white p-5 shadow-xl shadow-ink/[0.08] ring-1 ring-ink/[0.06] sm:p-6">
      <p className="text-start text-lg font-bold text-ink">מה מפרסמים?</p>
      <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => choose(option.value)}
            className="group flex min-h-12 items-center justify-between gap-3 rounded-xl border border-ink/10 bg-paper px-4 py-3 text-start text-[15px] font-medium text-ink transition-all duration-150 hover:-translate-y-0.5 hover:border-accent hover:bg-accent/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink active:translate-y-0"
          >
            {option.label}
            <span
              aria-hidden
              className="text-ink/25 transition-all duration-150 group-hover:-translate-x-0.5 group-hover:text-ink"
            >
              ←
            </span>
          </button>
        ))}
      </div>
      <p className="mt-4 text-start text-sm text-ink/60">
        בחירה אחת וממשיכים לשאלון. כל התהליך לוקח בערך שתי דקות.
      </p>
    </div>
  );
}

/**
 * Onboarding draft — the answers collected before signup. Only questionnaire
 * material lives here; the demo video is uploaded after sign-in.
 *
 * Field names mirror `questionnaireSchema` in packages/core/src/pipelines/businesses.ts
 * (category, product_name, what_it_does, advantages, target_audience, tone, link); a completed
 * draft maps onto it via `draftToQuestionnairePayload` below.
 */

export type BusinessType = "physical" | "app" | "service" | "other";
export type Tone = "friendly" | "direct" | "professional";

export type OnboardingDraft = {
  step: number; // index into STEPS
  businessType: BusinessType | null;
  productName: string;
  whatItDoes: string;
  link: string;
  benefits: string[];
  audience: string;
  tone: Tone | null;
};

export const STEPS = ["business", "product", "benefits", "audience", "signup"] as const;
export type StepId = (typeof STEPS)[number];

/**
 * Progress shown when *entering* each step. Deliberately never 0 once the first
 * question is answered, and generous early — the goal-gradient effect.
 */
export const STEP_PROGRESS: Record<StepId, number> = {
  business: 0,
  product: 20,
  benefits: 45,
  audience: 70,
  signup: 88,
};

export const emptyDraft: OnboardingDraft = {
  step: 0,
  businessType: null,
  productName: "",
  whatItDoes: "",
  link: "",
  benefits: ["", "", ""],
  audience: "",
  tone: null,
};

export function recommendedTone(businessType: BusinessType | null): Tone {
  switch (businessType) {
    case "app":
      return "direct";
    case "service":
      return "professional";
    default:
      return "friendly";
  }
}

export const TONE_LABELS: Record<Tone, { title: string; description: string }> = {
  friendly: { title: "חברי וקליל", description: "כמו המלצה מחברה טובה" },
  direct: { title: "ישיר ותכליתי", description: "ישר לעניין — מה המוצר ולמה עכשיו" },
  professional: { title: "מקצועי ואמין", description: "רציני ומרגיע, בגובה העיניים" },
};

/**
 * Map a draft onto the core questionnaire payload. Pure and permissive —
 * missing answers become empty values the server-side `questionnaireSchema`
 * re-validation rejects with a Hebrew 400.
 */
const CATEGORY_BY_BUSINESS_TYPE: Record<BusinessType, string> = {
  physical: "physical_product",
  app: "app_or_digital",
  service: "local_service",
  other: "other",
};

export function draftToQuestionnairePayload(draft: OnboardingDraft): Record<string, unknown> {
  const link = draft.link.trim();
  return {
    category: draft.businessType ? CATEGORY_BY_BUSINESS_TYPE[draft.businessType] : "",
    product_name: draft.productName.trim(),
    what_it_does: draft.whatItDoes.trim(),
    advantages: draft.benefits.map((benefit) => benefit.trim()).filter((b) => b.length > 0),
    target_audience: draft.audience.trim(),
    tone: draft.tone ?? "",
    ...(link ? { link } : {}),
  };
}

const STORAGE_KEY = "aiugc.onboarding.v1";

export function saveDraft(draft: OnboardingDraft): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Private mode / quota — the flow still works, it just won't survive a refresh.
  }
}

export function loadDraft(): OnboardingDraft | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OnboardingDraft>;
    if (typeof parsed.step !== "number" || parsed.step < 0 || parsed.step >= STEPS.length)
      return null;
    return { ...emptyDraft, ...parsed };
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

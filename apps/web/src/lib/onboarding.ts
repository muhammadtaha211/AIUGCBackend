/**
 * Onboarding draft — the answers collected before signup. Only questionnaire
 * material lives here; the demo video is uploaded after sign-in.
 *
 * Field names mirror `questionnaireSchema` in packages/core/src/pipelines/businesses.ts
 * (category, product_name, product_kind, what_it_does, advantages, target_audience, tone,
 * link); a completed draft maps onto it via `draftToQuestionnairePayload` below, and a stored
 * questionnaire maps back into form values via `questionnaireToDraft` (the /home/settings editor).
 */

import type { Questionnaire } from "@aiugc/core";

export type BusinessType = "physical" | "app" | "service" | "other";
export type Tone = "friendly" | "direct" | "professional";

export type OnboardingDraft = {
  step: number; // index into STEPS
  businessType: BusinessType | null;
  productName: string;
  productKind: string;
  whatItDoes: string;
  link: string;
  benefits: string[];
  wow: string;
  audience: string;
  tone: Tone | null;
};

/** The questionnaire answers alone — what /home/settings edits; the wizard adds `step`. */
export type QuestionnaireDraft = Omit<OnboardingDraft, "step">;

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
  productKind: "",
  whatItDoes: "",
  link: "",
  benefits: ["", "", ""],
  wow: "",
  audience: "",
  tone: null,
};

/**
 * Founder decision (2026-09-08): the persona's register is the influencer's,
 * so "friendly" is the default for every business type and tone is an opt-in
 * dial the customer turns, not a guess made from the category. The parameter
 * stays so the four call sites keep reading naturally.
 */
export function recommendedTone(_businessType: BusinessType | null): Tone {
  return "friendly";
}

/**
 * businesses.name has no cap in the schema; the settings form's input and its
 * PATCH route (src/lib/settings.ts) agree on this one. Client-safe on purpose —
 * settings.ts is server-only.
 */
export const MAX_BUSINESS_NAME_CHARS = 80;

/** The "מה מפרסמים?" cards — the wizard's first step and the settings editor share the copy. */
export const BUSINESS_TYPE_OPTIONS: { value: BusinessType; title: string; description: string }[] =
  [
    { value: "physical", title: "מוצר פיזי", description: "משהו שנשלח ללקוח או נמכר בחנות" },
    {
      value: "app",
      title: "אפליקציה או מוצר דיגיטלי",
      description: "אפליקציה, קורס, תוכנה או מנוי",
    },
    {
      value: "service",
      title: "שירות או עסק מקומי",
      description: "קליניקה, סטודיו, מסעדה או נותן שירות",
    },
    { value: "other", title: "משהו אחר", description: "לא בטוחים? נתאים את השאלות בהמשך" },
  ];

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

export function draftToQuestionnairePayload(draft: QuestionnaireDraft): Record<string, unknown> {
  const link = draft.link.trim();
  const wow = draft.wow.trim();
  const productKind = draft.productKind.trim();
  return {
    category: draft.businessType ? CATEGORY_BY_BUSINESS_TYPE[draft.businessType] : "",
    product_name: draft.productName.trim(),
    what_it_does: draft.whatItDoes.trim(),
    advantages: draft.benefits.map((benefit) => benefit.trim()).filter((b) => b.length > 0),
    target_audience: draft.audience.trim(),
    tone: draft.tone ?? "",
    ...(productKind ? { product_kind: productKind } : {}),
    ...(link ? { link } : {}),
    ...(wow ? { wow } : {}),
  };
}

const BUSINESS_TYPE_BY_CATEGORY: Record<Questionnaire["category"], BusinessType> = {
  physical_product: "physical",
  app_or_digital: "app",
  local_service: "service",
  other: "other",
};

/**
 * The inverse, for /home/settings: a stored questionnaire back into form
 * values. Optional fields become "", and advantages are padded to the
 * wizard's three rows so the editor opens with the same shape. demo_notes are
 * not form material and are dropped — the PATCH route never accepts them either.
 */
export function questionnaireToDraft(questionnaire: Questionnaire): QuestionnaireDraft {
  const benefits = [...questionnaire.advantages];
  while (benefits.length < emptyDraft.benefits.length) benefits.push("");
  return {
    businessType: BUSINESS_TYPE_BY_CATEGORY[questionnaire.category],
    productName: questionnaire.product_name,
    productKind: questionnaire.product_kind ?? "",
    whatItDoes: questionnaire.what_it_does,
    link: questionnaire.link ?? "",
    benefits,
    wow: questionnaire.wow ?? "",
    audience: questionnaire.target_audience,
    tone: questionnaire.tone,
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

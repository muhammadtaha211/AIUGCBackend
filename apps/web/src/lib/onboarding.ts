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

/**
 * Did /api/onboarding/complete actually write the draft we just posted?
 *
 * That route is idempotent by OWNER, not by content: an existing owner gets a
 * 200 with their old business and `stored: false`, and the questionnaire in
 * the request is dropped. So a 200 alone is not permission to clear anything.
 *
 * Anything this cannot read — a body that is not JSON, a null, a `stored` of
 * the wrong type, a shape from a deploy that predates the field — is false ON
 * PURPOSE. Clearing a draft on a response we did not understand is the defect
 * class this exists to close, not a corner of it:
 * docs/vault/defects/login-clears-a-draft-the-server-never-stored.md.
 */
function draftWasStored(body: unknown): boolean {
  return (
    typeof body === "object" && body !== null && (body as { stored?: unknown }).stored === true
  );
}

/**
 * What happened to the draft a sign-in was holding:
 * - `stored` — the server wrote these answers; the localStorage copy is gone.
 * - `parked` — a 200 that stored nothing (an existing owner), or one we could
 *   not read. The copy is KEPT and belongs to the "הוסף עסק" wizard, the only
 *   place that can turn it into the second business this route declined to
 *   create.
 * - `none` — nothing to hand over: no draft, or the post never came back with
 *   a 200. The draft, if there was one, is untouched.
 */
export type DraftHandoff = "stored" | "parked" | "none";

/**
 * The marker /login puts on /home/new-business when it parks a draft there.
 * Exported so the side that writes the URL and the side that reads it cannot
 * drift — a rename on one of them alone opens the wizard empty and orphans the
 * questionnaire in localStorage, which nothing would report.
 */
export const DRAFT_WAITING_PARAM = "draft";

/**
 * Finish a wizard draft left over from before the account existed, now that
 * the caller has a session. Lives here, not in login-form.tsx, so the decision
 * can be tested — this repo has no DOM to render a component in
 * (docs/vault/falsified/web-route-handlers-cannot-be-unit-tested.md — the
 * route half of that note is dead, the no-DOM half is not).
 *
 * Only a 200 decides anything. A rejected post keeps the old behaviour — the
 * draft stays and the sign-in still lands on /home. Note what that does and
 * does not cover: questionnaireSchema validates the ANSWERS, never `step`, so
 * a draft is rejected when one of them is still blank, not because the wizard
 * was abandoned early. Someone who answered through the audience step and
 * walked away has a complete questionnaire and does get handed to the wizard.
 */
export async function postParkedDraft(): Promise<DraftHandoff> {
  const draft = loadDraft();
  if (!draft) return "none";
  try {
    const response = await fetch("/api/onboarding/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
    });
    if (!response.ok) return "none";
    const body = (await response.json().catch(() => null)) as unknown;
    if (!draftWasStored(body)) return "parked";
    clearDraft();
    return "stored";
  } catch {
    // Leave the draft in place; /home works without it.
    return "none";
  }
}

/**
 * The opening answers for the signed-in "הוסף עסק" wizard. Seeded from the
 * localStorage draft only when /login parked one there (it arrives as
 * `?draft=1` on /home/new-business); without that marker the wizard opens
 * empty, so an ordinary "add a business" never picks up a stale public-wizard
 * draft. Read once, at mount — that wizard keeps its state in memory by design
 * (docs/vault/decisions/0015-signed-in-without-business-lands-on-new-business.md).
 */
export function additionalWizardDraft(seedFromDraft: boolean): OnboardingDraft {
  return (seedFromDraft ? loadDraft() : null) ?? emptyDraft;
}

import { describe, expect, it } from "vitest";
import { questionnaireSchema } from "@aiugc/core";
import {
  type BusinessType,
  draftToQuestionnairePayload,
  emptyDraft,
  type OnboardingDraft,
  questionnaireToDraft,
  recommendedTone,
} from "../src/lib/onboarding";

describe("recommendedTone", () => {
  // Founder, 2026-09-08: the persona's register is the influencer's; tone is
  // an opt-in dial, never inferred from the business type.
  it("is friendly for every business type, and before one is chosen", () => {
    const types: (BusinessType | null)[] = ["physical", "app", "service", "other", null];
    for (const t of types) expect(recommendedTone(t), String(t)).toBe("friendly");
  });
});

/** A draft as it looks after every wizard step was answered. */
const completeDraft: OnboardingDraft = {
  step: 4,
  businessType: "physical",
  productName: "קרם לחות אלוורה",
  productKind: "קרם",
  whatItDoes: "קרם טבעי שמרגיע עור יבש",
  link: "https://example.co.il",
  benefits: ["טבעי לגמרי", "נספג מהר", "ריח עדין"],
  wow: "העור מפסיק לגרד תוך דקה",
  audience: "נשים 25–45 שמחפשות טיפוח טבעי",
  tone: "friendly",
  plan: null,
};

describe("draftToQuestionnairePayload", () => {
  it("maps every businessType to its questionnaire category", () => {
    const cases = [
      ["physical", "physical_product"],
      ["app", "app_or_digital"],
      ["service", "local_service"],
      ["other", "other"],
    ] as const;
    for (const [businessType, category] of cases) {
      const payload = draftToQuestionnairePayload({ ...completeDraft, businessType });
      expect(payload.category).toBe(category);
    }
  });

  it("trims benefits and drops empty ones", () => {
    const payload = draftToQuestionnairePayload({
      ...completeDraft,
      benefits: ["  טבעי לגמרי ", "", "   ", "נספג מהר"],
    });
    expect(payload.advantages).toEqual(["טבעי לגמרי", "נספג מהר"]);
  });

  it("omits an empty link", () => {
    expect(draftToQuestionnairePayload({ ...completeDraft, link: "" })).not.toHaveProperty("link");
    expect(draftToQuestionnairePayload({ ...completeDraft, link: "   " })).not.toHaveProperty(
      "link",
    );
    expect(draftToQuestionnairePayload(completeDraft).link).toBe("https://example.co.il");
  });

  it("omits an empty product_kind", () => {
    expect(draftToQuestionnairePayload({ ...completeDraft, productKind: "" })).not.toHaveProperty(
      "product_kind",
    );
    expect(
      draftToQuestionnairePayload({ ...completeDraft, productKind: "   " }),
    ).not.toHaveProperty("product_kind");
    expect(draftToQuestionnairePayload(completeDraft).product_kind).toBe("קרם");
  });

  it("omits an empty wow answer", () => {
    expect(draftToQuestionnairePayload({ ...completeDraft, wow: "" })).not.toHaveProperty("wow");
    expect(draftToQuestionnairePayload({ ...completeDraft, wow: "   " })).not.toHaveProperty("wow");
    expect(draftToQuestionnairePayload(completeDraft).wow).toBe("העור מפסיק לגרד תוך דקה");
  });

  it("produces a payload that parses with the core questionnaireSchema", () => {
    const parsed = questionnaireSchema.parse(draftToQuestionnairePayload(completeDraft));
    expect(parsed).toEqual({
      category: "physical_product",
      product_name: "קרם לחות אלוורה",
      product_kind: "קרם",
      what_it_does: "קרם טבעי שמרגיע עור יבש",
      advantages: ["טבעי לגמרי", "נספג מהר", "ריח עדין"],
      target_audience: "נשים 25–45 שמחפשות טיפוח טבעי",
      tone: "friendly",
      link: "https://example.co.il",
      wow: "העור מפסיק לגרד תוך דקה",
    });
  });

  it("rejects an unanswered draft via the schema (empty category and tone)", () => {
    const result = questionnaireSchema.safeParse(draftToQuestionnairePayload(emptyDraft));
    expect(result.success).toBe(false);
  });
});

describe("questionnaireToDraft", () => {
  it("is the inverse of draftToQuestionnairePayload for a complete questionnaire", () => {
    const stored = questionnaireSchema.parse(draftToQuestionnairePayload(completeDraft));
    const draft = questionnaireToDraft(stored);
    const { step: _step, plan: _plan, ...answers } = completeDraft;
    expect(draft).toEqual(answers);
    expect(draftToQuestionnairePayload(draft)).toEqual(draftToQuestionnairePayload(completeDraft));
  });

  it("maps every category back to its businessType", () => {
    const cases = [
      ["physical_product", "physical"],
      ["app_or_digital", "app"],
      ["local_service", "service"],
      ["other", "other"],
    ] as const;
    for (const [category, businessType] of cases) {
      const stored = questionnaireSchema.parse({
        ...draftToQuestionnairePayload(completeDraft),
        category,
      });
      expect(questionnaireToDraft(stored).businessType, category).toBe(businessType);
    }
  });

  it("pads advantages to the wizard's three rows and blanks the optional fields", () => {
    const draft = questionnaireToDraft({
      category: "local_service",
      product_name: "קליניקת גלואו",
      what_it_does: "קליניקה לטיפולי פנים",
      advantages: ["קביעת תור תוך דקה"],
      target_audience: "נשים 30–50",
      tone: "direct",
    });
    expect(draft.benefits).toEqual(["קביעת תור תוך דקה", "", ""]);
    expect(draft.productKind).toBe("");
    expect(draft.link).toBe("");
    expect(draft.wow).toBe("");
    // The padding rows fall away again on the way back — a round trip is a no-op.
    expect(draftToQuestionnairePayload(draft).advantages).toEqual(["קביעת תור תוך דקה"]);
    expect(draftToQuestionnairePayload(draft)).not.toHaveProperty("product_kind");
  });

  it("keeps more than three advantages and drops demo_notes", () => {
    const stored = questionnaireSchema.parse({
      ...draftToQuestionnairePayload(completeDraft),
      advantages: ["א", "ב", "ג", "ד", "ה"],
      demo_notes: ["ההסבר של הלקוח"],
    });
    const draft = questionnaireToDraft(stored);
    expect(draft.benefits).toEqual(["א", "ב", "ג", "ד", "ה"]);
    expect(draft).not.toHaveProperty("demo_notes");
  });
});

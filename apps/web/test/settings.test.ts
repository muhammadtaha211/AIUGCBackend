import { describe, expect, it } from "vitest";
import { MAX_BUSINESS_NAME_CHARS } from "../src/lib/onboarding";
import { businessPatchRequestSchema } from "../src/lib/settings";

/** A stored questionnaire as the settings form would echo it back. */
const questionnaire = {
  category: "physical_product",
  product_name: "קרם לחות אלוורה",
  what_it_does: "קרם טבעי שמרגיע עור יבש",
  advantages: ["טבעי לגמרי"],
  target_audience: "נשים 25–45",
  tone: "friendly",
};

describe("businessPatchRequestSchema", () => {
  it("strips demo_notes off the questionnaire, so setQuestionnaire keeps the stored notes", () => {
    // The customer's answered moments live in demo_notes; the form never
    // edits them, and setQuestionnaire only preserves them when the payload
    // has NO demo_notes key — an explicit [] would erase them.
    const parsed = businessPatchRequestSchema.parse({
      questionnaire: { ...questionnaire, demo_notes: ["ההסבר של הלקוח"] },
    });
    expect(parsed.questionnaire).not.toHaveProperty("demo_notes");
    expect(parsed.questionnaire).toEqual(questionnaire);

    const emptied = businessPatchRequestSchema.parse({
      questionnaire: { ...questionnaire, demo_notes: [] },
    });
    expect(emptied.questionnaire).not.toHaveProperty("demo_notes");
  });

  it("accepts a body without a name and trims one that is sent", () => {
    expect(businessPatchRequestSchema.parse({ questionnaire })).not.toHaveProperty("name");
    expect(businessPatchRequestSchema.parse({ name: "  גלואו  ", questionnaire }).name).toBe(
      "גלואו",
    );
  });

  it("refuses a blank or oversized name", () => {
    expect(businessPatchRequestSchema.safeParse({ name: "   ", questionnaire }).success).toBe(
      false,
    );
    expect(
      businessPatchRequestSchema.safeParse({
        name: "א".repeat(MAX_BUSINESS_NAME_CHARS + 1),
        questionnaire,
      }).success,
    ).toBe(false);
  });

  it("refuses what the core questionnaireSchema refuses", () => {
    expect(
      businessPatchRequestSchema.safeParse({ questionnaire: { ...questionnaire, advantages: [] } })
        .success,
    ).toBe(false);
    expect(businessPatchRequestSchema.safeParse({ questionnaire: null }).success).toBe(false);
    expect(businessPatchRequestSchema.safeParse(null).success).toBe(false);
  });
});

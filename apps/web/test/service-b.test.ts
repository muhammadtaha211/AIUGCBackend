import { describe, expect, it } from "vitest";
import {
  backgroundImages,
  businessAccess,
  canUseComposites,
  MAX_PHOTO_BYTES,
  personaThumbnail,
  photoError,
  renderRequestSchema,
  scriptRequestSchema,
  scriptTextSchema,
} from "../src/lib/service-b";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

describe("request body schemas", () => {
  it("accepts a script request with both duration presets", () => {
    for (const durationPreset of [15, 30] as const) {
      const parsed = scriptRequestSchema.safeParse({ personaId: UUID_A, durationPreset });
      expect(parsed.success).toBe(true);
    }
  });

  it("rejects a script request with a bad preset or persona id", () => {
    expect(scriptRequestSchema.safeParse({ personaId: UUID_A, durationPreset: 20 }).success).toBe(
      false,
    );
    expect(
      scriptRequestSchema.safeParse({ personaId: "not-a-uuid", durationPreset: 15 }).success,
    ).toBe(false);
  });

  it("keeps pointers optional", () => {
    const parsed = scriptRequestSchema.parse({
      personaId: UUID_A,
      durationPreset: 30,
      pointers: "לפתוח עם המשלוח המהיר",
    });
    expect(parsed.pointers).toContain("המשלוח");
    expect(scriptRequestSchema.safeParse({ personaId: UUID_A, durationPreset: 30 }).success).toBe(
      true,
    );
  });

  it("rejects empty script text and trims the rest", () => {
    expect(scriptTextSchema.safeParse({ text: "   " }).success).toBe(false);
    expect(scriptTextSchema.parse({ text: "  טקסט חדש  " }).text).toBe("טקסט חדש");
  });

  it("accepts a render request with and without compositeId", () => {
    const base = { scriptId: UUID_A, audioId: UUID_B, personaId: UUID_A };
    expect(renderRequestSchema.safeParse(base).success).toBe(true);
    expect(renderRequestSchema.safeParse({ ...base, compositeId: UUID_B }).success).toBe(true);
    expect(renderRequestSchema.safeParse({ scriptId: UUID_A, personaId: UUID_A }).success).toBe(
      false,
    );
  });

  it("carries an optional personaImageId, rejecting non-uuids", () => {
    const base = { scriptId: UUID_A, audioId: UUID_B, personaId: UUID_A };
    const parsed = renderRequestSchema.parse({ ...base, personaImageId: UUID_B });
    expect(parsed.personaImageId).toBe(UUID_B);
    expect(renderRequestSchema.safeParse({ ...base, personaImageId: "smile" }).success).toBe(false);
  });
});

describe("persona image selection (thumbnail + background picker)", () => {
  const image = (over: Partial<Parameters<typeof personaThumbnail>[0][number]> = {}) => ({
    kind: "background",
    filePath: "personas/p1/img.png",
    isDefault: false,
    retired: false,
    createdAt: new Date("2026-01-01"),
    ...over,
  });

  it("prefers kind='preview' over the default image", () => {
    const preview = image({ kind: "preview" });
    const fallback = image({ isDefault: true });
    expect(personaThumbnail([fallback, preview])).toBe(preview);
  });

  it("falls back to is_default, then to the newest image", () => {
    const older = image({ createdAt: new Date("2026-01-01") });
    const newer = image({ createdAt: new Date("2026-02-01") });
    const fallback = image({ isDefault: true });
    expect(personaThumbnail([older, fallback, newer])).toBe(fallback);
    expect(personaThumbnail([older, newer])).toBe(newer);
    expect(personaThumbnail([])).toBeUndefined();
  });

  it("never picks a stranded 'pending' placeholder", () => {
    const pending = image({ kind: "preview", filePath: "pending" });
    const stored = image({});
    expect(personaThumbnail([pending, stored])).toBe(stored);
    expect(personaThumbnail([pending])).toBeUndefined();
  });

  it("backgroundImages keeps only stored kind='background' rows", () => {
    const background = image({});
    const preview = image({ kind: "preview" });
    const pending = image({ filePath: "pending" });
    expect(backgroundImages([background, preview, pending])).toEqual([background]);
  });

  it("retired images are out of the thumbnail and the background picker", () => {
    const retiredPreview = image({ kind: "preview", retired: true });
    const retiredDefault = image({ isDefault: true, retired: true });
    const stored = image({});
    expect(personaThumbnail([retiredPreview, retiredDefault, stored])).toBe(stored);
    expect(personaThumbnail([retiredPreview])).toBeUndefined();
    expect(backgroundImages([image({ retired: true }), stored])).toEqual([stored]);
  });
});

describe("businessAccess (ownership gate)", () => {
  const business = { ownerUserId: UUID_A };

  it("owner -> ok", () => {
    expect(businessAccess(business, { id: UUID_A, role: "customer" })).toBe("ok");
  });

  it("admin who is not the owner -> ok", () => {
    expect(businessAccess(business, { id: UUID_B, role: "admin" })).toBe("ok");
  });

  it("stranger -> forbidden", () => {
    expect(businessAccess(business, { id: UUID_B, role: "customer" })).toBe("forbidden");
  });

  it("no users row for the session uid -> forbidden", () => {
    expect(businessAccess(business, undefined)).toBe("forbidden");
  });

  it("missing business -> missing", () => {
    expect(businessAccess(undefined, { id: UUID_A, role: "customer" })).toBe("missing");
  });
});

describe("canUseComposites (category guard)", () => {
  const questionnaire = {
    category: "physical_product",
    product_name: "קרם הפנים",
    what_it_does: "קרם לחות טבעי לעור רגיש",
    advantages: ["רכיבים טבעיים בלבד"],
    target_audience: "נשים 25-45",
    tone: "friendly",
  };

  it("physical product -> allowed", () => {
    expect(canUseComposites(questionnaire)).toBe(true);
  });

  it("any other category -> blocked", () => {
    expect(canUseComposites({ ...questionnaire, category: "local_service" })).toBe(false);
    expect(canUseComposites({ ...questionnaire, category: "app_or_digital" })).toBe(false);
  });

  it("missing or unfilled questionnaire -> blocked", () => {
    expect(canUseComposites(null)).toBe(false);
    expect(canUseComposites({})).toBe(false);
  });
});

describe("photoError (upload validation)", () => {
  it("accepts a normal jpeg", () => {
    expect(photoError({ type: "image/jpeg", size: 500_000 })).toBeNull();
  });

  it("rejects non-image types, empty files, and oversized files in Hebrew", () => {
    expect(photoError({ type: "application/pdf", size: 1000 })).toMatch(/JPG/);
    expect(photoError({ type: "image/jpeg", size: 0 })).toMatch(/ריק/);
    expect(photoError({ type: "image/png", size: MAX_PHOTO_BYTES + 1 })).toMatch(/גדולה מדי/);
  });
});

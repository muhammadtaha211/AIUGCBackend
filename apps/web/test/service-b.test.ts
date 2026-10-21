import { describe, expect, it } from "vitest";
import {
  businessAccess,
  personaOpeners,
  personaSelfie,
  personaThumbnail,
  renderOpenerError,
  cutawayPlanRequestSchema,
  cutawayPlanUpdateSchema,
  renderRequestSchema,
  renderSourceError,
  scriptRequestSchema,
  scriptTextSchema,
} from "../src/lib/service-b";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_C = "33333333-3333-4333-8333-333333333333";

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

  it("requires personaImageId on a render request — the card's selfie, never a default", () => {
    const base = { scriptId: UUID_A, audioId: UUID_B, personaId: UUID_A };
    expect(renderRequestSchema.safeParse({ ...base, personaImageId: UUID_B }).success).toBe(true);
    expect(renderRequestSchema.safeParse(base).success).toBe(false);
    expect(renderRequestSchema.safeParse({ ...base, personaImageId: "smile" }).success).toBe(false);
    expect(
      renderRequestSchema.safeParse({ scriptId: UUID_A, personaId: UUID_A, personaImageId: UUID_B })
        .success,
    ).toBe(false);
  });

  it("no longer knows compositeId", () => {
    const body = { scriptId: UUID_A, audioId: UUID_B, personaId: UUID_A, personaImageId: UUID_B };
    const parsed = renderRequestSchema.parse({ ...body, compositeId: UUID_A });
    expect("compositeId" in parsed).toBe(false);
  });

  describe("the hook animation and its hook text come together", () => {
    const body = { scriptId: UUID_A, audioId: UUID_B, personaId: UUID_A, personaImageId: UUID_B };
    const rect = { x: 60, y: 900, w: 960, h: 300 };

    it("accepts each of the four names, with a text where one is due", () => {
      expect(renderRequestSchema.safeParse({ ...body, hookEffect: "none" }).success).toBe(true);
      for (const hookEffect of ["zoom", "focus", "whip"]) {
        const animated = { ...body, hookEffect, hookText: "משלוח חינם היום" };
        expect(renderRequestSchema.safeParse(animated).success).toBe(true);
        const parsed = renderRequestSchema.parse({ ...animated, hookTextSafeArea: rect });
        expect(parsed.hookTextSafeArea).toEqual(rect);
      }
    });

    it("refuses an unknown effect name — including the two that were not picked", () => {
      for (const hookEffect of ["beats", "textReveal", "ZOOM", ""]) {
        expect(
          renderRequestSchema.safeParse({ ...body, hookEffect, hookText: "היי" }).success,
          hookEffect,
        ).toBe(false);
      }
    });

    it("refuses an animation without text, and text or a rect without an animation", () => {
      expect(renderRequestSchema.safeParse({ ...body, hookEffect: "zoom" }).success).toBe(false);
      expect(
        renderRequestSchema.safeParse({ ...body, hookEffect: "zoom", hookText: "  " }).success,
      ).toBe(false);
      expect(renderRequestSchema.safeParse({ ...body, hookText: "היי" }).success).toBe(false);
      expect(
        renderRequestSchema.safeParse({ ...body, hookEffect: "none", hookText: "היי" }).success,
      ).toBe(false);
      expect(renderRequestSchema.safeParse({ ...body, hookTextSafeArea: rect }).success).toBe(
        false,
      );
    });

    it("no longer knows openerClipId: a stale tab's body is stripped, not refused", () => {
      const parsed = renderRequestSchema.parse({ ...body, openerClipId: UUID_C });
      expect("openerClipId" in parsed).toBe(false);
      expect(parsed.hookEffect).toBeUndefined();
    });

    it("keeps the rect inside the 1080x1920 frame", () => {
      const outside = { x: 600, y: 900, w: 960, h: 300 };
      expect(
        renderRequestSchema.safeParse({
          ...body,
          hookEffect: "zoom",
          hookText: "היי",
          hookTextSafeArea: outside,
        }).success,
      ).toBe(false);
    });
  });
});

describe("renderSourceError (the card's image, held to the format at the route)", () => {
  const selfie = {
    personaId: UUID_A,
    kind: "selfie",
    filePath: "personas/p1/selfie.png",
    retired: false,
  };

  it("passes this persona's stored, live selfie", () => {
    expect(renderSourceError(selfie, UUID_A)).toBeUndefined();
  });

  it("404s an image that does not exist", () => {
    expect(renderSourceError(undefined, UUID_A)?.status).toBe(404);
  });

  it("rejects a non-selfie personaImageId — the explicit-id path bypasses core's guard", () => {
    const standing = renderSourceError({ ...selfie, kind: "background" }, UUID_A);
    expect(standing?.status).toBe(400);
    expect(standing?.error).toMatch(/סלפי/);
    expect(renderSourceError({ ...selfie, kind: "preview" }, UUID_A)?.status).toBe(400);
  });

  it("rejects another persona's image, a retired one, and a stranded upload", () => {
    expect(renderSourceError(selfie, UUID_B)?.error).toMatch(/לא שייכת לדמות/);
    expect(renderSourceError({ ...selfie, retired: true }, UUID_A)?.error).toMatch(/הוסרה/);
    expect(renderSourceError({ ...selfie, filePath: "pending" }, UUID_A)?.error).toMatch(
      /לא מוכנה/,
    );
  });
});

describe("renderOpenerError (the opener must be the source image's)", () => {
  const opener = { personaImageId: UUID_B, active: true };

  it("passes an active clip of the render's image", () => {
    expect(renderOpenerError(opener, UUID_B)).toBeUndefined();
  });

  it("404s a missing clip, 400s a superseded one or one of another image", () => {
    expect(renderOpenerError(undefined, UUID_B)?.status).toBe(404);
    expect(renderOpenerError({ ...opener, active: false }, UUID_B)?.error).toMatch(/לא זמין/);
    expect(renderOpenerError(opener, UUID_C)?.error).toMatch(/לא שייך לתמונת הדמות/);
  });
});

describe("persona image selection (thumbnail + render source)", () => {
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
    expect(personaThumbnail([fallback, preview], "a")).toBe(preview);
  });

  it("falls back to is_default, then to the newest image", () => {
    const older = image({ createdAt: new Date("2026-01-01") });
    const newer = image({ createdAt: new Date("2026-02-01") });
    const fallback = image({ isDefault: true });
    expect(personaThumbnail([older, fallback, newer], "a")).toBe(fallback);
    expect(personaThumbnail([older, newer], "a")).toBe(newer);
    expect(personaThumbnail([], "a")).toBeUndefined();
  });

  it("never picks a stranded 'pending' placeholder", () => {
    const pending = image({ kind: "preview", filePath: "pending" });
    const stored = image({});
    expect(personaThumbnail([pending, stored], "a")).toBe(stored);
    expect(personaThumbnail([pending], "a")).toBeUndefined();
  });

  describe("personaSelfie — one row for the card, the opener list and the render", () => {
    const selfie = (over: Partial<ReturnType<typeof image>> = {}) =>
      image({ kind: "selfie", ...over });

    it("the default selfie wins over a newer selfie", () => {
      const older = selfie({ isDefault: true, createdAt: new Date("2026-01-01") });
      const newer = selfie({ createdAt: new Date("2026-03-01") });
      expect(personaSelfie([newer, older])).toBe(older);
    });

    it("with no default selfie, the newest selfie", () => {
      const older = selfie({ createdAt: new Date("2026-01-01") });
      const newer = selfie({ createdAt: new Date("2026-03-01") });
      expect(personaSelfie([older, newer])).toBe(newer);
    });

    it("a standing default is never the selfie — is_default only breaks ties between selfies", () => {
      const standingDefault = image({ kind: "background", isDefault: true });
      const preview = image({ kind: "preview" });
      const only = selfie({});
      expect(personaSelfie([standingDefault, preview, only])).toBe(only);
      expect(personaSelfie([standingDefault, preview])).toBeUndefined();
    });

    it("a retired or stranded selfie is out, even as the default", () => {
      const retiredDefault = selfie({ isDefault: true, retired: true });
      const pending = selfie({ filePath: "pending", createdAt: new Date("2026-06-01") });
      const live = selfie({ createdAt: new Date("2026-01-01") });
      expect(personaSelfie([retiredDefault, pending, live])).toBe(live);
      expect(personaSelfie([retiredDefault, pending])).toBeUndefined();
      expect(personaSelfie([])).toBeUndefined();
    });
  });

  describe("personaThumbnail(service)", () => {
    const rows = [
      image({ kind: "preview" }),
      image({ kind: "background", isDefault: true }),
      image({ kind: "selfie", createdAt: new Date("2026-02-01") }),
    ];

    it("B's card shows the selfie — the image the render animates", () => {
      expect(personaThumbnail(rows, "b")).toBe(rows[2]);
      expect(personaThumbnail(rows, "b")).toBe(personaSelfie(rows));
    });

    it("A's card is the portrait, exactly as before", () => {
      expect(personaThumbnail(rows, "a")).toBe(rows[0]);
    });

    it("B lists no persona without a selfie", () => {
      expect(personaThumbnail([rows[0]!, rows[1]!], "b")).toBeUndefined();
      expect(personaThumbnail([rows[0]!, rows[1]!], "a")).toBe(rows[0]);
    });
  });

  describe("personaOpeners — the clips of personaSelfie, whatever is_default says", () => {
    const withId = (id: string, over: Partial<ReturnType<typeof image>> = {}) => ({
      id,
      ...image(over),
    });
    const clip = (id: string, personaImageId: string, active = true) => ({
      id,
      personaImageId,
      active,
    });

    it("lists the active clips of the selfie only", () => {
      const standingDefault = withId("standing", { kind: "background", isDefault: true });
      const selfie = withId("selfie", { kind: "selfie" });
      const clips = [
        clip("of-selfie", "selfie"),
        clip("of-selfie-old", "selfie", false),
        clip("of-standing", "standing"),
      ];
      expect(personaOpeners([standingDefault, selfie], clips).map((c) => c.id)).toEqual([
        "of-selfie",
      ]);
    });

    it("follows the default selfie, not a newer selfie's clips", () => {
      const chosen = withId("chosen", { kind: "selfie", isDefault: true });
      const newer = withId("newer", {
        kind: "selfie",
        createdAt: new Date("2026-05-01"),
      });
      const clips = [clip("a", "newer"), clip("b", "chosen")];
      expect(personaOpeners([chosen, newer], clips).map((c) => c.id)).toEqual(["b"]);
    });

    it("offers nothing when the persona has no usable selfie", () => {
      const retired = withId("retired", { kind: "selfie", retired: true });
      expect(personaOpeners([retired], [clip("x", "retired")])).toEqual([]);
      expect(personaOpeners([], [])).toEqual([]);
    });
  });

  it("retired images are out of the thumbnail", () => {
    const retiredPreview = image({ kind: "preview", retired: true });
    const retiredDefault = image({ isDefault: true, retired: true });
    const stored = image({});
    expect(personaThumbnail([retiredPreview, retiredDefault, stored], "a")).toBe(stored);
    expect(personaThumbnail([retiredPreview], "a")).toBeUndefined();
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

describe("demo cutaway bodies (vault 0121, 0122)", () => {
  const body = {
    scriptId: "11111111-1111-4111-8111-111111111111",
    audioId: "22222222-2222-4222-8222-222222222222",
    personaId: "33333333-3333-4333-8333-333333333333",
    personaImageId: "44444444-4444-4444-8444-444444444444",
  };

  it("the render takes an optional plan id, a uuid", () => {
    expect(renderRequestSchema.safeParse(body).success).toBe(true);
    const planId = "55555555-5555-4555-8555-555555555555";
    expect(renderRequestSchema.parse({ ...body, cutawayPlanId: planId }).cutawayPlanId).toBe(
      planId,
    );
    expect(renderRequestSchema.safeParse({ ...body, cutawayPlanId: "plan-1" }).success).toBe(false);
  });

  it("the draft takes the audio and the demo — the hook text is the script's own (vault 0122)", () => {
    const draft = { audioId: body.audioId, demoId: body.personaId };
    expect(cutawayPlanRequestSchema.safeParse(draft).success).toBe(true);
    expect(cutawayPlanRequestSchema.safeParse({ ...draft, hookText: "שורה" }).success).toBe(false);
    expect(cutawayPlanRequestSchema.safeParse({ ...draft, slots: [] }).success).toBe(false);
    expect(
      cutawayPlanRequestSchema.safeParse({ audioId: "x", demoId: body.personaId }).success,
    ).toBe(false);
  });

  it("an edit sends the whole clip list and the version it was made on", () => {
    const clip = { id: 1, fromMs: 7200, toMs: 12_000, demoStartMs: 10_400 };
    const edit = { expectedUpdatedAt: "2026-10-21T08:00:00.000Z", slots: [clip] };
    expect(cutawayPlanUpdateSchema.safeParse(edit).success).toBe(true);
    // No clips at all is today's ad.
    expect(cutawayPlanUpdateSchema.safeParse({ ...edit, slots: [] }).success).toBe(true);
    expect(cutawayPlanUpdateSchema.safeParse({ slots: [clip] }).success).toBe(false);
    expect(
      cutawayPlanUpdateSchema.safeParse({ ...edit, slots: [{ ...clip, id: 0 }] }).success,
    ).toBe(false);
    expect(
      cutawayPlanUpdateSchema.safeParse({ ...edit, slots: [{ ...clip, id: 9 }] }).success,
    ).toBe(false);
    expect(
      cutawayPlanUpdateSchema.safeParse({ ...edit, slots: [{ ...clip, fromMs: -1 }] }).success,
    ).toBe(false);
    expect(
      cutawayPlanUpdateSchema.safeParse({ ...edit, slots: [{ ...clip, label: "א" }] }).success,
    ).toBe(false);
    expect(cutawayPlanUpdateSchema.safeParse({ ...edit, starts: [400] }).success).toBe(false);
    const nine = Array.from({ length: 9 }, (_, i) => ({ ...clip, id: (i % 8) + 1 }));
    expect(cutawayPlanUpdateSchema.safeParse({ ...edit, slots: nine }).success).toBe(false);
  });
});

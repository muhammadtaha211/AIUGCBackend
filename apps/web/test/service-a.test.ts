import { describe, expect, it } from "vitest";
import {
  aStepsRenderRequestSchema,
  demoDescriptionRequestSchema,
  demoFileError,
  demoNoteRequestSchema,
  demoUploadPath,
  isOwnedDemoUploadPath,
  parseAnalysisIndexes,
  planStepsRequestSchema,
  registerDemoRequestSchema,
  stepPlanResponse,
  uploadUrlRequestSchema,
  voScriptRequestSchema,
  MAX_DEMO_BYTES,
} from "../src/lib/service-a";

const BUSINESS = "0b6f39a3-13a1-4b8f-a6c3-2f1f4bd8f111";
const OTHER = "9e1d2c3b-4a5f-4678-9abc-def012345678";
const UUID = "123e4567-e89b-42d3-a456-426614174000";

describe("demo upload validation", () => {
  it("accepts mp4 and mov within the size cap", () => {
    expect(demoFileError({ type: "video/mp4", size: 5_000_000 })).toBeNull();
    expect(demoFileError({ type: "video/quicktime", size: MAX_DEMO_BYTES })).toBeNull();
  });

  it("rejects wrong type, empty and oversized files in Hebrew", () => {
    expect(demoFileError({ type: "video/webm", size: 1000 })).toMatch(/MP4 או MOV/);
    expect(demoFileError({ type: "video/mp4", size: 0 })).toMatch(/ריק/);
    expect(demoFileError({ type: "video/mp4", size: MAX_DEMO_BYTES + 1 })).toMatch(/גדול מדי/);
  });
});

describe("demo upload path", () => {
  it("mints a raw-bucket key under the business with a fixed basename", () => {
    const path = demoUploadPath(BUSINESS, UUID, "video/quicktime");
    expect(path).toBe(`raw/${BUSINESS}/demo/${UUID}/demo.mov`);
    expect(isOwnedDemoUploadPath(BUSINESS, path)).toBe(true);
  });

  it("register accepts only keys this business's upload-url route minted", () => {
    const path = demoUploadPath(BUSINESS, UUID, "video/mp4");
    expect(isOwnedDemoUploadPath(OTHER, path)).toBe(false); // someone else's object
    expect(isOwnedDemoUploadPath(BUSINESS, `raw/${BUSINESS}/demo/../evil/demo.mp4`)).toBe(false);
    expect(isOwnedDemoUploadPath(BUSINESS, `assets/${BUSINESS}/demo/${UUID}/demo.mp4`)).toBe(false);
    expect(isOwnedDemoUploadPath(BUSINESS, `raw/${BUSINESS}/demo/${UUID}/demo.exe`)).toBe(false);
  });
});

describe("request schemas", () => {
  it("upload-url wants a type and a positive size", () => {
    expect(uploadUrlRequestSchema.safeParse({ type: "video/mp4", size: 123 }).success).toBe(true);
    expect(uploadUrlRequestSchema.safeParse({ type: "video/mp4", size: 0 }).success).toBe(false);
    expect(uploadUrlRequestSchema.safeParse({ size: 123 }).success).toBe(false);
  });

  it("register wants a non-empty path", () => {
    expect(registerDemoRequestSchema.safeParse({ uploadPath: "raw/x/demo.mp4" }).success).toBe(
      true,
    );
    expect(registerDemoRequestSchema.safeParse({ uploadPath: "" }).success).toBe(false);
  });

  it("vo-script wants uuids and a bounded advantages list", () => {
    expect(
      voScriptRequestSchema.safeParse({
        demoId: UUID,
        personaId: UUID,
        selectedAdvantages: ["משלוח מהיר"],
      }).success,
    ).toBe(true);
    expect(
      voScriptRequestSchema.safeParse({
        demoId: "not-a-uuid",
        personaId: UUID,
        selectedAdvantages: [],
      }).success,
    ).toBe(false);
  });

  it("steps render body: plan pinned by id, silent — no audio, no persona", () => {
    const body = {
      demoId: UUID,
      stepPlanId: UUID,
      hookClipId: UUID,
      hookLineScriptId: UUID,
    };
    expect(aStepsRenderRequestSchema.safeParse(body).success).toBe(true);
    expect(aStepsRenderRequestSchema.safeParse({ ...body, stepPlanId: undefined }).success).toBe(
      false,
    );
    expect(aStepsRenderRequestSchema.safeParse({ ...body, stepPlanId: "latest" }).success).toBe(
      false,
    );
    expect(
      aStepsRenderRequestSchema.safeParse({
        ...body,
        textSafeArea: { x: 40, y: 900, w: 1000, h: 300 },
      }).success,
    ).toBe(true);
    expect(
      aStepsRenderRequestSchema.safeParse({
        ...body,
        textSafeArea: { x: 400, y: 0, w: 900, h: 500 },
      }).success,
    ).toBe(false);
  });

  it("demo description caps at 500 chars; blank is fine (it clears)", () => {
    expect(demoDescriptionRequestSchema.safeParse({ description: "גלילה בתפריט" }).success).toBe(
      true,
    );
    expect(demoDescriptionRequestSchema.safeParse({ description: "" }).success).toBe(true);
    expect(demoDescriptionRequestSchema.safeParse({ description: "א".repeat(501) }).success).toBe(
      false,
    );
    expect(demoDescriptionRequestSchema.safeParse({}).success).toBe(false);
  });

  it("plan edit wants 1-80 integer-indexed steps with 1-60 char labels", () => {
    expect(
      planStepsRequestSchema.safeParse({ steps: [{ sourceIndex: 0, label: "שמירה" }] }).success,
    ).toBe(true);
    expect(planStepsRequestSchema.safeParse({ steps: [] }).success).toBe(false);
    expect(
      planStepsRequestSchema.safeParse({ steps: [{ sourceIndex: -1, label: "א" }] }).success,
    ).toBe(false);
    expect(
      planStepsRequestSchema.safeParse({ steps: [{ sourceIndex: 1.5, label: "א" }] }).success,
    ).toBe(false);
    expect(
      planStepsRequestSchema.safeParse({ steps: [{ sourceIndex: 0, label: "" }] }).success,
    ).toBe(false);
    expect(
      planStepsRequestSchema.safeParse({ steps: [{ sourceIndex: 0, label: "א".repeat(61) }] })
        .success,
    ).toBe(false);
    expect(
      planStepsRequestSchema.safeParse({
        steps: Array.from({ length: 81 }, (_, i) => ({ sourceIndex: i, label: "א" })),
      }).success,
    ).toBe(false);
  });

  it("demo note wants non-empty text up to 500 chars", () => {
    expect(demoNoteRequestSchema.safeParse({ text: "מסך בחירת תבניות" }).success).toBe(true);
    expect(demoNoteRequestSchema.safeParse({ text: "" }).success).toBe(false);
    expect(demoNoteRequestSchema.safeParse({ text: "א".repeat(501) }).success).toBe(false);
    expect(demoNoteRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("step plan response shape", () => {
  it("renames id->planId, defaults missing jsonb to [], hides nulls", () => {
    const approvedAt = new Date();
    const createdAt = new Date();
    expect(
      stepPlanResponse({
        id: "p1",
        demoId: "d1",
        analysisId: "a1",
        status: "ready",
        steps: [{ sourceIndex: 3 }],
        unexplainedMoments: [],
        notes: "הערה",
        failReason: null,
        failKind: null,
        approvedAt,
        createdAt,
      }),
    ).toEqual({
      planId: "p1",
      demoId: "d1",
      analysisId: "a1",
      status: "ready",
      steps: [{ sourceIndex: 3 }],
      unexplainedMoments: [],
      notes: "הערה",
      approvedAt,
      createdAt,
    });

    const failed = stepPlanResponse({
      id: "p2",
      demoId: "d1",
      analysisId: "a1",
      status: "failed",
      steps: null,
      unexplainedMoments: null,
      notes: null,
      failReason: "יצירת התוכנית נכשלה — נסו שוב",
      failKind: "validator",
      approvedAt: null,
      createdAt,
    });
    expect(failed.steps).toEqual([]);
    expect(failed.unexplainedMoments).toEqual([]);
    expect(failed.failReason).toBe("יצירת התוכנית נכשלה — נסו שוב");
    expect(failed.failKind).toBe("validator");
    expect(failed.notes).toBeUndefined();
    expect(failed.approvedAt).toBeUndefined();
  });
});

describe("analysis ?indexes= parsing", () => {
  it("accepts a comma-separated int list within the timeline, deduped", () => {
    expect(parseAnalysisIndexes("3,17,29", 61)).toEqual([3, 17, 29]);
    expect(parseAnalysisIndexes("3,3,17", 61)).toEqual([3, 17]);
    expect(parseAnalysisIndexes("0", 1)).toEqual([0]);
  });

  it("rejects out-of-range indexes instead of silently dropping them", () => {
    expect(parseAnalysisIndexes("3,61", 61)).toBeNull();
    expect(parseAnalysisIndexes("0", 0)).toBeNull();
  });

  it("rejects malformed parts", () => {
    expect(parseAnalysisIndexes("", 61)).toBeNull();
    expect(parseAnalysisIndexes("3,,7", 61)).toBeNull();
    expect(parseAnalysisIndexes("3, 7", 61)).toBeNull();
    expect(parseAnalysisIndexes("-1", 61)).toBeNull();
    expect(parseAnalysisIndexes("1.5", 61)).toBeNull();
    expect(parseAnalysisIndexes("abc", 61)).toBeNull();
  });

  it("caps at ANALYSIS_PAGE_SIZE distinct indexes — signing is per-URL work", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => i).join(",");
    expect(parseAnalysisIndexes(twelve, 61)).toHaveLength(12);
    const thirteen = Array.from({ length: 13 }, (_, i) => i).join(",");
    expect(parseAnalysisIndexes(thirteen, 61)).toBeNull();
  });
});

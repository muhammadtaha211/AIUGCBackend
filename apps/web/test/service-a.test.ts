import { describe, expect, it } from "vitest";
import {
  aRenderRequestSchema,
  demoFileError,
  demoUploadPath,
  isOwnedDemoUploadPath,
  registerDemoRequestSchema,
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

  it("a-set render body wants every reference as a uuid", () => {
    const body = {
      demoId: UUID,
      hookClipId: UUID,
      hookLineScriptId: UUID,
      audioId: UUID,
      personaId: UUID,
    };
    expect(aRenderRequestSchema.safeParse(body).success).toBe(true);
    expect(aRenderRequestSchema.safeParse({ ...body, personaId: undefined }).success).toBe(false);
  });
});

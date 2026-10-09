import { describe, expect, it } from "vitest";
import {
  createTextBlockRenderSchema,
  editTextBlockSchema,
  generateTextBlocksSchema,
  isTextBlockUploadPath,
  registerTextBlockSchema,
  textBlockFileError,
  textBlockMetadataError,
  textBlockPatchSchema,
  textBlockUploadPath,
} from "../src/lib/text-blocks";

const RECT = { x: 80, y: 360, w: 820, h: 1040 };
const UUID = "11111111-1111-4111-8111-111111111111";

describe("text block clip file pre-check", () => {
  it("accepts an mp4 up to 100MB and rejects other containers, empty and oversize files", () => {
    expect(textBlockFileError({ type: "video/mp4", size: 60 * 1024 * 1024 })).toBeNull();
    expect(textBlockFileError({ type: "video/quicktime", size: 5_000_000 })).toMatch(/MP4/);
    expect(textBlockFileError({ type: "video/mp4", size: 0 })).toMatch(/ריק/);
    expect(textBlockFileError({ type: "video/mp4", size: 101 * 1024 * 1024 })).toMatch(/100MB/);
  });
});

describe("text block clip metadata bounds (3–60 s, near 9:16)", () => {
  const good = { durationMs: 10_000, width: 1080, height: 1920 };

  it("accepts 3–60 s at 1080x1920 or anything close to 9:16", () => {
    expect(textBlockMetadataError(good)).toBeNull();
    expect(textBlockMetadataError({ ...good, width: 1072, height: 1936 })).toBeNull();
    expect(textBlockMetadataError({ ...good, durationMs: 3_000 })).toBeNull();
    expect(textBlockMetadataError({ ...good, durationMs: 60_000 })).toBeNull();
  });

  it("rejects a hook-length clip and an over-long one, naming the actual value", () => {
    expect(textBlockMetadataError({ ...good, durationMs: 2_999 })).toMatch(/3–60.*3\.0/);
    expect(textBlockMetadataError({ ...good, durationMs: 61_500 })).toMatch(/61\.5/);
  });

  it("rejects non-9:16 dimensions, naming them", () => {
    expect(textBlockMetadataError({ ...good, width: 1920, height: 1080 })).toMatch(/1920×1080/);
    expect(textBlockMetadataError({ ...good, width: 1080, height: 2340 })).toMatch(/1080×2340/);
  });
});

describe("upload path (register accepts only minted paths, under the bank's own entity)", () => {
  it("round-trips the minted shape", () => {
    const path = textBlockUploadPath(UUID);
    expect(path).toBe(`assets/bank/text_block_clip/${UUID}/clip.mp4`);
    expect(isTextBlockUploadPath(path)).toBe(true);
  });

  it("rejects the hook bank's entity, other buckets, filenames and non-uuid ids", () => {
    expect(isTextBlockUploadPath(`assets/bank/hook_clip/${UUID}/clip.mp4`)).toBe(false);
    expect(isTextBlockUploadPath(`raw/bank/text_block_clip/${UUID}/clip.mp4`)).toBe(false);
    expect(isTextBlockUploadPath(`assets/bank/text_block_clip/${UUID}/other.mp4`)).toBe(false);
    expect(isTextBlockUploadPath(`assets/bank/text_block_clip/not-a-uuid/clip.mp4`)).toBe(false);
  });
});

describe("request bodies", () => {
  const register = {
    uploadPath: textBlockUploadPath(UUID),
    durationMs: 10_000,
    width: 1080,
    height: 1920,
    personaId: UUID,
    textSafeArea: RECT,
  };

  it("register needs the character and the rect; the colour is optional and white|black only", () => {
    expect(registerTextBlockSchema.safeParse(register).success).toBe(true);
    expect(registerTextBlockSchema.safeParse({ ...register, textColor: "black" }).success).toBe(
      true,
    );
    expect(registerTextBlockSchema.safeParse({ ...register, textColor: "gray" }).success).toBe(
      false,
    );
    expect(registerTextBlockSchema.safeParse({ ...register, personaId: "dana" }).success).toBe(
      false,
    );
    const { personaId: _persona, ...noPersona } = register;
    expect(registerTextBlockSchema.safeParse(noPersona).success).toBe(false);
    // The gender is the character's now: a body that names one still needs the persona.
    expect(
      registerTextBlockSchema.safeParse({ ...noPersona, speakerGender: "female" }).success,
    ).toBe(false);
    expect(
      registerTextBlockSchema.safeParse({
        ...register,
        textSafeArea: { x: 300, y: 0, w: 900, h: 10 },
      }).success,
    ).toBe(false);
  });

  it("patch accepts each action alone and rejects an empty patch and unknown values", () => {
    expect(textBlockPatchSchema.safeParse({ active: false }).success).toBe(true);
    expect(textBlockPatchSchema.safeParse({ textSafeArea: RECT }).success).toBe(true);
    expect(textBlockPatchSchema.safeParse({ textColor: "black" }).success).toBe(true);
    expect(textBlockPatchSchema.safeParse({ personaId: UUID }).success).toBe(true);
    expect(textBlockPatchSchema.safeParse({ personaId: null }).success).toBe(true);
    expect(textBlockPatchSchema.safeParse({ personaId: "dana" }).success).toBe(false);
    expect(textBlockPatchSchema.safeParse({}).success).toBe(false);
  });

  it("patch refuses the speaker gender: it follows the character, never set on its own", () => {
    expect(textBlockPatchSchema.safeParse({ speakerGender: "male" }).success).toBe(false);
    expect(textBlockPatchSchema.safeParse({ personaId: UUID, speakerGender: "male" }).success).toBe(
      false,
    );
  });

  it("generate, edit and render bodies", () => {
    expect(generateTextBlocksSchema.safeParse({ businessId: UUID, clipId: UUID }).success).toBe(
      true,
    );
    expect(generateTextBlocksSchema.safeParse({ businessId: UUID }).success).toBe(false);
    expect(editTextBlockSchema.safeParse({ text: "שלום" }).success).toBe(true);
    expect(editTextBlockSchema.safeParse({ text: "" }).success).toBe(false);
    expect(
      createTextBlockRenderSchema.safeParse({ businessId: UUID, clipId: UUID, scriptId: UUID })
        .success,
    ).toBe(true);
    expect(createTextBlockRenderSchema.safeParse({ businessId: UUID, clipId: UUID }).success).toBe(
      false,
    );
  });
});

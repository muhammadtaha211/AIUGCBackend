import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  adminAccess,
  canChangeRole,
  coverCrop,
  createPersonaSchema,
  grantSchema,
  imageDimensions,
  imagePatchSchema,
  personaPatchSchema,
  referenceImageError,
  roleChangeSchema,
} from "../src/lib/admin";

describe("adminAccess (role gate)", () => {
  // Anonymous requests never reach this decision: adminSession returns null
  // before the users row is loaded when there is no session user.
  it("no users row for the session uid -> forbidden", () => {
    expect(adminAccess(undefined)).toBe("forbidden");
  });

  it("customer -> forbidden", () => {
    expect(adminAccess({ role: "customer" })).toBe("forbidden");
  });

  it("admin -> ok", () => {
    expect(adminAccess({ role: "admin" })).toBe("ok");
  });
});

describe("admin route wiring", () => {
  // Middleware is the outer wall, but it is never trusted alone (Next
  // middleware bypass CVEs exist). Every API route in this app — not just the
  // ones that exist today — must carry its own requireAdmin call.
  it("every API route handler in the app calls requireAdmin", () => {
    const apiDir = fileURLToPath(new URL("../src/app/api/", import.meta.url));
    const routes: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === "route.ts") routes.push(full);
      }
    };
    walk(apiDir);
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      expect(readFileSync(route, "utf8"), `${route} must call requireAdmin`).toMatch(
        /requireAdmin\(/,
      );
    }
  });
});

describe("request body schemas", () => {
  it("createPersona requires name, voice id, and a known gender", () => {
    expect(
      createPersonaSchema.safeParse({ name: "דנה", voiceId: "voice_1", gender: "female" }).success,
    ).toBe(true);
    expect(
      createPersonaSchema.safeParse({ name: "", voiceId: "voice_1", gender: "female" }).success,
    ).toBe(false);
    expect(
      createPersonaSchema.safeParse({ name: "דנה", voiceId: "voice_1", gender: "other" }).success,
    ).toBe(false);
  });

  it("imagePatch accepts each action alone and rejects an empty patch", () => {
    expect(imagePatchSchema.safeParse({ label: "חיוך" }).success).toBe(true);
    expect(imagePatchSchema.safeParse({ kind: "preview" }).success).toBe(true);
    expect(imagePatchSchema.safeParse({ retired: true }).success).toBe(true);
    expect(imagePatchSchema.safeParse({ makeDefault: true }).success).toBe(true);
    expect(imagePatchSchema.safeParse({}).success).toBe(false);
    expect(imagePatchSchema.safeParse({ kind: "portrait" }).success).toBe(false);
  });

  it("grant requires a positive integer amount and a non-empty note", () => {
    const base = { userId: "11111111-1111-4111-8111-111111111111", note: "פיצוי" };
    expect(grantSchema.safeParse({ ...base, credits: 10 }).success).toBe(true);
    expect(grantSchema.safeParse({ ...base, credits: 0 }).success).toBe(false);
    expect(grantSchema.safeParse({ ...base, credits: -3 }).success).toBe(false);
    expect(grantSchema.safeParse({ ...base, credits: 2.5 }).success).toBe(false);
    expect(grantSchema.safeParse({ ...base, credits: 10, note: "  " }).success).toBe(false);
  });

  it("roleChange allows only the two known roles", () => {
    expect(roleChangeSchema.safeParse({ role: "admin" }).success).toBe(true);
    expect(roleChangeSchema.safeParse({ role: "customer" }).success).toBe(true);
    expect(roleChangeSchema.safeParse({ role: "owner" }).success).toBe(false);
  });
});

describe("personaPatchSchema (edit form body)", () => {
  it("accepts a partial patch and trims it", () => {
    const nameOnly = personaPatchSchema.safeParse({ name: "  דנה " });
    expect(nameOnly.success && nameOnly.data).toEqual({ name: "דנה" });
    expect(personaPatchSchema.safeParse({ voiceId: "voice_2", gender: "male" }).success).toBe(true);
  });

  it("rejects an empty patch, an unknown gender, and an empty name", () => {
    expect(personaPatchSchema.safeParse({}).success).toBe(false);
    expect(personaPatchSchema.safeParse({ gender: "other" }).success).toBe(false);
    expect(personaPatchSchema.safeParse({ name: "" }).success).toBe(false);
    expect(personaPatchSchema.safeParse({ name: "   " }).success).toBe(false);
  });
});

describe("canChangeRole (lockout prevention)", () => {
  it("blocks changing your own role, allows anyone else's", () => {
    const me = "11111111-1111-4111-8111-111111111111";
    const other = "22222222-2222-4222-8222-222222222222";
    expect(canChangeRole(me, me)).toBe(false);
    expect(canChangeRole(me, other)).toBe(true);
  });
});

// Minimal real headers: a PNG is its signature + IHDR; a JPEG is SOI, one
// skipped APP0 segment, and an SOF0 frame header.
function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  ]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function jpegBytes(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8, // SOI
    0xff,
    0xe0,
    0x00,
    0x04,
    0x00,
    0x00, // APP0 the scanner must skip
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08, // SOF0, length, precision
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x03,
  ]);
}

describe("reference image validation (server parses the actual bytes)", () => {
  it("reads PNG and JPEG dimensions", () => {
    expect(imageDimensions(pngBytes(1080, 1920))).toEqual({
      width: 1080,
      height: 1920,
      extension: ".png",
    });
    expect(imageDimensions(jpegBytes(1080, 1920))).toEqual({
      width: 1080,
      height: 1920,
      extension: ".jpg",
    });
  });

  it("accepts exactly 1080x1920 and nothing else", () => {
    expect(referenceImageError(jpegBytes(1080, 1920))).toBeNull();
    expect(referenceImageError(pngBytes(1080, 1920))).toBeNull();
    expect(referenceImageError(jpegBytes(1920, 1080))).toMatch(/1080×1920/);
    expect(referenceImageError(pngBytes(512, 512))).toMatch(/1080×1920/);
  });

  it("rejects non-images and empty files in Hebrew", () => {
    expect(referenceImageError(new Uint8Array(0))).toMatch(/ריק/);
    expect(referenceImageError(new TextEncoder().encode("not an image at all"))).toMatch(/JPG/);
    // A JPEG that ends before any frame header is not a valid image.
    expect(referenceImageError(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02]))).toMatch(
      /JPG/,
    );
  });
});

describe("coverCrop (client-side center-crop math)", () => {
  it("crops the sides of a source wider than 9:16", () => {
    const crop = coverCrop(4000, 3000, 1080, 1920);
    expect(crop.sh).toBeCloseTo(3000, 5); // full height used
    expect(crop.sw).toBeCloseTo(3000 * (1080 / 1920), 5);
    expect(crop.sx).toBeCloseTo((4000 - crop.sw) / 2, 5);
    expect(crop.sy).toBeCloseTo(0, 5);
  });

  it("crops top and bottom of a source taller than 9:16", () => {
    const crop = coverCrop(1000, 4000, 1080, 1920);
    expect(crop.sw).toBeCloseTo(1000, 5); // full width used
    expect(crop.sh).toBeCloseTo(1000 * (1920 / 1080), 5);
    expect(crop.sy).toBeCloseTo((4000 - crop.sh) / 2, 5);
    expect(crop.sx).toBeCloseTo(0, 5);
  });

  it("uses the whole frame when the aspect already matches", () => {
    expect(coverCrop(2160, 3840, 1080, 1920)).toEqual({ sx: 0, sy: 0, sw: 2160, sh: 3840 });
  });
});

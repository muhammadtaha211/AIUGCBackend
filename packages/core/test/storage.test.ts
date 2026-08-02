import type { SupabaseClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "../src/logger";
import { contentTypeForKey, SupabaseStorage } from "../src/storage";

/**
 * supabase-js stores Buffer uploads as text/plain unless contentType is set;
 * HeyGen rejects signed URLs served with that type. These tests pin the
 * extension -> MIME mapping and that put() actually sends it (plus the
 * upsert-by-default behaviour job retries rely on).
 */

type UploadCall = { bucket: string; key: string; options: unknown };

function stubClient(calls: UploadCall[]): SupabaseClient {
  return {
    storage: {
      from(bucket: string) {
        return {
          async upload(key: string, _body: unknown, options: unknown) {
            calls.push({ bucket, key, options });
            return { data: { path: key }, error: null };
          },
        };
      },
    },
  } as unknown as SupabaseClient;
}

function tempFile(name: string): string {
  const dir = path.join(tmpdir(), "aiugc-storage-test-inputs");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  writeFileSync(file, "fake bytes");
  return file;
}

describe("storage content types", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves every mapped extension from the key", () => {
    const expected: Record<string, string> = {
      "face.jpg": "image/jpeg",
      "face.jpeg": "image/jpeg",
      "face.png": "image/png",
      "face.webp": "image/webp",
      "face.heic": "image/heic",
      "face.heif": "image/heif",
      "logo.svg": "image/svg+xml",
      "audio.mp3": "audio/mpeg",
      "audio.wav": "audio/wav",
      "audio.m4a": "audio/mp4",
      "final.mp4": "video/mp4",
      "clip.mov": "video/quicktime",
      "meta.json": "application/json",
    };
    for (const [filename, mime] of Object.entries(expected)) {
      expect(contentTypeForKey(`bank/persona_image/abc/${filename}`)).toBe(mime);
    }
  });

  it("is case-insensitive on the extension", () => {
    expect(contentTypeForKey("bank/persona_image/abc/FACE.JPG")).toBe("image/jpeg");
  });

  it("falls back to application/octet-stream for an unknown extension and warns with the key", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    expect(contentTypeForKey("bank/audio/abc/track.flac")).toBe("application/octet-stream");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatchObject({ key: "bank/audio/abc/track.flac" });
  });

  it("put() sends the derived contentType and defaults upsert to true (retries re-run uploads)", async () => {
    const calls: UploadCall[] = [];
    const storage = new SupabaseStorage(stubClient(calls));
    await storage.put("assets", "bank/persona_image/abc/face.png", tempFile("face.png"));
    expect(calls).toEqual([
      {
        bucket: "assets",
        key: "bank/persona_image/abc/face.png",
        options: { contentType: "image/png", upsert: true },
      },
    ]);
  });

  it("put() passes an explicit upsert: false through", async () => {
    const calls: UploadCall[] = [];
    const storage = new SupabaseStorage(stubClient(calls));
    await storage.put("renders", "biz/audio/abc/audio.mp3", tempFile("audio.mp3"), {
      upsert: false,
    });
    expect(calls).toEqual([
      {
        bucket: "renders",
        key: "biz/audio/abc/audio.mp3",
        options: { contentType: "audio/mpeg", upsert: false },
      },
    ]);
  });
});

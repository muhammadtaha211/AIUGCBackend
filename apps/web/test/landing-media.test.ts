import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LANDING_MEDIA } from "../src/lib/landing-media";

/**
 * /privacy §6 names no image service for the landing (its picsum stand-in was
 * removed on 2026-10-15), so the landing must load its media from tavnit.ai
 * alone: a third-party image would send the visitor's IP somewhere the policy
 * does not say.
 */
describe("the landing's media", () => {
  it("is our own files or an empty slot, never a third party", () => {
    const slots = [
      LANDING_MEDIA.demoBefore,
      LANDING_MEDIA.demoAfter,
      LANDING_MEDIA.presenterSample,
      LANDING_MEDIA.textBlockSample,
      ...LANDING_MEDIA.hookClips,
      LANDING_MEDIA.hookStudioShot,
      LANDING_MEDIA.instagramShot,
    ];
    const links = slots.flatMap((slot) => [slot.src, "poster" in slot ? slot.poster : null]);
    for (const link of links) {
      if (link !== null) expect(link).toMatch(/^\/(?!\/)/);
    }
  });

  it("is never an absolute address in the page itself", () => {
    const page = readFileSync(join(__dirname, "..", "src", "app", "page.tsx"), "utf8");
    expect(page).not.toMatch(/src=\{?[`"']https?:/);
    expect(page).not.toContain("picsum");
  });
});

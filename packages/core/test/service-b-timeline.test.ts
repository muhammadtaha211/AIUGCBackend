import {
  sampleDurationInFrames,
  sampleOpenerTimeline,
  sampleTimeline,
} from "@aiugc/remotion/fixtures";
import { describe, expect, it } from "vitest";
import { readTimeMs } from "../src/plan-format";
import {
  GAP_MS,
  HOOK_TEXT_MAX_MS,
  HOOK_TEXT_MIN_MS,
  serviceBTimeline,
} from "../src/service-b-timeline";

/**
 * The Service B layout math. Every number the composition lays out by comes
 * from here, so this is where the rules are pinned: the opener plays from 0
 * and the reveal is its reveal_at; the hook text stays for its read time,
 * clamped, and never leaves before the reveal; the lip-sync layer starts
 * GAP_MS before its speech onset; the VO and the captions start on the frame
 * speech begins; the ad ends when the later of clip and VO does.
 */

const VO_MS = 10_000;
/** HeyGen generates to the padded audio: VO + lead-in. */
const noOpener = {
  hasOpener: false,
  leadInMs: 800,
  lipsyncDurationMs: VO_MS + 800,
  voDurationMs: VO_MS,
};
const opener = {
  hasOpener: true,
  openerDurationMs: 2400,
  revealAtMs: 1600,
  hookText: "ככה מזמינים בלי לחכות",
  leadInMs: 800,
  lipsyncDurationMs: VO_MS + 800,
  voDurationMs: VO_MS,
};

describe("serviceBTimeline — no opener", () => {
  it("starts the clip GAP_MS before speech and the VO exactly at speech onset", () => {
    expect(serviceBTimeline(noOpener)).toEqual({
      hookTextMs: 0,
      revealAbsMs: 0,
      lipsyncStartFromMs: 800 - GAP_MS,
      captionOffsetMs: GAP_MS,
      // clip end = 0 + (10800 - 550) = 10250; VO end = 250 + 10000 = 10250.
      totalMs: GAP_MS + VO_MS,
    });
  });

  it("a pre-lead-in render (leadInMs 0) plays the clip from 0 with the VO from 0 — unchanged from before", () => {
    const t = serviceBTimeline({ ...noOpener, leadInMs: 0, lipsyncDurationMs: VO_MS });
    expect(t.lipsyncStartFromMs).toBe(0);
    expect(t.captionOffsetMs).toBe(0);
    expect(t.totalMs).toBe(VO_MS);
  });

  it("never ends before the VO does, even when HeyGen came back short", () => {
    const t = serviceBTimeline({ ...noOpener, lipsyncDurationMs: VO_MS - 2000 });
    expect(t.totalMs).toBe(GAP_MS + VO_MS);
  });

  it("runs to the clip's end when it outlasts the VO", () => {
    const t = serviceBTimeline({ ...noOpener, lipsyncDurationMs: VO_MS + 800 + 3000 });
    expect(t.totalMs).toBe(VO_MS + 800 + 3000 - (800 - GAP_MS));
  });

  it("never renders a zero-length composition", () => {
    expect(
      serviceBTimeline({ hasOpener: false, leadInMs: 0, lipsyncDurationMs: 0, voDurationMs: 0 })
        .totalMs,
    ).toBe(1);
  });
});

describe("serviceBTimeline — opener", () => {
  it("plays the clip from 0, cuts at reveal_at, keeps the text for its read time, speech GAP_MS after the cut", () => {
    expect(readTimeMs(opener.hookText)).toBe(2000); // 400 + 4 words / 2.5 wps
    expect(serviceBTimeline(opener)).toEqual({
      hookTextMs: 2000,
      revealAbsMs: 1600,
      lipsyncStartFromMs: 800 - GAP_MS,
      captionOffsetMs: 1600 + GAP_MS,
      totalMs: 1600 + GAP_MS + VO_MS,
    });
  });

  it("clamps the text's life to [HOOK_TEXT_MIN_MS, HOOK_TEXT_MAX_MS]", () => {
    expect(readTimeMs("רגע")).toBeLessThan(HOOK_TEXT_MIN_MS);
    expect(serviceBTimeline({ ...opener, hookText: "רגע", revealAtMs: 0 }).hookTextMs).toBe(
      HOOK_TEXT_MIN_MS,
    );
    const long = "אחת שתיים שלוש ארבע חמש שש שבע";
    expect(readTimeMs(long)).toBeGreaterThan(HOOK_TEXT_MAX_MS);
    expect(serviceBTimeline({ ...opener, hookText: long }).hookTextMs).toBe(HOOK_TEXT_MAX_MS);
  });

  it("never lets the text leave before the reveal — a covered lens always carries its line", () => {
    // Under the floor, but the palm phase runs to 1600.
    expect(serviceBTimeline({ ...opener, hookText: "רגע" }).hookTextMs).toBe(1600);
    // Past the read time, the reveal wins; past the ceiling too.
    expect(serviceBTimeline({ ...opener, revealAtMs: 2400 }).hookTextMs).toBe(2400);
    expect(
      serviceBTimeline({ ...opener, openerDurationMs: 4000, revealAtMs: 3000 }).hookTextMs,
    ).toBe(3000);
  });

  it("a reveal at 0 cuts on the first frame and still shows the text for its read time", () => {
    const t = serviceBTimeline({ ...opener, revealAtMs: 0 });
    expect(t.revealAbsMs).toBe(0);
    expect(t.hookTextMs).toBe(2000);
    expect(t.captionOffsetMs).toBe(GAP_MS);
  });

  it("refuses an opener without its fields, or a reveal outside the clip", () => {
    expect(() => serviceBTimeline({ ...opener, hookText: undefined })).toThrow(/needs/);
    expect(() => serviceBTimeline({ ...opener, revealAtMs: 2401 })).toThrow(/outside/);
    expect(() => serviceBTimeline({ ...opener, revealAtMs: -1 })).toThrow(/outside/);
  });

  it("matches the Remotion preview fixtures, which mirror it as literals", () => {
    // fixtures.ts cannot import this module (core depends on @aiugc/remotion,
    // never the other way round), so it carries the numbers as literals, and
    // this is what keeps them honest.
    // Derived from the fixture length, not read back off the fixture, so
    // totalMs is genuinely pinned. 30 is the locked FPS.
    const voMs = (sampleDurationInFrames / 30) * 1000;
    expect(sampleTimeline).toEqual(
      serviceBTimeline({
        hasOpener: false,
        leadInMs: 0,
        lipsyncDurationMs: voMs,
        voDurationMs: voMs,
      }),
    );
    expect(sampleOpenerTimeline).toEqual(
      serviceBTimeline({
        hasOpener: true,
        openerDurationMs: 2400,
        revealAtMs: 1600,
        hookText: "ככה מזמינים בלי לחכות",
        leadInMs: 800,
        // The placeholder talking head stands in for the lip-sync clip and
        // carries no lead-in of its own, so the VO tail sets the end.
        lipsyncDurationMs: voMs,
        voDurationMs: voMs,
      }),
    );
  });
});

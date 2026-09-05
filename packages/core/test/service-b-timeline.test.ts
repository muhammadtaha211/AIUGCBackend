import { sampleOpenerTimeline, sampleTimeline } from "@aiugc/remotion/fixtures";
import { describe, expect, it } from "vitest";
import { readTimeMs } from "../src/plan-format";
import {
  CROSSFADE_FRAMES,
  GAP_MS,
  HOLD_MAX_MS,
  HOLD_MIN_MS,
  PUNCH_IN_MS,
  PUNCH_IN_SCALE,
  serviceBTimeline,
} from "../src/service-b-timeline";

/**
 * The Service B layout math. Every number the composition lays out by comes
 * from here, so this is where the rules are pinned: the hold is the hook
 * text's read time clamped; the reveal is hold + reveal_at; the lip-sync
 * layer starts GAP_MS before its speech onset; the VO and the captions start
 * on the frame speech begins; the ad ends when the later of clip and VO does.
 */

const VO_MS = 10_000;
/** HeyGen generates to the padded audio: VO + lead-in. */
const noOpener = { hasOpener: false, leadInMs: 800, lipsyncDurationMs: VO_MS + 800, voDurationMs: VO_MS };
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
      holdMs: 0,
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
  it("holds the first frame for the hook text's read time, reveals at hold + reveal_at, speech GAP_MS later", () => {
    const hold = readTimeMs(opener.hookText);
    expect(hold).toBe(2000); // 400 + 4 words / 2.5 wps
    expect(serviceBTimeline(opener)).toEqual({
      holdMs: hold,
      revealAbsMs: hold + 1600,
      lipsyncStartFromMs: 800 - GAP_MS,
      captionOffsetMs: hold + 1600 + GAP_MS,
      totalMs: hold + 1600 + GAP_MS + VO_MS,
    });
  });

  it("clamps the hold to [HOLD_MIN_MS, HOLD_MAX_MS]", () => {
    expect(serviceBTimeline({ ...opener, hookText: "רגע" }).holdMs).toBe(HOLD_MIN_MS);
    expect(readTimeMs("רגע")).toBeLessThan(HOLD_MIN_MS);
    const long = "אחת שתיים שלוש ארבע חמש שש שבע";
    expect(readTimeMs(long)).toBeGreaterThan(HOLD_MAX_MS);
    expect(serviceBTimeline({ ...opener, hookText: long }).holdMs).toBe(HOLD_MAX_MS);
  });

  it("a reveal at 0 cuts the moment the hold ends", () => {
    const t = serviceBTimeline({ ...opener, revealAtMs: 0 });
    expect(t.revealAbsMs).toBe(t.holdMs);
  });

  it("refuses an opener without its fields, or a reveal outside the clip", () => {
    expect(() => serviceBTimeline({ ...opener, hookText: undefined })).toThrow(/needs/);
    expect(() => serviceBTimeline({ ...opener, revealAtMs: 2401 })).toThrow(/outside/);
    expect(() => serviceBTimeline({ ...opener, revealAtMs: -1 })).toThrow(/outside/);
  });

  it("matches the Remotion preview fixtures, which mirror it as literals", () => {
    // fixtures.ts cannot import this module (core depends on @aiugc/remotion,
    // never the other way round), so it carries the numbers — and the three
    // effect constants — as literals, and this is what keeps them honest.
    const effects = {
      crossfadeFrames: CROSSFADE_FRAMES,
      punchInScale: PUNCH_IN_SCALE,
      punchInMs: PUNCH_IN_MS,
    };
    const voMs = sampleTimeline.totalMs;
    expect(sampleTimeline).toEqual({
      ...serviceBTimeline({
        hasOpener: false,
        leadInMs: 0,
        lipsyncDurationMs: voMs,
        voDurationMs: voMs,
      }),
      ...effects,
    });
    expect(sampleOpenerTimeline).toEqual({
      ...serviceBTimeline({
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
      ...effects,
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  HOOK_EFFECTS,
  HOOK_LANDS_AFTER_SPEECH_MS,
  hookAnimation,
  hookAnimationDurationMs,
  isHookAnimation,
} from "../src/hook-effect";
import { GAP_MS } from "../src/service-b-timeline";

/**
 * The tuned numbers moved out of pipelines/renders.ts on 2026-09-06 so the
 * wizard's effect preview could animate the SAME values the render burns
 * (vault 0024). These pin them: a retune is still a deploy, but it can no
 * longer land in one place and not the other, and `lipsync-chain.test.ts`
 * pins the other half — that buildServiceBProps actually reaches for them.
 */

/** Speech onset for every real Service B render: min(leadInMs, GAP_MS) with
 *  lipsync_lead_in_ms at 800, which is what the preview assumes too. */
const SPEECH_AT = GAP_MS;

describe("hookAnimation", () => {
  it("gives no animation for none, and for a name this build does not know", () => {
    expect(hookAnimation("none", SPEECH_AT)).toEqual({});
    expect(hookAnimation(undefined, SPEECH_AT)).toEqual({});
    // QC regeneration replays old params wholesale, so a renamed effect from an
    // older deploy must render hookless rather than throw after HeyGen billed.
    expect(hookAnimation("kenburns", SPEECH_AT)).toEqual({});
  });

  it("lands the zoom and the focus 400ms after speech starts", () => {
    const landsAt = SPEECH_AT + HOOK_LANDS_AFTER_SPEECH_MS;
    expect(landsAt).toBe(650);
    expect(hookAnimation("zoom", SPEECH_AT).zoom).toEqual({
      from: 1.35,
      to: 1.42,
      atMs: landsAt,
      durationMs: 450,
    });
    // The pull ends where the zoom's does and starts as early as the silence
    // allows — never before frame 0, so holdMs is 0 at this gap.
    expect(hookAnimation("focus", SPEECH_AT).focus).toEqual({
      blurPx: 20,
      holdMs: 0,
      durationMs: landsAt,
    });
  });

  it("keeps the focus pull at its judged length when the silence is long enough", () => {
    // A 900ms gap leaves room for the full 850ms pull, which then holds first.
    const focus = hookAnimation("focus", 900).focus!;
    expect(focus.durationMs).toBe(850);
    expect(focus.holdMs).toBe(900 + HOOK_LANDS_AFTER_SPEECH_MS - 850);
  });

  it("runs the whip from frame 0, independent of the gap", () => {
    const whip = { fromX: 140, durationMs: 420, blurPx: 20 };
    expect(hookAnimation("whip", SPEECH_AT).whip).toEqual(whip);
    expect(hookAnimation("whip", 5_000).whip).toEqual(whip);
  });

  it("reports how long the whole move takes — what a preview has to play", () => {
    expect(hookAnimationDurationMs(hookAnimation("zoom", SPEECH_AT))).toBe(650 + 450);
    expect(hookAnimationDurationMs(hookAnimation("focus", SPEECH_AT))).toBe(650);
    expect(hookAnimationDurationMs(hookAnimation("whip", SPEECH_AT))).toBe(420);
    expect(hookAnimationDurationMs(hookAnimation("none", SPEECH_AT))).toBe(0);
  });

  it("has numbers for every name the wizard can offer", () => {
    for (const effect of HOOK_EFFECTS) {
      const animation = hookAnimation(effect, SPEECH_AT);
      // "none" is the one name with nothing behind it; every other name must
      // produce a move, or the wizard offers a card that renders as nothing.
      expect(hookAnimationDurationMs(animation) > 0).toBe(isHookAnimation(effect));
    }
  });
});

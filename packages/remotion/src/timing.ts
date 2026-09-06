import { interpolate, random } from "remotion/no-react";
import {
  FPS,
  WIDTH,
  type CaptionChunk,
  type GradeCurve,
  type HookBeats,
  type HookFocus,
  type HookTextReveal,
  type HookWhip,
  type HookZoom,
} from "./schema";

/**
 * The talking-head grade at `ms` into the clip: linear between samples, held
 * past the last. Mirrors @aiugc/core's media/grade.ts `gradeAt` — core cannot
 * be imported here — and core's grade.test.ts pins the shared semantics.
 */
export function gradeAt(curve: GradeCurve, ms: number): [number, number, number] {
  const pos = Math.max(0, ms / curve.stepMs);
  const i = Math.min(Math.floor(pos), curve.r.length - 1);
  const j = Math.min(i + 1, curve.r.length - 1);
  const f = Math.min(1, pos - i);
  const lerp = (arr: number[]) => arr[i]! + (arr[j]! - arr[i]!) * f;
  return [lerp(curve.r), lerp(curve.g), lerp(curve.b)];
}

/**
 * Caption timing selection — pure functions, no React, no I/O (this is the
 * part worth unit-testing; the rest of the composition is layout).
 *
 * Both selectors use the same anti-flicker rule: whatever started most
 * recently stays on screen. Karaoke chunks come from `chunkWords` with small
 * gaps between them (breath pauses), and blanking the lower third for 80ms
 * between chunks reads as a glitch in a 2-second-attention-span ad.
 * Inputs are assumed sorted by startMs, which is what `chunkWords` produces.
 */

export function msToFrame(ms: number): number {
  return Math.round((ms / 1000) * FPS);
}

export function frameToMs(frame: number): number {
  return (frame / FPS) * 1000;
}

/**
 * Handheld camera: a phone held at arm's length never sits still, and a
 * perfectly static picture is the strongest "this is AI" tell (both source
 * clips — the Seedance opener and the HeyGen talking head — have locked-off
 * cameras). Three octaves of smooth seeded noise per axis — a slow wander
 * with a little jitter on top — rather than sines: a hand has no period, and
 * the first sine version read as a pattern (founder, 2026-09-05). A pure
 * function of the ABSOLUTE frame, so the path runs continuously through the
 * reveal cut instead of restarting on it, and of the seed (the render id), so
 * a retry re-renders identical frames. The picture underneath is scaled by
 * OVERSCAN so no edge shows; timing.test.ts pins that every frame of three
 * seeds — two renders' ids and the tightest of 300 random ones — stays
 * covered with room for the alignment offset. Not a proof for every seed.
 *
 * Every amplitude (px at 1080×1920, degrees) and knot rate (Hz) here was
 * chosen by eye on 2026-09-05, none measured — the dial is these nine numbers.
 */
const SWAY = {
  x: { amp: [8, 3, 1], hz: [0.35, 1.1, 3.3] },
  y: { amp: [6.5, 2.5, 0.8], hz: [0.4, 1.3, 3.7] },
  rot: { amp: [0.3, 0.12, 0.04], hz: [0.3, 0.9, 2.9] },
} as const;

export const OVERSCAN = 1.06;

/**
 * The seam: the opener's reveal frame and the talking head's idle frame are
 * the same pose, colour-graded to each other and offset into alignment, and
 * the cut between them is HARD. A 4-frame soft cut here plus a 1.5s ease on
 * the alignment offset (2026-09-06) read to the founder as "a weird
 * transition animation" on top of the jump they were meant to hide, and a
 * 5-frame dissolve before that (2026-09-05) ghosted a moving hand. Nothing
 * moves at the seam now except the shared camera path. Frames of opacity
 * ramp on the head while the opener holds underneath; 0 = hard cut.
 */
export const SEAM_DISSOLVE_FRAMES = 0;

/**
 * Smooth noise within ±1.25 (the curve's overshoot past its knots): a Catmull-Rom curve through random
 * knots `hz` per second. Continuous velocity — no stall at the knots — and
 * no period.
 */
function smoothNoise(seed: string, t: number, hz: number): number {
  const x = t * hz;
  const i = Math.floor(x);
  const f = x - i;
  const knot = (k: number) => random(`${seed}:${k}`) * 2 - 1;
  const [p0, p1, p2, p3] = [knot(i - 1), knot(i), knot(i + 1), knot(i + 2)];
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * f +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f +
      (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f)
  );
}

export function handheld(frame: number, seed: string): { x: number; y: number; rot: number } {
  const t = frame / FPS;
  const axis = (name: keyof typeof SWAY) =>
    SWAY[name].amp.reduce(
      (sum, amp, i) => sum + amp * smoothNoise(`${seed}:${name}:${i}`, t, SWAY[name].hz[i]!),
      0,
    );
  return { x: axis("x"), y: axis("y"), rot: axis("rot") };
}

/**
 * The zoom hook's scale at `ms` of composition time: the tight opening creeps
 * from `from` to `to` (a still shot that is not quite still), then eases out
 * to 1 over `durationMs` from `atMs`. Ease-in-out cubic — soft at both ends,
 * fast in the middle, the shape of a hand pulling a phone back. One clip, so
 * this is a camera move, never a seam. `atMs` 0 skips the creep.
 */
const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export function hookZoomScale(zoom: HookZoom, ms: number): number {
  if (zoom.atMs > 0 && ms < zoom.atMs) {
    return interpolate(ms, [0, zoom.atMs], [zoom.from, zoom.to], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  }
  return interpolate(ms, [zoom.atMs, zoom.atMs + zoom.durationMs], [zoom.to, 1], {
    extrapolateRight: "clamp",
    easing: easeInOutCubic,
  });
}

/**
 * The other hook animations (mocks, 2026-09-06 — schema.ts says why they are
 * all optional). Each is a pure function of composition ms and its own prop;
 * ServiceB multiplies whatever scales come back into the one transform on the
 * talking-head layer.
 *
 * THE INVARIANT they all have to keep: the picture sits inside the outer
 * handheld container's OVERSCAN, and timing.test.ts pins that the sway leaves
 * at least 12px horizontally and 32px vertically of it unused. So a transform
 * that only scales UP is safe by construction (a bigger picture cannot expose
 * an edge); anything that translates or blurs has to buy its own cover, which
 * is why `hookFocusState` and `hookWhipState` return a scale rather than
 * taking one.
 */

/** Half the frame — the tight axis for every coverage sum below. */
const HALF_W = WIDTH / 2;
/**
 * Cover for a blur: a Gaussian of stdDeviation `blurPx` (what CSS
 * `blur(Npx)` sets) has ~2.3% of its mass past 2σ, so a frame edge cut there
 * is at worst ~2% dark — invisible in an ad, where 3σ would cost a third
 * more zoom. The sway's pinned 12px of spare cover is the margin on top; the
 * scale below buys exactly the bleed and nothing more, so it lands on 1 the
 * instant the blur does instead of stepping.
 */
const BLUR_COVER_SIGMAS = 2;

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

/**
 * Rack focus at `ms`: soft to `holdMs`, then sharp over `durationMs`.
 * The scale is not a second knob — it is the cover the blur needs (above),
 * and it decays with the blur, so it reads as the focus breathing a real lens
 * does and lands at exactly 1 the moment the picture is sharp.
 */
export function hookFocusState(focus: HookFocus, ms: number): { blurPx: number; scale: number } {
  const blurPx = interpolate(
    ms,
    [focus.holdMs, focus.holdMs + focus.durationMs],
    [focus.blurPx, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeInOutCubic },
  );
  return { blurPx, scale: blurCoverScale(0, blurPx) };
}

/**
 * Whip-in at `ms`: the picture enters `fromX` px off, under a blur that is
 * directional (x only, an SVG feGaussianBlur — CSS blur() is isotropic and
 * would soften the whole frame), and settles by `durationMs` on an ease-out
 * cubic — fast off the mark, no bounce. The scale is derived cover, as above.
 */
export function hookWhipState(
  whip: HookWhip,
  ms: number,
): { dx: number; blurPx: number; scale: number } {
  const remaining = 1 - easeOutCubic(clamp01(ms / whip.durationMs));
  const dx = whip.fromX * remaining;
  const blurPx = whip.blurPx * remaining;
  return { dx, blurPx, scale: blurCoverScale(dx, blurPx) };
}

/**
 * The scale that keeps a picture offset by `dx` and blurred by `blurPx`
 * covering the frame. A CSS/SVG filter runs in the element's LOCAL pixels and
 * the element's own transform is then applied to the filtered result, so the
 * alpha ramp is inset 2 sigma * s on screen, not 2 sigma — the compensating
 * scale magnifies the very bleed it buys. Solving `s(HALF_W - 2 sigma) =
 * HALF_W + |dx|` lands the near edge on exactly -HALF_W at every sigma, so
 * the sway's spare cover is never spent. (The additive form this replaced
 * under-bought by 2 sigma (s-1): 3px at blur 20, 23px at blur 56 — measured
 * 2026-09-06, packages/core/.work/hook-probe.ts.) The clamp is what stops a
 * large blur turning a division into a NEGATIVE scale, i.e. a mirrored picture.
 */
function blurCoverScale(dx: number, blurPx: number): number {
  const bleed = Math.min(BLUR_COVER_SIGMAS * blurPx, HALF_W - 1);
  return (HALF_W + Math.abs(dx)) / (HALF_W - bleed);
}

/**
 * Kinetic hook text at `ms`, given `endMs` — the time the line leaves, which
 * is the caption handoff. Per-word progress 0..1 (the pop) and one exit
 * progress 0..1 for the slide-and-fade that finishes exactly at `endMs`, so
 * the line is gone by the frame the first caption line arrives. Words with no
 * entry in `wordMs` follow the last one, so a hook line the matcher could not
 * split still fully appears.
 */
export function hookTextRevealState(
  reveal: HookTextReveal,
  ms: number,
  endMs: number,
  wordCount: number,
): { wordProgress: number[]; exit: number } {
  const last = reveal.wordMs[reveal.wordMs.length - 1]!;
  const wordProgress = Array.from({ length: wordCount }, (_, i) =>
    easeOutCubic(clamp01((ms - (reveal.wordMs[i] ?? last)) / reveal.popMs)),
  );
  const exit =
    reveal.exitDurationMs <= 0
      ? 0
      : easeInOutCubic(clamp01((ms - (endMs - reveal.exitDurationMs)) / reveal.exitDurationMs));
  return { wordProgress, exit };
}

/**
 * Emphasis punches at `ms`: a pop on each beat — a sharp rise over the first
 * third, a softer fall over the rest, which is how a bump on a stressed word
 * reads — plus the optional slow push from `push.fromMs` to `endMs`.
 * Overlapping beats take the LOUDER one, never the sum: two beats 100ms apart
 * must not double the punch.
 */
const PUNCH_ATTACK = 0.3;

export function hookBeatsScale(beats: HookBeats, ms: number, endMs: number): number {
  let punch = 0;
  for (const at of beats.atMs) {
    const t = (ms - at) / beats.durationMs;
    if (t < 0 || t > 1) continue;
    const shape =
      t < PUNCH_ATTACK
        ? easeOutCubic(t / PUNCH_ATTACK)
        : 1 - easeInOutCubic((t - PUNCH_ATTACK) / (1 - PUNCH_ATTACK));
    punch = Math.max(punch, beats.amount * shape);
  }
  // Math.min: a push starting at or past the ad's end is a caller mistake, but
  // `endMs` is timeline.totalMs — computed, never typed — so it must not throw
  // ("inputRange must be strictly monotonically increasing") at frame 0 and
  // lose the whole render. It degrades to a push with nowhere left to run.
  const push = beats.push
    ? interpolate(ms, [Math.min(beats.push.fromMs, endMs - 1), endMs], [0, beats.push.to - 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 0;
  return 1 + punch + push;
}

// Service B's length lives in @aiugc/core's serviceBTimeline (client-safe,
// computed once per render and passed in as the `timeline` prop) — the VO is
// still never cut off: totalMs is the later of the clip's end and the VO's.

export interface ServiceATimeline {
  durationInFrames: number;
  hookFrames: number;
  /** Frames of the demo actually shown before the ending takes over. */
  demoVisibleFrames: number;
  /** Absolute frame where the avatar outro starts (avatar mode only). */
  avatarStartFrame?: number;
}

/**
 * Service A length. Hook then demo; the VO plays from demo start. When the VO
 * outlasts the demo the composition runs to the VO's end — "freeze" holds the
 * last demo frame for the remainder, "avatar" hard-cuts to the lip-synced
 * outro at `voSliceMs` into the VO (so the outro's lips line up with the VO
 * that keeps playing). A slice landing past the demo end (snap chose a gap in
 * trailing silence... impossible today, but cheap to hold) freezes the demo
 * until the avatar starts.
 */
export function serviceATimeline(input: {
  hookFrames: number;
  demoFrames: number;
  voFrames?: number;
  outroMode?: "freeze" | "avatar";
  voSliceMs?: number;
}): ServiceATimeline {
  const hookFrames = Math.max(1, input.hookFrames);
  const demoFrames = Math.max(1, input.demoFrames);
  const voFrames = input.voFrames ?? 0;

  let durationInFrames = hookFrames + demoFrames;
  let demoVisibleFrames = demoFrames;
  let avatarStartFrame: number | undefined;

  if (input.outroMode === "freeze") {
    durationInFrames = hookFrames + Math.max(demoFrames, voFrames);
  } else if (input.outroMode === "avatar") {
    const sliceFrames = Math.max(1, msToFrame(input.voSliceMs ?? 0));
    demoVisibleFrames = Math.min(demoFrames, sliceFrames);
    avatarStartFrame = hookFrames + sliceFrames;
    durationInFrames = hookFrames + Math.max(demoFrames, voFrames);
  }

  return { durationInFrames, hookFrames, demoVisibleFrames, avatarStartFrame };
}

export interface ServiceAStepsTimelineStep {
  /** Absolute composition frame where this step's sequence starts. */
  fromFrame: number;
  durationInFrames: number;
  /** Frames of the demo skipped before this step's first shown frame. */
  trimBeforeFrames: number;
}

export interface ServiceAStepsTimeline {
  durationInFrames: number;
  hookFrames: number;
  steps: ServiceAStepsTimelineStep[];
}

/** Marker in the out-of-range throw below. The throw fires in the browser
 *  during selectComposition and reaches Node as a plain Error, so render.ts
 *  matches this substring to remap it to RenderPropsError (permanent). */
export const STEP_OUT_OF_RANGE = "outside the demo";

/**
 * Steps-format length: hook, then the steps back to back, hard cuts between.
 * A step whose window runs past the demo's end is clamped to it; a step whose
 * TRIM starts outside the demo throws — that is a bad plan, and the throw in
 * `calculateServiceAStepsMetadata` fails the render before any frame is paid
 * for, instead of showing a frozen or black clip.
 * Steps are laid out in the order given: chronology is the server's job.
 */
export function serviceAStepsTimeline(input: {
  hookFrames: number;
  demoFrames: number;
  steps: { startMs: number; durationMs: number }[];
}): ServiceAStepsTimeline {
  const hookFrames = Math.max(1, input.hookFrames);
  const demoFrames = Math.max(1, input.demoFrames);

  const steps: ServiceAStepsTimelineStep[] = [];
  let cursor = hookFrames;
  input.steps.forEach((step, i) => {
    const trimBeforeFrames = msToFrame(step.startMs);
    if (step.startMs < 0 || trimBeforeFrames >= demoFrames) {
      throw new Error(
        `step ${i} starts at ${step.startMs}ms — ${STEP_OUT_OF_RANGE} (${demoFrames} frames)`,
      );
    }
    const wantedEndFrame = msToFrame(step.startMs + step.durationMs);
    const endFrame = Math.min(wantedEndFrame, demoFrames);
    if (endFrame < wantedEndFrame && i < input.steps.length - 1) {
      // Defensive net. @aiugc/core's assembleSteps caps every step at the gap
      // to the next one, and every selected state is inside the recording, so
      // a NON-LAST step can only reach this clamp if the plan is malformed —
      // its cut point is then not the one that was approved. The last step
      // outrunning the recording is the normal case (the success state sits
      // near the end and still takes its full duration) and is not logged: a
      // net that fires on healthy renders is one nobody reads.
      //
      // This prints at the render's pinned logLevel "error". Remotion passes a
      // browser console message's OWN level as the threshold, so a warn from
      // the composition always reaches the worker's stdout.
      console.warn(
        `step ${i} clamped to the demo end: wanted ${wantedEndFrame} frames, demo has ${demoFrames}`,
      );
    }
    const durationInFrames = Math.max(1, endFrame - trimBeforeFrames);
    steps.push({ fromFrame: cursor, durationInFrames, trimBeforeFrames });
    cursor += durationInFrames;
  });

  return { durationInFrames: Math.max(1, cursor), hookFrames, steps };
}

/**
 * Index of the chunk to show at `ms`, or -1 for none.
 * A chunk holds until the next one starts; the last chunk holds until its own
 * endMs so the ad doesn't end on a frozen caption.
 */
export function activeChunkIndex(chunks: CaptionChunk[], ms: number): number {
  let found = -1;
  for (let i = 0; i < chunks.length; i++) {
    if (chunks[i]!.startMs > ms) break;
    found = i;
  }
  if (found === chunks.length - 1 && found >= 0 && ms >= chunks[found]!.endMs) return -1;
  return found;
}

/**
 * Index of the word to highlight inside a chunk at `ms`, or -1 before the
 * first word starts (and always for even-spaced captions, which carry no
 * word timings).
 */
export function activeWordIndex(chunk: CaptionChunk, ms: number): number {
  let found = -1;
  for (let i = 0; i < chunk.words.length; i++) {
    if (chunk.words[i]!.startMs > ms) break;
    found = i;
  }
  return found;
}

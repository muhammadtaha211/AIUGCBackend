import { z } from "zod";

/**
 * Composition props for the ServiceB composition.
 *
 * These mirror `RenderServiceBProps` from @aiugc/core (the frozen render
 * contract) with one deliberate difference: the contract carries LOCAL file
 * paths, while a composition runs in a browser and can only load URLs.
 * `render.ts` serves the local files on loopback and maps path -> src.
 *
 * The schema is what `<Composition schema={...}>` uses (so Remotion Studio can
 * edit props) and what the render entrypoint validates before paying for a
 * render.
 */

export const wordTimingSchema = z.object({
  word: z.string(),
  startMs: z.number(),
  endMs: z.number(),
});

export const captionChunkSchema = z.object({
  text: z.string(),
  startMs: z.number(),
  endMs: z.number(),
  words: z.array(wordTimingSchema),
});

/** {x, y, w, h} in 1080x1920 space where the burned hook line may be placed. */
export const textSafeAreaSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

/**
 * The Service B layout, computed ONCE by @aiugc/core's serviceBTimeline and
 * passed in — the composition converts these to frames and does no timeline
 * arithmetic of its own.
 */
export const serviceBTimelineSchema = z.object({
  hookTextMs: z.number().nonnegative(),
  revealAbsMs: z.number().nonnegative(),
  lipsyncStartFromMs: z.number().nonnegative(),
  captionOffsetMs: z.number().nonnegative(),
  totalMs: z.number().positive(),
});

/** Mirrors @aiugc/core's media/grade.ts GradeCurve (core depends on this package, never the other way round). */
export const gradeCurveSchema = z.object({
  stepMs: z.number().positive(),
  r: z.array(z.number().positive()).min(1),
  g: z.array(z.number().positive()).min(1),
  b: z.array(z.number().positive()).min(1),
});
export type GradeCurve = z.infer<typeof gradeCurveSchema>;

/**
 * The zoom hook (mock, 2026-09-06): the talking head opens tight — scale
 * `from` creeping to `to` over the hook — then eases out to 1 at `atMs` over
 * `durationMs`, with an optional whoosh at the ease. One clip, so the "cut"
 * is a camera move, not a seam between two generations.
 */
export const hookZoomSchema = z.object({
  from: z.number().min(1),
  to: z.number().min(1),
  atMs: z.number().min(0),
  durationMs: z.number().min(1),
  sfxSrc: z.string().optional(),
});
export type HookZoom = z.infer<typeof hookZoomSchema>;

/**
 * The other hook-animation mocks (2026-09-06), all pending the founder's pick
 * — decision 0023 says the wizard will offer animation effects with "none" as
 * one option, and these are the candidates being judged. Same contract as
 * `hookZoom`: optional, inert unless passed, all timing in pure functions in
 * timing.ts. Whichever survive collapse into one `hookEffect` render param and
 * the rest get deleted, so nothing else in the tree may depend on them.
 */

/**
 * Rack focus: the picture opens soft at `blurPx`, holds to `holdMs`, then
 * pulls sharp over `durationMs` as speech starts. A CSS blur bleeds
 * transparency past the element box, so the layer also carries a compensating
 * scale that decays with the blur (timing.ts `hookFocusState`) — that is what
 * keeps the frame edge covered, and it reads as focus breathing.
 */
export const hookFocusSchema = z.object({
  blurPx: z.number().min(0),
  holdMs: z.number().min(0),
  durationMs: z.number().min(1),
});
export type HookFocus = z.infer<typeof hookFocusSchema>;

/**
 * Whip-in: the picture enters offset by `fromX` px under a directional blur
 * and settles at rest over `durationMs`. The scale that keeps the slide
 * covered is DERIVED from the offset and the blur, never passed in
 * (timing.ts `hookWhipState`).
 */
export const hookWhipSchema = z.object({
  fromX: z.number(),
  durationMs: z.number().min(1),
  blurPx: z.number().min(0),
  sfxSrc: z.string().optional(),
});
export type HookWhip = z.infer<typeof hookWhipSchema>;

/**
 * Kinetic hook text: the centred line's words pop in one at a time at
 * `wordMs` (composition ms, one per word of `hookText`), then the whole line
 * slides down and fades over the LAST `exitDurationMs` of its life — so it
 * leaves exactly as the first caption line arrives, instead of cutting.
 * Fewer entries than words = the rest pop with the last one.
 */
export const hookTextRevealSchema = z.object({
  wordMs: z.array(z.number()).min(1),
  popMs: z.number().min(1),
  exitDurationMs: z.number().min(0),
});
export type HookTextReveal = z.infer<typeof hookTextRevealSchema>;

/**
 * Emphasis punches: a quick scale pop at each `atMs` (an emphasis word's
 * onset), plus an optional slow push-in from `push.fromMs` to the ad's end.
 * Both only ever scale UP, so neither can expose a frame edge.
 */
export const hookBeatsSchema = z.object({
  atMs: z.array(z.number()),
  amount: z.number().min(0),
  durationMs: z.number().min(1),
  push: z.object({ fromMs: z.number().min(0), to: z.number().min(1) }).optional(),
});
export type HookBeats = z.infer<typeof hookBeatsSchema>;

export const serviceBSchema = z.object({
  talkingHeadSrc: z.string(),
  /**
   * The approved VO — the composition's only audio track. Never optional:
   * Service B always has approved audio, so a missing one is a bug that must
   * fail the render, not fall back to the talking head's own (re-encoded)
   * audio. Starts at timeline.captionOffsetMs, the frame speech begins in the
   * clip.
   */
  voiceoverSrc: z.string(),
  /** B-roll cutaways. Empty is normal and must render cleanly. */
  brollSrcs: z.array(z.string()),
  captions: z.array(captionChunkSchema),
  watermark: z.boolean(),
  /**
   * The opener effect (vault 0017): a founder-made clip played in front of the
   * talking head with the hook text burned over its palm phase, hard-cut at
   * the reveal. Core sends the three together or not at all; the composition
   * itself needs only hookText + rect + a positive hookTextMs to burn the
   * line, which is how the zoom hook shows it without an opener.
   */
  openerSrc: z.string().optional(),
  hookText: z.string().optional(),
  hookTextSafeArea: textSafeAreaSchema.optional(),
  timeline: serviceBTimelineSchema,
  /**
   * Per-channel gain curve on the talking head, measured in core against the
   * opener's reveal frame: one sample every `stepMs` of talking-head time,
   * interpolated and held past the last, so the cut lands at the opener's
   * colour and stays there while HeyGen's head brightens into speech.
   * Absent = ungraded.
   */
  talkingHeadGrade: gradeCurveSchema.optional(),
  /**
   * Pixels the talking head is offset by, for its whole length, so its idle
   * frame sits on the opener's reveal frame at the cut. Absent = no offset.
   */
  talkingHeadAlign: z.object({ dx: z.number(), dy: z.number() }).optional(),
  /** Absent = no zoom. The pipeline never sets it yet; the mock script does. */
  hookZoom: hookZoomSchema.optional(),
  /** The other candidates, all absent = off. Mocks; see the block above. */
  hookFocus: hookFocusSchema.optional(),
  hookWhip: hookWhipSchema.optional(),
  hookTextReveal: hookTextRevealSchema.optional(),
  hookBeats: hookBeatsSchema.optional(),
  /**
   * Seeds the handheld camera path (timing.ts `handheld`). The worker passes
   * the render id; absent = the fixed "preview" path Studio and the sample
   * renders show.
   */
  cameraSeed: z.string().optional(),
  /**
   * Filled in by `calculateServiceBMetadata` (which probes the clips), not by
   * the caller — they mark where each clip runs out and its final frame has
   * to be held. Absent means "no hold", which is what Studio shows before
   * metadata resolves.
   */
  talkingHeadDurationInFrames: z.number().optional(),
  openerDurationInFrames: z.number().optional(),
});

export const serviceASchema = z.object({
  /** The bank reaction clip — always muted: the hook is read, not heard. */
  hookSrc: z.string(),
  hookLine: z.string(),
  hookTextSafeArea: textSafeAreaSchema,
  demoSrc: z.string(),
  /**
   * The approved VO — voiced variant only. Plays from demo start (the hook
   * carries burned text only) and is the ad's audio track; the demo is muted
   * when it is present.
   */
  voiceoverSrc: z.string().optional(),
  /** Demo-relative captions: karaoke chunks (voiced) or evenly spaced lines (silent). */
  captions: z.array(captionChunkSchema),
  /**
   * What happens when the VO outlasts the demo (absent = it doesn't):
   * "freeze" holds the last demo frame with a slow push-in; "avatar" hard-cuts
   * to the lip-synced outro clip at `voSliceMs` into the VO.
   */
  outroMode: z.enum(["freeze", "avatar"]).optional(),
  voSliceMs: z.number().optional(),
  /** Lip-synced outro clip — muted; the continuous VO carries all audio. */
  avatarSrc: z.string().optional(),
  watermark: z.boolean(),
  /**
   * Filled in by `calculateServiceAMetadata` (which probes the actual files),
   * not by the caller. Absent only in Studio before metadata resolves.
   */
  hookDurationInFrames: z.number().optional(),
  demoDurationInFrames: z.number().optional(),
  voDurationInFrames: z.number().optional(),
  avatarDurationInFrames: z.number().optional(),
});

/** One step of the steps format: a window cut from the demo + its burned label. */
export const stepSegmentSchema = z.object({
  /** Where in the SOURCE demo this step's clip starts. */
  startMs: z.number().nonnegative(),
  /** Positive by contract: a zero/negative window (e.g. a bad
   *  a_step_ms_by_action config value) must fail at pay time, not render a
   *  1-frame flash — the timeline's 1-frame floor is rounding safety only. */
  durationMs: z.number().positive(),
  /** Short Hebrew line burned in the lower-third rect while the step plays. */
  label: z.string(),
});

export const serviceAStepsSchema = z.object({
  /** The bank reaction clip — always muted: the hook is read, not heard. */
  hookSrc: z.string(),
  hookLine: z.string(),
  hookTextSafeArea: textSafeAreaSchema,
  /**
   * The hook line's fill, and the rgb ("r,g,b") its outline is drawn in —
   * the values behind the clip's colour name, resolved in core
   * (hook-text-color.ts, decision 0073). Absent = white on the dark outline,
   * the hook line every render burned before it. Step labels never take it.
   */
  hookTextInk: z.object({ fill: z.string(), outline: z.string() }).optional(),
  /** ONE demo file; every step mounts it with a different trim — no concat,
   *  no intermediate encode. */
  demoSrc: z.string(),
  /** Chronological (the server sorts by timestamp — a property of the format). */
  steps: z.array(stepSegmentSchema).min(1),
  watermark: z.boolean(),
  /**
   * Filled in by `calculateServiceAStepsMetadata` (which probes the actual
   * files), not by the caller. Absent only in Studio before metadata resolves.
   */
  hookDurationInFrames: z.number().optional(),
  demoDurationInFrames: z.number().optional(),
});

export type WordTiming = z.infer<typeof wordTimingSchema>;
export type CaptionChunk = z.infer<typeof captionChunkSchema>;
export type ServiceBProps = z.infer<typeof serviceBSchema>;
export type ServiceBTimeline = z.infer<typeof serviceBTimelineSchema>;
export type ServiceAProps = z.infer<typeof serviceASchema>;
export type ServiceAStepsProps = z.infer<typeof serviceAStepsSchema>;
export type StepSegment = z.infer<typeof stepSegmentSchema>;
export type TextSafeArea = z.infer<typeof textSafeAreaSchema>;

/** Locked output format: vertical 9:16, 1080x1920, 30fps. */
export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

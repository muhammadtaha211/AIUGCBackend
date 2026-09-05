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
 * arithmetic of its own. The three effect fields are core's constants
 * (CROSSFADE_FRAMES, PUNCH_IN_SCALE, PUNCH_IN_MS) carried along so the
 * numbers are written in exactly one place.
 */
export const serviceBTimelineSchema = z.object({
  holdMs: z.number().nonnegative(),
  revealAbsMs: z.number().nonnegative(),
  lipsyncStartFromMs: z.number().nonnegative(),
  captionOffsetMs: z.number().nonnegative(),
  totalMs: z.number().positive(),
  crossfadeFrames: z.number().int().nonnegative(),
  punchInScale: z.number().positive(),
  punchInMs: z.number().nonnegative(),
});

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
   * the reveal. The three come together or not at all — core validates that.
   */
  openerSrc: z.string().optional(),
  hookText: z.string().optional(),
  hookTextSafeArea: textSafeAreaSchema.optional(),
  timeline: serviceBTimelineSchema,
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

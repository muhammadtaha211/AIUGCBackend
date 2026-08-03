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

export const serviceBSchema = z.object({
  talkingHeadSrc: z.string(),
  /**
   * The approved VO — the composition's only audio track and the clock the
   * whole render runs on. Never optional: Service B always has approved audio,
   * so a missing one is a bug that must fail the render, not fall back to the
   * talking head's own (re-encoded) audio.
   */
  voiceoverSrc: z.string(),
  /** B-roll cutaways. Empty is normal and must render cleanly. */
  brollSrcs: z.array(z.string()),
  captions: z.array(captionChunkSchema),
  watermark: z.boolean(),
  /**
   * Filled in by `calculateServiceBMetadata` (which probes the clip), not by
   * the caller — it marks where the talking head runs out and the final frame
   * has to be held. Absent means "no hold", which is what Studio shows before
   * metadata resolves.
   */
  talkingHeadDurationInFrames: z.number().optional(),
});

/** {x, y, w, h} in 1080x1920 space where the burned hook line may be placed. */
export const textSafeAreaSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
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

export type WordTiming = z.infer<typeof wordTimingSchema>;
export type CaptionChunk = z.infer<typeof captionChunkSchema>;
export type ServiceBProps = z.infer<typeof serviceBSchema>;
export type ServiceAProps = z.infer<typeof serviceASchema>;
export type TextSafeArea = z.infer<typeof textSafeAreaSchema>;

/** Locked output format: vertical 9:16, 1080x1920, 30fps. */
export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

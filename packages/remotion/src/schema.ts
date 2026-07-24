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
  /** B-roll cutaways. Empty is normal and must render cleanly. */
  brollSrcs: z.array(z.string()),
  captions: z.array(captionChunkSchema),
  watermark: z.boolean(),
});

export type WordTiming = z.infer<typeof wordTimingSchema>;
export type CaptionChunk = z.infer<typeof captionChunkSchema>;
export type ServiceBProps = z.infer<typeof serviceBSchema>;

/** Locked output format: vertical 9:16, 1080x1920, 30fps. */
export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

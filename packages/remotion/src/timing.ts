import { FPS, type CaptionChunk } from "./schema";

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
 * Service B length. The approved audio is the source of truth — it is what the
 * customer signed off on and what the captions are timed against — so the ad is
 * exactly as long as the VO: a longer talking head is trimmed by the
 * composition duration, a shorter one holds its final frame (see ServiceB) for
 * the remaining frames instead of cutting to black.
 */
export function serviceBDurations(
  voiceoverSeconds: number,
  talkingHeadSeconds: number,
): { durationInFrames: number; talkingHeadDurationInFrames: number } {
  return {
    durationInFrames: Math.max(1, Math.round(voiceoverSeconds * FPS)),
    talkingHeadDurationInFrames: Math.max(1, Math.round(talkingHeadSeconds * FPS)),
  };
}

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

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

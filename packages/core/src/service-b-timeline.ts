import { readTimeMs } from "./plan-format";

/**
 * The Service B layout in milliseconds — opener clip, hook text, lead-in,
 * lip-sync, VO and captions on one absolute axis. Pure and client-safe (the
 * "@aiugc/core/service-b-timeline" subpath; plan-format is the precedent):
 * the render pipeline computes it once and the composition converts the
 * numbers to frames, nothing more. The wizard's preview can show the same
 * numbers without a render.
 *
 * The constants were CHOSEN in chat (2026-09-05), none measured — see
 * docs/vault/facts/service-b-timeline-constants.md. The shape changed the
 * same day, after the first real render (decision 0019): the opener plays
 * from its first frame — nothing is ever frozen — and the hook text lives its
 * read time from frame 0, never leaving before the reveal.
 */

/** Silence between the reveal cut and the first spoken word. */
export const GAP_MS = 250;
/** How long the hook text stays on screen from frame 0 — readTimeMs of the text, clamped. */
export const HOOK_TEXT_MIN_MS = 1200;
export const HOOK_TEXT_MAX_MS = 2500;
// The 5-frame dissolve, the 1.06 punch-in and the frozen first-frame hold
// that used to sit here were deleted 2026-09-05 after the first real opener
// render: the dissolve ghosted the moving hand, the zoom read as a jump cut,
// and 2.4s of a frozen human read as a stalled video. The reveal is a hard
// cut, as decision 0017 says; the text's lifetime is decision 0019.

export interface ServiceBTimelineInput {
  hasOpener: boolean;
  /** Opener only: the clip's own length, from the bank row. */
  openerDurationMs?: number;
  /** Opener only: where the hard cut lands, in clip time (opener_clips.reveal_at_ms) — the first frame whose pose matches the selfie. */
  revealAtMs?: number;
  /** Opener only: the FINAL on-screen line — its read time sets how long it stays. */
  hookText?: string;
  /** The silence handleLipsync prepended before submit (params.leadInMs); 0 for a pre-lead-in render. */
  leadInMs: number;
  /** The stored HeyGen clip's probed length — it generated to the PADDED audio. */
  lipsyncDurationMs: number;
  /** The approved VO's length — the customer signed off on it, so the ad never ends before it does. */
  voDurationMs: number;
}

export interface ServiceBTimeline {
  /**
   * Opener: how long the hook text is on screen from frame 0 — its read
   * time, never shorter than the reveal, so it never leaves while the palm
   * still covers the face. 0 without an opener.
   */
  hookTextMs: number;
  /** Absolute time of the hard cut into the talking head — the opener plays from 0, so this is its reveal_at_ms. 0 without an opener. */
  revealAbsMs: number;
  /** Where the lip-sync clip starts playing from, in clip time: just before its speech onset. */
  lipsyncStartFromMs: number;
  /**
   * Absolute time of the VO's first sample — and the offset added to every
   * caption chunk, which is timed against the UNPADDED audio. Speech onset in
   * the video and the mp3's t=0 coincide here by construction.
   */
  captionOffsetMs: number;
  totalMs: number;
}

export function serviceBTimeline(input: ServiceBTimelineInput): ServiceBTimeline {
  // Clip time at which the layer starts: GAP_MS before speech onset, so the
  // reveal lands on a frame that is still the idle still. A lead-in shorter
  // than the gap (a pre-lead-in render at 0) starts the clip at 0 instead.
  const lipsyncStartFromMs = Math.max(0, input.leadInMs - GAP_MS);

  let hookTextMs = 0;
  let revealAbsMs = 0;
  if (input.hasOpener) {
    if (
      input.openerDurationMs === undefined ||
      input.revealAtMs === undefined ||
      input.hookText === undefined
    ) {
      throw new Error("an opener needs openerDurationMs, revealAtMs and hookText");
    }
    if (input.revealAtMs < 0 || input.revealAtMs > input.openerDurationMs) {
      throw new Error(
        `revealAtMs ${input.revealAtMs} is outside the opener (0..${input.openerDurationMs})`,
      );
    }
    revealAbsMs = input.revealAtMs;
    hookTextMs = Math.max(
      Math.min(Math.max(readTimeMs(input.hookText), HOOK_TEXT_MIN_MS), HOOK_TEXT_MAX_MS),
      input.revealAtMs,
    );
  }

  // Speech onset sits leadInMs into the clip, which the layer shows
  // (leadInMs - lipsyncStartFromMs) after the reveal — exactly GAP_MS whenever
  // the lead-in is at least the gap. The VO starts on that frame.
  const captionOffsetMs = revealAbsMs + (input.leadInMs - lipsyncStartFromMs);

  // The later of the two ends: the clip's (HeyGen generated to the padded
  // audio) and the VO's (the approved audio must never be cut off — the
  // composition holds the clip's last frame under any VO tail).
  const lipsyncEndMs = revealAbsMs + Math.max(0, input.lipsyncDurationMs - lipsyncStartFromMs);
  const voEndMs = captionOffsetMs + Math.max(0, input.voDurationMs);
  const totalMs = Math.max(1, lipsyncEndMs, voEndMs);

  // hookTextMs first: the DRY_RUN props echo pins this object's key order.
  return { hookTextMs, revealAbsMs, lipsyncStartFromMs, captionOffsetMs, totalMs };
}

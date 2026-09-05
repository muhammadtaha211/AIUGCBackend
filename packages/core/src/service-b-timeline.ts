import { readTimeMs } from "./plan-format";

/**
 * The Service B layout in milliseconds — opener clip, hook text, lead-in,
 * lip-sync, VO and captions on one absolute axis. Pure and client-safe (the
 * "@aiugc/core/service-b-timeline" subpath; plan-format is the precedent):
 * the render pipeline computes it once and the composition converts the
 * numbers to frames, nothing more. The wizard's preview can show the same
 * numbers without a render.
 *
 * Every constant here was CHOSEN in chat (2026-09-05), none measured — see
 * docs/vault/facts/service-b-timeline-constants.md.
 */

/** Silence between the reveal cut and the first spoken word. */
export const GAP_MS = 250;
/** How long the opener's first frame holds under the hook text — readTimeMs of the text, clamped. */
export const HOLD_MIN_MS = 1200;
export const HOLD_MAX_MS = 2500;
/** The opener→talking-head dissolve, centred on the reveal. */
export const CROSSFADE_FRAMES = 5;
/** Punch-in on the talking head from the reveal, held after. */
export const PUNCH_IN_SCALE = 1.06;
export const PUNCH_IN_MS = 300;

export interface ServiceBTimelineInput {
  hasOpener: boolean;
  /** Opener only: the clip's own length, from the bank row. */
  openerDurationMs?: number;
  /** Opener only: first frame the face is clear, in clip time (opener_clips.reveal_at_ms). */
  revealAtMs?: number;
  /** Opener only: the FINAL on-screen line — its read time sets the hold. */
  hookText?: string;
  /** The silence handleLipsync prepended before submit (params.leadInMs); 0 for a pre-lead-in render. */
  leadInMs: number;
  /** The stored HeyGen clip's probed length — it generated to the PADDED audio. */
  lipsyncDurationMs: number;
  /** The approved VO's length — the customer signed off on it, so the ad never ends before it does. */
  voDurationMs: number;
}

export interface ServiceBTimeline {
  /** Opener: how long its first frame is frozen under the hook text. 0 without one. */
  holdMs: number;
  /** Absolute time of the hard cut into the talking head. 0 without an opener. */
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

  let holdMs = 0;
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
    holdMs = Math.min(Math.max(readTimeMs(input.hookText), HOLD_MIN_MS), HOLD_MAX_MS);
    revealAbsMs = holdMs + input.revealAtMs;
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

  return { holdMs, revealAbsMs, lipsyncStartFromMs, captionOffsetMs, totalMs };
}

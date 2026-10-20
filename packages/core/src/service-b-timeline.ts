import type { CaptionChunk } from "./captions";
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

/** Silence between the reveal cut and the first spoken word — and, since the
 *  opener was retired, simply how much still head opens the ad before speech. */
export const GAP_MS = 250;
/**
 * The hook text's read time, clamped. On the RETIRED opener path this was the
 * text's whole life. On the hook-animation path it is only a floor, and only
 * when the text is not spoken: the life there ends at a caption-chunk
 * boundary (`hookHandoffMs`), never mid-line.
 */
export const HOOK_TEXT_MIN_MS = 1200;
export const HOOK_TEXT_MAX_MS = 2500;

/**
 * When the centred hook line leaves and the captions take over, as an
 * absolute composition time. The founder's rule (2026-09-06, vault 0023):
 * the line stays until speech has passed its LAST WORD, and the captions then
 * start from the NEXT caption line — so no word of the hook ever also appears
 * at the bottom, and no caption line is ever joined half-way through.
 *
 * The hook text is usually the script's opening line compressed for the
 * screen, so its words are matched against the spoken words in order from the
 * start. Three ordinary things break that match — the customer edits the line
 * (the wizard invites it), the script call wrote a line that is not a
 * transcript of its own opening, or the pronunciation map respelled a word —
 * so a partial match or no match is the NORMAL fallback, not an error: unless
 * the line is spoken in FULL, it also stays for its clamped read time and
 * hands off at the first chunk boundary at or after whichever comes later.
 * Never throws: this runs inside render_video, after the GPU has been paid.
 *
 * Inherent to the rule: any word spoken between the hook's last word and the
 * next chunk boundary is never captioned. That is the founder's rule working,
 * not a defect — the alternative is his "same line in the centre and at the
 * bottom".
 */
export function hookHandoffMs(
  hookText: string,
  captions: CaptionChunk[],
  captionOffsetMs: number,
): number | undefined {
  const norm = (value: string) => value.replace(/[^\p{L}\p{N}]/gu, "");
  const spoken = captions.flatMap((chunk, index) =>
    (chunk.words ?? []).map((word) => ({ word: word.word, chunk: index })),
  );
  // No word timings at all (an even-spaced caption set, or a malformed row):
  // the caller falls back to no hook text rather than crashing the render.
  if (spoken.length === 0) return undefined;

  const hookWords = hookText.split(/\s+/).map(norm).filter(Boolean);
  let matched = 0;
  while (
    matched < hookWords.length &&
    matched < spoken.length &&
    norm(spoken[matched]!.word) === hookWords[matched]
  ) {
    matched++;
  }

  // The chunk after the last word that was actually spoken. 0 for no match.
  const spokenIndex = matched > 0 ? spoken[matched - 1]!.chunk + 1 : 0;
  // The first chunk starting at or after the line's clamped read time. The
  // threshold is in VO time and the line has already been up for
  // captionOffsetMs by then, so the offset comes off the threshold.
  const readMs = Math.min(Math.max(readTimeMs(hookText), HOOK_TEXT_MIN_MS), HOOK_TEXT_MAX_MS);
  const readFrom = captions.findIndex((chunk) => chunk.startMs >= readMs - captionOffsetMs);
  const readIndex = readFrom === -1 ? captions.length : readFrom;
  // A FULLY spoken line needs no read-time floor: hearing it is the reading,
  // and the founder's rule is that it leaves when speech passes its last word.
  // Anything less — a paraphrase, an edited tail, a respelled word — is partly
  // unread, and a PREFIX match must not skip the floor the no-match case gets.
  // It matters: Hebrew UGC scripts open from a tiny set of words (אני, אז, זה),
  // so a one-word coincidence is ordinary, and without this a six-word line
  // would leave after ~1.4s — the "hands off at chunk 1 regardless" behaviour
  // that was rejected when this rule was written.
  const fullyMatched = matched > 0 && matched === hookWords.length;
  const index = fullyMatched ? spokenIndex : Math.max(spokenIndex, readIndex);

  // Past the last chunk (the hook covered the whole script, or its read time
  // outlasts the speech): the line holds to the end of speech and the ad
  // simply has no captions.
  const chunk = captions[index];
  return captionOffsetMs + (chunk ? chunk.startMs : captions[captions.length - 1]!.endMs);
}
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
  /**
   * The FINAL on-screen line. With an opener its read time sets how long it
   * stays; with a hook animation (vault 0023) it stays until the caption
   * handoff below. Absent = no burned line, which is what "no effect" means.
   */
  hookText?: string;
  /**
   * The approved VO's stored caption chunks. Needed only to place the hook
   * animation's caption handoff; absent (or empty) leaves the line unburned
   * rather than guessing at a lifetime.
   */
  captions?: CaptionChunk[];
  /** The silence handleLipsync prepended before submit (params.leadInMs); 0 for a pre-lead-in render. */
  leadInMs: number;
  /** The stored HeyGen clip's probed length — it generated to the PADDED audio. */
  lipsyncDurationMs: number;
  /** The approved VO's length — the customer signed off on it, so the ad never ends before it does. */
  voDurationMs: number;
}

export interface ServiceBTimeline {
  /**
   * How long the hook text is on screen from frame 0, and therefore also when
   * the captions start — the composition burns the line for this long and
   * shows no caption before it (ServiceB.tsx). Opener: the text's read time,
   * never shorter than the reveal. Hook animation: the caption handoff
   * (`hookHandoffMs`). 0 = no burned line at all.
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

  // A hook animation (no opener, so no reveal): the line burns from frame 0
  // and leaves at the caption handoff, which is measured from speech onset —
  // hence after captionOffsetMs. With no captions to hand off to, no line.
  if (!input.hasOpener && input.hookText !== undefined && input.captions !== undefined) {
    hookTextMs = hookHandoffMs(input.hookText, input.captions, captionOffsetMs) ?? 0;
  }

  // The later of the two ends: the clip's (HeyGen generated to the padded
  // audio) and the VO's (the approved audio must never be cut off — the
  // composition holds the clip's last frame under any VO tail).
  const lipsyncEndMs = revealAbsMs + Math.max(0, input.lipsyncDurationMs - lipsyncStartFromMs);
  const voEndMs = captionOffsetMs + Math.max(0, input.voDurationMs);
  const totalMs = Math.max(1, lipsyncEndMs, voEndMs);

  // hookTextMs first: the DRY_RUN props echo pins this object's key order.
  return { hookTextMs, revealAbsMs, lipsyncStartFromMs, captionOffsetMs, totalMs };
}

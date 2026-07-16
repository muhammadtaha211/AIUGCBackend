import type { WordTiming } from "../captions";

/**
 * Forced-alignment fallback (locked design): when ElevenLabs V3 returns no
 * character alignment, align the KNOWN script text against the generated audio
 * with WhisperX / stable-ts — near-perfect because the text is known, tiny
 * files, CPU is fine.
 *
 * Implementation shells out to a small Python CLI (whisperx) — wired up when
 * the worker box is provisioned (it needs python + ffmpeg). The interface is
 * fixed here so the TTS chain does not change when it lands.
 */
export async function forcedAlign(_audioPath: string, _scriptText: string): Promise<WordTiming[]> {
  throw new Error(
    "WhisperX forced alignment is not wired up yet (needs python on the worker box). " +
      "ElevenLabs alignment covered this render path so far — see docs/04-integrations.md §Alignment",
  );
}

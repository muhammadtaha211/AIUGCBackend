import type { CharAlignment } from "../captions";
import { getEnv } from "../config";
import { PermanentError, TransientError } from "../jobs/errors";

/**
 * Hebrew TTS via ElevenLabs V3 (locked decision). We request the
 * with-timestamps endpoint; official docs don't confirm eleven_v3 supports it,
 * so `charAlignment` is optional — when absent, the caller falls back to
 * WhisperX forced alignment (docs/04-integrations.md).
 */
export const ELEVENLABS_MODEL = "eleven_v3";

export interface TtsResult {
  audio: Buffer;
  format: "mp3";
  charAlignment?: CharAlignment;
}

interface ElevenLabsAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

export async function synthesize(opts: {
  text: string;
  voiceId: string;
  /** v3 accepts 0.0 / 0.5 / 1.0 = creative / natural / robust. Omitted = provider default. */
  stability?: number;
}): Promise<TtsResult> {
  const env = getEnv();
  if (env.DRY_RUN) return dryRunSynthesize(opts.text);
  if (!env.ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY is not set");

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${opts.voiceId}/with-timestamps?output_format=mp3_44100_128`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        text: opts.text,
        model_id: ELEVENLABS_MODEL,
        ...(opts.stability === undefined ? {} : { voice_settings: { stability: opts.stability } }),
      }),
    });
  } catch (err) {
    throw new TransientError(`elevenlabs request failed: ${String(err)}`);
  }

  if (!response.ok) {
    const body = await response.text();
    const message = `elevenlabs ${response.status}: ${body.slice(0, 500)}`;
    if (response.status >= 500 || response.status === 429) throw new TransientError(message);
    throw new PermanentError(message);
  }

  const json = (await response.json()) as {
    audio_base64: string;
    alignment?: ElevenLabsAlignment;
    normalized_alignment?: ElevenLabsAlignment;
  };

  const alignment = json.normalized_alignment ?? json.alignment;
  return {
    audio: Buffer.from(json.audio_base64, "base64"),
    format: "mp3",
    charAlignment: alignment
      ? {
          characters: alignment.characters,
          startTimesMs: alignment.character_start_times_seconds.map((s) => Math.round(s * 1000)),
          endTimesMs: alignment.character_end_times_seconds.map((s) => Math.round(s * 1000)),
        }
      : undefined,
  };
}

/**
 * DRY_RUN: fabricate audio + a uniform alignment at ~2.2 words/second so the
 * whole downstream chain (length fit, word grouping, karaoke chunking) runs
 * for real without an API key.
 */
function dryRunSynthesize(text: string): TtsResult {
  const chars = [...text];
  const words = text.split(/\s+/).filter(Boolean).length;
  const durationMs = Math.round((words / 2.2) * 1000);
  const perChar = durationMs / chars.length;
  return {
    audio: Buffer.from(`DRY_RUN fake mp3 for: ${text.slice(0, 60)}`),
    format: "mp3",
    charAlignment: {
      characters: chars,
      startTimesMs: chars.map((_, i) => Math.round(i * perChar)),
      endTimesMs: chars.map((_, i) => Math.round((i + 1) * perChar)),
    },
  };
}

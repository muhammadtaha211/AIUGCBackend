import { readFileSync } from "node:fs";
import path from "node:path";
import type { CharAlignment } from "../captions";
import { getEnv } from "../config";
import { PermanentError, TransientError } from "../jobs/errors";
import { RECORDING_FAILED } from "../own-voice";

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

// --- speech to text (Scribe) — the customer's own voice, decision 0118 -------

export const SCRIBE_MODEL = "scribe_v2";

/**
 * ~agorot per hour of audio transcribed: Scribe v2 (batch) lists at $0.22 an
 * hour on every plan past its included hours (elevenlabs.io/pricing/api,
 * 2026-10-19), at the founder-confirmed USD/ILS 3.00 that TTS_COST is priced
 * at (pipelines/tts.ts). The usage row is an estimate, like every other.
 */
export const STT_COST_AGOROT_PER_HOUR = 66;

export interface SttWord {
  text: string;
  startMs: number;
  endMs: number;
}

export interface SttResult {
  /** Spoken words only (no spacing, no audio events), in order, in ms. */
  words: SttWord[];
  /** What ElevenLabs says it transcribed — the usage row's quantity. */
  audioDurationSecs: number;
}

export interface ScribeWord {
  text: string;
  type: "word" | "spacing" | "audio_event";
  start: number | null;
  end: number | null;
}

/**
 * Transcribe one recording with word-level times. Fillers stay
 * (no_verbatim=false): the captions are timed to what is heard, and the
 * customer drops a filler on the transcript step if they want it gone. Audio
 * events are not tagged, so nothing but words comes back. Never logs the text.
 */
export async function transcribe(opts: {
  /** Local audio file — the normalised recording the stored file is cut from. */
  file: string;
  /** Its length; only the DRY_RUN stand-in reads it. */
  durationMs: number;
}): Promise<SttResult> {
  const env = getEnv();
  if (env.DRY_RUN) return dryRunTranscribe(opts.durationMs);
  if (!env.ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY is not set");

  const form = new FormData();
  form.append("model_id", SCRIBE_MODEL);
  form.append("language_code", "heb");
  form.append("timestamps_granularity", "word");
  form.append("tag_audio_events", "false");
  form.append("no_verbatim", "false");
  form.append("diarize", "false");
  form.append(
    "file",
    new Blob([readFileSync(opts.file)], { type: "audio/wav" }),
    path.basename(opts.file),
  );

  let response: Response;
  try {
    response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": env.ELEVENLABS_API_KEY },
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    throw new TransientError(`elevenlabs stt request failed: ${String(err)}`);
  }

  if (!response.ok) {
    const body = await response.text();
    // 401 carries detail.status — quota_exceeded or missing_permissions (the
    // key has no Speech to Text access). Either is the founder's dashboard,
    // never the customer's problem, so the customer reads the generic line.
    let detail = "";
    try {
      const parsed = JSON.parse(body) as { detail?: { status?: string } | string };
      detail = typeof parsed.detail === "string" ? parsed.detail : (parsed.detail?.status ?? "");
    } catch {
      detail = body.slice(0, 200);
    }
    const message = `elevenlabs stt ${response.status}: ${detail}`;
    if (response.status >= 500 || response.status === 429) throw new TransientError(message);
    throw new PermanentError(message, { customerMessage: RECORDING_FAILED });
  }

  const json = (await response.json()) as { words?: ScribeWord[]; audio_duration_secs?: number };
  return {
    words: scribeWords(json.words ?? []),
    audioDurationSecs: json.audio_duration_secs ?? opts.durationMs / 1000,
  };
}

/** Words only, in ms. A word Scribe left untimed borrows its neighbours'. */
export function scribeWords(raw: readonly ScribeWord[]): SttWord[] {
  const words = raw.filter((w) => w.type === "word");
  const out: SttWord[] = [];
  words.forEach((w, k) => {
    const start = w.start !== null ? Math.round(w.start * 1000) : (out[out.length - 1]?.endMs ?? 0);
    const next = words.slice(k + 1).find((n) => n.start !== null)?.start;
    const end =
      w.end !== null ? Math.round(w.end * 1000) : next != null ? Math.round(next * 1000) : start;
    out.push({ text: w.text, startMs: start, endMs: Math.max(start, end) });
  });
  return out;
}

const DRY_RUN_WORDS = [
  "היי,",
  "אני",
  "רוצה",
  "לספר",
  "לכם",
  "על",
  "אממ",
  "המקום",
  "שלנו.",
  "בואו",
  "לבקר",
  "אותנו",
  "כבר",
  "השבוע!",
];

/**
 * DRY_RUN: a fixed Hebrew sentence spread at ~2.2 words/second from 100 ms to
 * 100 ms before the end, with a 1.2 s pause after the fourth word and a filler
 * (אממ) at the seventh — so the cut, the chunker and the transcript step all
 * meet a pause and a filler without an API key.
 */
function dryRunTranscribe(durationMs: number): SttResult {
  const step = 1000 / 2.2;
  const pauseMs = 1200;
  const from = 100;
  const span = Math.max(step, durationMs - 200);
  const n = Math.max(1, Math.floor((span - (span > 4 * step + pauseMs ? pauseMs : 0)) / step));
  const words: SttWord[] = [];
  for (let i = 0; i < n; i++) {
    const startMs = Math.round(
      from + i * step + (i >= 4 && span > 4 * step + pauseMs ? pauseMs : 0),
    );
    words.push({
      text: DRY_RUN_WORDS[i % DRY_RUN_WORDS.length]!,
      startMs,
      endMs: Math.round(startMs + step * 0.85),
    });
  }
  return { words, audioDurationSecs: durationMs / 1000 };
}

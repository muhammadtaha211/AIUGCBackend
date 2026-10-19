/**
 * The customer's own voice (Service B, decision 0118): the caps on a recording,
 * the files it may come in, and the rules for correcting its transcript. Pure —
 * bundled into the wizard via the "@aiugc/core/own-voice" subpath (hook-text is
 * the precedent), so the browser and the server refuse the same things in the
 * same Hebrew. It must never import server code.
 */
import type { WordTiming } from "./captions";
import { unburnableChar } from "./hook-text";

/** Whole seconds, both ends inclusive (decision 0118, item 10). */
export const RECORDING_MIN_SECONDS = 3;
export const RECORDING_MAX_SECONDS = 90;
/** An audio file, and a video taken for its audio track only. The video cap is
 *  the lower of 300 MB and the project-level upload limit, which the founder
 *  reported at 300 MB or more (2026-10-19). */
export const RECORDING_MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const RECORDING_MAX_VIDEO_BYTES = 300 * 1024 * 1024;
/** A respelled word is one caption token, not a sentence. */
export const TRANSCRIPT_WORD_MAX_CHARS = 30;

/** A word Scribe heard, timed on the stored (cut) recording. */
export interface HeardWord {
  text: string;
  startMs: number;
  endMs: number;
}

/** One kept word of the approved transcript: the index of the heard word it
 *  stands for, and its text — the heard text, or the customer's respelling. */
export interface KeptWord {
  i: number;
  text: string;
}

export type RecordingType = {
  /** What the browser PUTs with, and what the raw bucket must allow. */
  contentType: string;
  ext: string;
  kind: "audio" | "video";
};

const TYPES: Record<string, RecordingType> = {
  mp3: { contentType: "audio/mpeg", ext: "mp3", kind: "audio" },
  m4a: { contentType: "audio/mp4", ext: "m4a", kind: "audio" },
  aac: { contentType: "audio/aac", ext: "aac", kind: "audio" },
  ogg: { contentType: "audio/ogg", ext: "ogg", kind: "audio" },
  wav: { contentType: "audio/wav", ext: "wav", kind: "audio" },
  webm: { contentType: "audio/webm", ext: "webm", kind: "audio" },
  mp4: { contentType: "video/mp4", ext: "mp4", kind: "video" },
  mov: { contentType: "video/quicktime", ext: "mov", kind: "video" },
};

/** File extension -> canonical type. A WhatsApp voice note is `.opus` in an Ogg
 *  container; `.oga` and `.weba` are the audio-only spellings. */
const BY_EXTENSION: Record<string, string> = {
  mp3: "mp3",
  m4a: "m4a",
  aac: "aac",
  ogg: "ogg",
  oga: "ogg",
  opus: "ogg",
  wav: "wav",
  webm: "webm",
  weba: "webm",
  mp4: "mp4",
  mov: "mov",
};

/** Browser-reported MIME (parameters stripped) -> canonical type. Chrome and
 *  Firefox report an audio-only `.webm` as video/webm; `.m4a` often arrives as
 *  audio/x-m4a. */
const BY_MIME: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/aac": "aac",
  "audio/x-aac": "aac",
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "application/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/vnd.wave": "wav",
  "audio/webm": "webm",
  "video/webm": "webm",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

/** Every content type an upload can be PUT with — the raw bucket's audio and
 *  video allow-list must hold all of them. */
export const RECORDING_CONTENT_TYPES = [...new Set(Object.values(TYPES).map((t) => t.contentType))];

/** The file input's accept list. iOS greys out files by type, so the
 *  extensions are spelled out next to the MIME families. */
export const RECORDING_ACCEPT =
  ".mp3,.m4a,.aac,.ogg,.oga,.opus,.wav,.webm,.weba,.mp4,.mov,audio/*,video/mp4,video/quicktime";

/**
 * What a picked or recorded file is. The browser's type wins when it is one we
 * know; an empty, generic or unknown one (a `.opus` from WhatsApp often has
 * none, a share-sheet file can be application/octet-stream) falls back to the
 * extension.
 */
export function recordingType(file: { type: string; name?: string }): RecordingType | undefined {
  const mime = file.type.split(";")[0]!.trim().toLowerCase();
  const byMime = BY_MIME[mime];
  if (byMime) return TYPES[byMime];
  const ext = /\.([a-z0-9]+)$/i.exec(file.name ?? "")?.[1]?.toLowerCase();
  const byExt = ext ? BY_EXTENSION[ext] : undefined;
  return byExt ? TYPES[byExt] : undefined;
}

/** The generic failure — every refusal the customer cannot act on reads this. */
export const RECORDING_FAILED = "לא הצלחנו לעבד את ההקלטה. נסו שוב או העלו קובץ אחר.";
export const RECORDING_NO_SPEECH = "לא שמענו דיבור בהקלטה. נסו להקליט שוב.";
/** The shared daily preview pool, reached from a recording (decision 0118). */
export const RECORDING_DAILY_CAP = "הגעתם למכסת ההקלטות היומית. נסו שוב מחר.";

export const RECORDING_UNSUPPORTED =
  "הקובץ הזה לא נתמך. אפשר להעלות MP3, M4A, AAC, OGG, OPUS, WAV, WEBM, MP4 או MOV.";

const MB = 1024 * 1024;

/** Why this file cannot be uploaded as a recording, or undefined. */
export function recordingFileError(file: {
  type: string;
  size: number;
  name?: string;
}): string | undefined {
  const type = recordingType(file);
  if (!type || file.size <= 0) return RECORDING_UNSUPPORTED;
  const mb = Math.ceil(file.size / MB);
  if (type.kind === "audio" && file.size > RECORDING_MAX_AUDIO_BYTES) {
    return `הקובץ גדול מדי (${mb}MB). המקסימום לקובץ שמע הוא ${RECORDING_MAX_AUDIO_BYTES / MB}MB.`;
  }
  if (type.kind === "video" && file.size > RECORDING_MAX_VIDEO_BYTES) {
    return `הסרטון גדול מדי (${mb}MB). המקסימום לסרטון הוא ${RECORDING_MAX_VIDEO_BYTES / MB}MB.`;
  }
  return undefined;
}

/** "N שניות", with the singular and the under-a-second forms Hebrew needs. */
function secondsPhrase(seconds: number): string {
  if (seconds <= 0) return "פחות משנייה";
  if (seconds === 1) return "שנייה אחת";
  return `${seconds} שניות`;
}

/** Whole seconds, as the caps are judged: 2.9 s is 2, 90.9 s is 90. */
export function wholeSeconds(ms: number): number {
  return Math.floor(ms / 1000);
}

/** Why a recording of this length is refused, or undefined. Shows the length. */
export function recordingLengthError(ms: number): string | undefined {
  const seconds = wholeSeconds(ms);
  if (seconds >= RECORDING_MIN_SECONDS && seconds <= RECORDING_MAX_SECONDS) return undefined;
  return `ההקלטה באורך ${secondsPhrase(seconds)}. אפשר מ־${RECORDING_MIN_SECONDS} עד ${RECORDING_MAX_SECONDS} שניות.`;
}

/** The cut recording — from the first word to the last — is under the floor. */
export function spokenLengthError(ms: number): string | undefined {
  const seconds = wholeSeconds(ms);
  if (seconds >= RECORDING_MIN_SECONDS) return undefined;
  return `אורך הדיבור בהקלטה הוא ${secondsPhrase(seconds)}. צריך לפחות ${RECORDING_MIN_SECONDS} שניות.`;
}

/**
 * A heard token with every character a caption cannot burn removed (an emoji,
 * a control or zero-width character, niqqud). Run once on Scribe's own words in
 * the job, so an untouched word can never make approval impossible.
 */
export function cleanHeardText(text: string): string {
  return [...text].filter((ch) => !/\s/.test(ch) && unburnableChar(ch) === undefined).join("");
}

export const TRANSCRIPT_ONE_WORD = "מילה אחת, בלי רווחים.";
export const TRANSCRIPT_BAD_CHAR = "אי אפשר להשתמש בסימן הזה.";
export const TRANSCRIPT_EMPTY = "צריך להשאיר לפחות מילה אחת.";
export const TRANSCRIPT_TOO_LONG = "המילה ארוכה מדי.";
export const TRANSCRIPT_MISMATCH = "התיקון לא תואם להקלטה. רעננו את הדף ונסו שוב.";
/** Past this many approvals of one recording, record again (an abuse bound). */
export const RECORDING_MAX_APPROVALS = 10;
export const TRANSCRIPT_TOO_MANY_APPROVALS = "ההקלטה הזו אושרה כבר הרבה פעמים. אפשר להקליט מחדש.";

/** Why one respelled token cannot stand in the captions, or undefined. */
export function transcriptWordError(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return TRANSCRIPT_ONE_WORD;
  if ([...trimmed].length > TRANSCRIPT_WORD_MAX_CHARS) return TRANSCRIPT_TOO_LONG;
  if (unburnableChar(trimmed) !== undefined) return TRANSCRIPT_BAD_CHAR;
  return undefined;
}

/**
 * The approved transcript from what was heard and what the customer kept.
 * Respell or drop, never add (decision 0118, item 6): every kept word names a
 * heard word by index, in order, at most once, and keeps that word's ORIGINAL
 * times — so a dropped word leaves its time as a gap the audio still plays,
 * and nothing the customer types can shift a caption off the voice.
 */
export function applyTranscriptCorrections(
  heard: readonly HeardWord[],
  kept: readonly KeptWord[],
): { ok: true; words: WordTiming[]; text: string } | { ok: false; error: string } {
  if (kept.length === 0) return { ok: false, error: TRANSCRIPT_EMPTY };
  const words: WordTiming[] = [];
  let previous = -1;
  for (const k of kept) {
    if (!Number.isInteger(k.i) || k.i <= previous || k.i >= heard.length) {
      return { ok: false, error: TRANSCRIPT_MISMATCH };
    }
    previous = k.i;
    const source = heard[k.i]!;
    const text = k.text.trim();
    // Only a word the customer changed is checked: an untouched one was
    // cleaned in the job, and a long one (a spoken web address) must never
    // make approval impossible.
    if (text !== source.text) {
      const problem = transcriptWordError(k.text);
      if (problem) return { ok: false, error: problem };
    }
    words.push({ word: text, startMs: source.startMs, endMs: source.endMs });
  }
  return { ok: true, words, text: words.map((w) => w.word).join(" ") };
}

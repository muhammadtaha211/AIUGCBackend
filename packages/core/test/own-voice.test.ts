import { describe, expect, it } from "vitest";
import {
  applyTranscriptCorrections,
  cleanHeardText,
  RECORDING_CONTENT_TYPES,
  RECORDING_MAX_AUDIO_BYTES,
  RECORDING_MAX_VIDEO_BYTES,
  RECORDING_UNSUPPORTED,
  recordingFileError,
  recordingLengthError,
  recordingType,
  spokenLengthError,
  TRANSCRIPT_BAD_CHAR,
  TRANSCRIPT_EMPTY,
  TRANSCRIPT_MISMATCH,
  TRANSCRIPT_ONE_WORD,
  TRANSCRIPT_TOO_LONG,
  type HeardWord,
} from "../src/own-voice";

/**
 * The own-voice rules (decision 0118): what a recording may be, how long, and
 * how its transcript may be corrected — respell or drop, never add.
 */

const heard: HeardWord[] = [
  { text: "שלום", startMs: 100, endMs: 400 },
  { text: "אממ", startMs: 500, endMs: 700 },
  { text: "קוראים", startMs: 1900, endMs: 2300 },
  { text: "לי", startMs: 2300, endMs: 2450 },
  { text: "דנה.", startMs: 2450, endMs: 2900 },
];

describe("recordingType", () => {
  it("maps what browsers, recorders and phones report to one canonical type", () => {
    expect(recordingType({ type: "audio/webm;codecs=opus" })?.contentType).toBe("audio/webm");
    expect(recordingType({ type: "audio/mp4" })).toEqual({
      contentType: "audio/mp4",
      ext: "m4a",
      kind: "audio",
    });
    expect(recordingType({ type: "audio/x-m4a", name: "memo.m4a" })?.ext).toBe("m4a");
    // Chrome and Firefox report an audio-only .webm as video/webm.
    expect(recordingType({ type: "video/webm", name: "a.webm" })?.kind).toBe("audio");
    expect(recordingType({ type: "video/quicktime" })?.kind).toBe("video");
  });

  it("falls back to the extension when the type is empty or generic (a WhatsApp .opus)", () => {
    expect(recordingType({ type: "", name: "PTT-20261019-WA0003.opus" })).toEqual({
      contentType: "audio/ogg",
      ext: "ogg",
      kind: "audio",
    });
    expect(recordingType({ type: "application/octet-stream", name: "note.OGG" })?.ext).toBe("ogg");
    expect(recordingType({ type: "", name: "x.wav" })?.contentType).toBe("audio/wav");
  });

  it("refuses what is not a recording", () => {
    expect(recordingType({ type: "image/png", name: "a.png" })).toBeUndefined();
    expect(recordingType({ type: "", name: "a.txt" })).toBeUndefined();
    expect(recordingType({ type: "" })).toBeUndefined();
  });

  it("names every content type the raw bucket must allow", () => {
    expect([...RECORDING_CONTENT_TYPES].sort()).toEqual(
      [
        "audio/aac",
        "audio/mp4",
        "audio/mpeg",
        "audio/ogg",
        "audio/wav",
        "audio/webm",
        "video/mp4",
        "video/quicktime",
      ].sort(),
    );
  });
});

describe("recordingFileError", () => {
  it("caps audio at 25 MB and a video at 300 MB, showing the size", () => {
    expect(RECORDING_MAX_AUDIO_BYTES).toBe(25 * 1024 * 1024);
    expect(RECORDING_MAX_VIDEO_BYTES).toBe(300 * 1024 * 1024);
    expect(
      recordingFileError({ type: "audio/mpeg", size: RECORDING_MAX_AUDIO_BYTES }),
    ).toBeUndefined();
    expect(recordingFileError({ type: "audio/mpeg", size: RECORDING_MAX_AUDIO_BYTES + 1 })).toBe(
      "הקובץ גדול מדי (26MB). המקסימום לקובץ שמע הוא 25MB.",
    );
    // A 40 MB phone video passes: only its audio is kept.
    expect(recordingFileError({ type: "video/mp4", size: 40 * 1024 * 1024 })).toBeUndefined();
    expect(recordingFileError({ type: "video/mp4", size: RECORDING_MAX_VIDEO_BYTES + 1 })).toBe(
      "הסרטון גדול מדי (301MB). המקסימום לסרטון הוא 300MB.",
    );
  });

  it("refuses an unknown type or an empty file with the formats line", () => {
    expect(recordingFileError({ type: "image/jpeg", size: 10 })).toBe(RECORDING_UNSUPPORTED);
    expect(recordingFileError({ type: "audio/mpeg", size: 0 })).toBe(RECORDING_UNSUPPORTED);
  });
});

describe("recordingLengthError", () => {
  it("judges whole seconds, 3 to 90 inclusive, and shows the length", () => {
    expect(recordingLengthError(3000)).toBeUndefined();
    expect(recordingLengthError(90_999)).toBeUndefined();
    expect(recordingLengthError(2999)).toBe("ההקלטה באורך 2 שניות. אפשר מ־3 עד 90 שניות.");
    expect(recordingLengthError(91_000)).toBe("ההקלטה באורך 91 שניות. אפשר מ־3 עד 90 שניות.");
  });

  it("uses the singular and the under-a-second forms", () => {
    expect(recordingLengthError(1500)).toBe("ההקלטה באורך שנייה אחת. אפשר מ־3 עד 90 שניות.");
    expect(recordingLengthError(400)).toBe("ההקלטה באורך פחות משנייה. אפשר מ־3 עד 90 שניות.");
  });

  it("refuses a cut recording whose speech is under 3 seconds", () => {
    expect(spokenLengthError(3000)).toBeUndefined();
    expect(spokenLengthError(2400)).toBe("אורך הדיבור בהקלטה הוא 2 שניות. צריך לפחות 3 שניות.");
  });
});

describe("cleanHeardText", () => {
  it("keeps Hebrew, Latin, digits and burnable punctuation", () => {
    expect(cleanHeardText("דנה.")).toBe("דנה.");
    expect(cleanHeardText("ב־2026,")).toBe("ב־2026,");
    expect(cleanHeardText("iPhone")).toBe("iPhone");
    expect(cleanHeardText("₪49")).toBe("₪49");
  });

  it("drops what a caption cannot burn: emoji, zero-width, niqqud, whitespace", () => {
    expect(cleanHeardText("שלום😀")).toBe("שלום");
    expect(cleanHeardText("של‍ום")).toBe("שלום");
    expect(cleanHeardText("שָׁלוֹם")).toBe("שלום");
    expect(cleanHeardText(" שלום ")).toBe("שלום");
    expect(cleanHeardText("😀")).toBe("");
  });
});

describe("applyTranscriptCorrections", () => {
  it("keeps every heard word unchanged when nothing was corrected", () => {
    const result = applyTranscriptCorrections(
      heard,
      heard.map((w, i) => ({ i, text: w.text })),
    );
    expect(result).toEqual({
      ok: true,
      text: "שלום אממ קוראים לי דנה.",
      words: heard.map((w) => ({ word: w.text, startMs: w.startMs, endMs: w.endMs })),
    });
  });

  it("respells in place and drops a word, keeping every ORIGINAL time — a drop leaves a gap", () => {
    const result = applyTranscriptCorrections(heard, [
      { i: 0, text: "שלום," },
      // 1 (the filler) dropped
      { i: 2, text: "קוראים" },
      { i: 3, text: "לי" },
      { i: 4, text: "דנה!" },
    ]);
    expect(result).toEqual({
      ok: true,
      text: "שלום, קוראים לי דנה!",
      words: [
        { word: "שלום,", startMs: 100, endMs: 400 },
        { word: "קוראים", startMs: 1900, endMs: 2300 },
        { word: "לי", startMs: 2300, endMs: 2450 },
        { word: "דנה!", startMs: 2450, endMs: 2900 },
      ],
    });
  });

  it("makes adding impossible: a respell with a space, a repeated or out-of-order index, an index past the end", () => {
    expect(applyTranscriptCorrections(heard, [{ i: 0, text: "שלום לכם" }])).toEqual({
      ok: false,
      error: TRANSCRIPT_ONE_WORD,
    });
    expect(
      applyTranscriptCorrections(heard, [
        { i: 0, text: "שלום" },
        { i: 0, text: "שוב" },
      ]),
    ).toEqual({ ok: false, error: TRANSCRIPT_MISMATCH });
    expect(
      applyTranscriptCorrections(heard, [
        { i: 2, text: "קוראים" },
        { i: 1, text: "אממ" },
      ]),
    ).toEqual({ ok: false, error: TRANSCRIPT_MISMATCH });
    expect(applyTranscriptCorrections(heard, [{ i: 5, text: "עוד" }])).toEqual({
      ok: false,
      error: TRANSCRIPT_MISMATCH,
    });
    expect(applyTranscriptCorrections(heard, [{ i: 1.5, text: "עוד" }])).toEqual({
      ok: false,
      error: TRANSCRIPT_MISMATCH,
    });
  });

  it("never re-checks an untouched word: a spoken web address over 30 characters still approves", () => {
    const site = { text: "www.pizzeria-napoli-ramat-gan.co.il", startMs: 0, endMs: 900 };
    expect(applyTranscriptCorrections([site], [{ i: 0, text: site.text }])).toMatchObject({
      ok: true,
      text: site.text,
    });
  });

  it("refuses an empty result, an empty or over-long word, and an unburnable character", () => {
    expect(applyTranscriptCorrections(heard, [])).toEqual({ ok: false, error: TRANSCRIPT_EMPTY });
    expect(applyTranscriptCorrections(heard, [{ i: 0, text: "  " }])).toEqual({
      ok: false,
      error: TRANSCRIPT_ONE_WORD,
    });
    expect(applyTranscriptCorrections(heard, [{ i: 0, text: "א".repeat(31) }])).toEqual({
      ok: false,
      error: TRANSCRIPT_TOO_LONG,
    });
    expect(applyTranscriptCorrections(heard, [{ i: 0, text: "שלום😀" }])).toEqual({
      ok: false,
      error: TRANSCRIPT_BAD_CHAR,
    });
  });
});

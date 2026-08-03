import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { PermanentError } from "../jobs/errors";

/**
 * ffmpeg/ffprobe wrappers: probing, normalization to the single output format
 * (1080x1920 / 30fps / H.264 / AAC), thumbnails, and the atempo length-fit
 * stretch. V2 segment cut/concat will live here too.
 */

export interface ProbeResult {
  width: number;
  height: number;
  durationMs: number;
  hasAudio: boolean;
}

function run(bin: "ffmpeg" | "ffprobe", args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        reject(new Error(`${bin} not found — install ffmpeg and ensure it is on PATH`));
      } else {
        reject(err);
      }
    });
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${bin} exited ${code}: ${stderr.slice(-800)}`));
    });
  });
}

export async function probe(file: string): Promise<ProbeResult> {
  const out = await run("ffprobe", [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_streams",
    "-show_format",
    file,
  ]);
  const json = JSON.parse(out) as {
    streams: { codec_type: string; width?: number; height?: number }[];
    format: { duration?: string };
  };
  const video = json.streams.find((s) => s.codec_type === "video");
  if (!video?.width || !video.height) {
    throw new PermanentError("הקובץ לא מכיל וידאו תקין"); // no valid video stream
  }
  return {
    width: video.width,
    height: video.height,
    durationMs: Math.round(Number(json.format.duration ?? 0) * 1000),
    hasAudio: json.streams.some((s) => s.codec_type === "audio"),
  };
}

/** Transcode any phone footage to the single normalized format. */
export async function normalizeDemo(input: string, output: string): Promise<void> {
  mkdirSync(path.dirname(output), { recursive: true });
  await run("ffmpeg", [
    "-y",
    "-i",
    input,
    "-vf",
    "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    output,
  ]);
}

export async function thumbnail(input: string, output: string, atMs = 1000): Promise<void> {
  mkdirSync(path.dirname(output), { recursive: true });
  await run("ffmpeg", [
    "-y",
    "-ss",
    (atMs / 1000).toFixed(2),
    "-i",
    input,
    "-vframes",
    "1",
    "-vf",
    "scale=540:960",
    output,
  ]);
}

export interface ColorTags {
  colorRange?: string;
  colorSpace?: string;
  colorPrimaries?: string;
  colorTransfer?: string;
}

/** Colour metadata of the first video stream. Fields are unset when the file
 *  carries no tags and every downstream decoder is left to guess. */
export async function probeColorTags(file: string): Promise<ColorTags> {
  const out = await run("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=color_range,color_space,color_primaries,color_transfer",
    "-print_format",
    "json",
    file,
  ]);
  const json = JSON.parse(out) as {
    streams?: {
      color_range?: string;
      color_space?: string;
      color_primaries?: string;
      color_transfer?: string;
    }[];
  };
  const s = json.streams?.[0] ?? {};
  return {
    colorRange: s.color_range,
    colorSpace: s.color_space,
    colorPrimaries: s.color_primaries,
    colorTransfer: s.color_transfer,
  };
}

/**
 * Stream-copy retag of an H.264 file's colour metadata to BT.709 FULL range —
 * no re-encode, runs in ~1s. Lip-sync clips come back with every colour field
 * unset while carrying full-swing luma (measured on a released render: YMIN=3
 * in every frame, YMAX=241 — outside 16–235), so full range is the truthful
 * label; stamping limited would make decoders expand again and crush exactly
 * the blacks this exists to protect. Bitstream filter only: 1=BT.709 for
 * primaries/transfer/matrix, video_full_range_flag=1=full.
 */
export async function retagBt709Full(input: string, output: string): Promise<void> {
  mkdirSync(path.dirname(output), { recursive: true });
  await run("ffmpeg", [
    "-y",
    "-i",
    input,
    "-c",
    "copy",
    "-bsf:v",
    "h264_metadata=video_full_range_flag=1:colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1",
    output,
  ]);
}

export async function measureDurationMs(file: string): Promise<number> {
  const out = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", file]);
  const json = JSON.parse(out) as { format: { duration?: string } };
  return Math.round(Number(json.format.duration ?? 0) * 1000);
}

/**
 * Speed audio up by `tempo` (1.0–1.05 in practice — inaudible). The length-fit
 * policy caps this at ~5%; anything larger means the script must be shortened.
 */
export async function atempoStretch(input: string, output: string, tempo: number): Promise<void> {
  mkdirSync(path.dirname(output), { recursive: true });
  await run("ffmpeg", ["-y", "-i", input, "-filter:a", `atempo=${tempo.toFixed(4)}`, output]);
}

/**
 * The audio from `startMs` to the end, re-encoded for a sample-accurate cut
 * (`-ss` after `-i`; stream copy can only cut on frame boundaries). Feeds the
 * avatar-outro lip-sync, so the cut must land exactly on the word gap.
 */
export async function sliceAudioFrom(input: string, output: string, startMs: number): Promise<void> {
  mkdirSync(path.dirname(output), { recursive: true });
  await run("ffmpeg", ["-y", "-i", input, "-ss", (startMs / 1000).toFixed(3), output]);
}

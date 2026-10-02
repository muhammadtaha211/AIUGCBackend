import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { PermanentError } from "../jobs/errors";
import type { Rgb } from "./grade";

/**
 * ffmpeg/ffprobe wrappers: probing, normalization to the single output format
 * (1080x1920 / 30fps / H.264 / AAC), thumbnails, the atempo length-fit
 * stretch, and the step-plan analysis samplers (frame extraction, dHash,
 * state clustering). Step trims happen in Remotion, never here.
 *
 * INP-08: every production input reaching this file is a local path our own
 * code wrote moments earlier (storage.download, or writeFileSync of
 * provider/TTS response bytes) — never a network URL, stdin, or a synthetic
 * lavfi source. `-protocol_whitelist file` is applied once, in runRaw, to
 * every ffmpeg/ffprobe input, so no wrapper can forget it and no future
 * caller can accidentally hand these functions a URL. `file` is the whole
 * list: nothing here ever uses `-decryption_key`/`crypto`.
 */

export interface ProbeResult {
  width: number;
  height: number;
  /** Container frame rate. 0 when ffprobe cannot report one. */
  fps: number;
  durationMs: number;
  hasAudio: boolean;
}

const PROTOCOL_WHITELIST = "file";

/**
 * `-protocol_whitelist` is a per-input AVOption, so ffmpeg needs it repeated
 * immediately before every `-i` (there can be several, or none preceded by
 * `-ss`/`-f lavfi`/etc. — it always goes right before the flag itself).
 * ffprobe's callers here never pass `-i`: the filename is always the one
 * trailing positional argument, so prepending once covers its single
 * implicit input. Exported for the argv-shape tests (INP-08); every real
 * caller goes through runRaw, which applies this to every spawned argv
 * without exception.
 */
export function withProtocolWhitelist(args: string[]): string[] {
  if (!args.includes("-i")) return ["-protocol_whitelist", PROTOCOL_WHITELIST, ...args];
  const out: string[] = [];
  for (const arg of args) {
    if (arg === "-i") out.push("-protocol_whitelist", PROTOCOL_WHITELIST);
    out.push(arg);
  }
  return out;
}

/** Hands stdout to `onChunk` as it arrives, so a caller that only needs a
 *  running reduction (frameSignatures: ~100 MB of raw frames for a 90 s demo)
 *  never holds the whole stream. */
function runStream(
  bin: "ffmpeg" | "ffprobe",
  args: string[],
  onChunk: (chunk: Buffer) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, withProtocolWhitelist(args), { windowsHide: true });
    let stderr = "";
    proc.stdout.on("data", onChunk);
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        reject(new Error(`${bin} not found — install ffmpeg and ensure it is on PATH`));
      } else {
        reject(err);
      }
    });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${bin} exited ${code}: ${stderr.slice(-800)}`));
    });
  });
}

/** Raw-bytes runner — rawvideo output would be corrupted by string decoding. */
async function runRaw(bin: "ffmpeg" | "ffprobe", args: string[]): Promise<Buffer> {
  const stdout: Buffer[] = [];
  await runStream(bin, args, (d) => stdout.push(d));
  return Buffer.concat(stdout);
}

async function run(bin: "ffmpeg" | "ffprobe", args: string[]): Promise<string> {
  return (await runRaw(bin, args)).toString("utf8");
}

/**
 * The demuxer families a probe call may open (INP-08 control b — a
 * byte-level allow-list, layered under the protocol whitelist above so a
 * hostile container inside the `file` protocol still can't pick an
 * unexpected parser). Reconciled against what the upload UI/route accept
 * today (mp4/mov only, `apps/web/src/lib/service-a-ui.ts` `DEMO_TYPES`): both
 * are inside the mov/mp4 family ffprobe reports as one comma-joined
 * `format_name` (`mov,mp4,m4a,3gp,3g2,mj2` — one ffmpeg demuxer serves all of
 * those extensions), so there is no mismatch to widen or narrow. matroska/webm
 * is included alongside it — a normal phone or desktop screen recorder never
 * produces either family's siblings (3gp/mj2, or mkv/webm), so nothing real
 * is rejected either way. Passed only by the demo ingest path
 * (`pipelines/demos.ts`); every other caller of `probe()` (bank hook clips,
 * persona images, provider media) passes no whitelist and is unrestricted at
 * this layer, per design.
 */
export const INGEST_CONTAINER_WHITELIST = "mov,mp4,m4a,3gp,3g2,mj2,matroska,webm";

export async function probe(
  file: string,
  opts?: { formatWhitelist?: string },
): Promise<ProbeResult> {
  let out: string;
  try {
    out = await run("ffprobe", [
      "-v",
      "error",
      ...(opts?.formatWhitelist ? ["-format_whitelist", opts.formatWhitelist] : []),
      "-print_format",
      "json",
      "-show_streams",
      "-show_format",
      file,
    ]);
  } catch (err) {
    // ffprobe's own message for this is "Format not on whitelist '<list>'" —
    // only that rejection becomes the same permanent, customer-facing string
    // an unparseable file already throws below; any other ffprobe failure
    // (a genuinely corrupt/unreadable file) keeps its existing transient
    // behaviour, unchanged by this control.
    if (opts?.formatWhitelist && err instanceof Error && /not on whitelist/.test(err.message)) {
      throw new PermanentError("הקובץ לא מכיל וידאו תקין"); // no valid video stream
    }
    throw err;
  }
  const json = JSON.parse(out) as {
    streams: {
      codec_type: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
      r_frame_rate?: string;
    }[];
    format: { duration?: string };
  };
  const video = json.streams.find((s) => s.codec_type === "video");
  if (!video?.width || !video.height) {
    throw new PermanentError("הקובץ לא מכיל וידאו תקין"); // no valid video stream
  }
  return {
    width: video.width,
    height: video.height,
    // avg first, r_frame_rate only as a fallback: r_frame_rate is the base
    // timebase (the shortest representable interval), so a variable-rate clip
    // averaging 6fps still reports 30 there. The question here is always how
    // many distinct frames a second actually holds.
    fps: parseRate(video.avg_frame_rate) || parseRate(video.r_frame_rate),
    durationMs: Math.round(Number(json.format.duration ?? 0) * 1000),
    hasAudio: json.streams.some((s) => s.codec_type === "audio"),
  };
}

/** ffprobe reports rates as "30/1" or "30000/1001", and "0/0" or "N/A" when it
 *  has none. 0 means unknown — callers must not read it as a real rate. */
export function parseRate(rate: string | undefined): number {
  const [num, den] = (rate ?? "").split("/").map(Number);
  if (!num || !den || !Number.isFinite(num / den)) return 0;
  return num / den;
}

/**
 * Transcode to the single delivery format: 1080x1920, 30fps, H.264 + AAC,
 * moov at the head. Phone footage on ingest, and bank hook clips on upload —
 * both have to be exactly 30fps because the compositions are.
 *
 * INP-08 follow-up: a protocol whitelist alone still lets a whitelisted
 * container reference other local files, so the demo ingest path re-applies
 * the same demuxer allow-list here too — this call re-opens the raw customer
 * upload probe() already checked, and checking once then transcoding with no
 * restriction would be a check-then-use gap.
 */
export async function normalizeVideo(
  input: string,
  output: string,
  opts?: { formatWhitelist?: string },
): Promise<void> {
  mkdirSync(path.dirname(output), { recursive: true });
  try {
    await run("ffmpeg", [
      "-y",
      ...(opts?.formatWhitelist ? ["-format_whitelist", opts.formatWhitelist] : []),
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
  } catch (err) {
    // Same mapping as probe()'s formatWhitelist rejection — see the comment
    // there for why only this specific ffmpeg error becomes the permanent,
    // customer-facing string.
    if (opts?.formatWhitelist && err instanceof Error && /not on whitelist/.test(err.message)) {
      throw new PermanentError("הקובץ לא מכיל וידאו תקין"); // no valid video stream
    }
    throw err;
  }
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

/**
 * A blur placeholder for the persona pickers: the image scaled to 8px wide,
 * encoded as WebP and returned as a base64 data URL (~100–300 bytes) for
 * next/image `placeholder="blur"`. Throws on undecodable bytes — callers that
 * treat the placeholder as cosmetic catch and store null.
 */
export async function blurPlaceholder(input: string): Promise<string> {
  const output = `${input}.blur.webp`;
  await run("ffmpeg", ["-y", "-i", input, "-vf", "scale=8:-1", "-frames:v", "1", output]);
  const bytes = readFileSync(output);
  rmSync(output, { force: true });
  return `data:image/webp;base64,${bytes.toString("base64")}`;
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
 * Stream-copy retag of an H.264 file's colour metadata to BT.709 LIMITED
 * range — no re-encode, runs in ~1s. Lip-sync clips come back with every
 * colour field unset, and their stored luma is the ordinary encoder shape:
 * measured 2026-09-05 on a HeyGen clip, Y spans 13–209 in every sampled frame
 * with no pixel below 16 or above 235 — the same span as a tv-tagged clip of
 * the same scene (12–215) and nothing like the full-range selfie it was made
 * from (0–231). Until then this stamped FULL, which made Remotion read those
 * frames with lifted blacks and dimmed whites — the "washed" talking head of
 * the first real opener render (docs/vault/falsified/heygen-clips-are-full-range.md).
 * Bitstream filter only: 1=BT.709 for primaries/transfer/matrix,
 * video_full_range_flag=0=limited.
 */
export async function retagBt709Limited(input: string, output: string): Promise<void> {
  mkdirSync(path.dirname(output), { recursive: true });
  await run("ffmpeg", [
    "-y",
    "-i",
    input,
    "-c",
    "copy",
    "-bsf:v",
    "h264_metadata=video_full_range_flag=0:colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1",
    output,
  ]);
}

/**
 * Mean RGB (0–255 sRGB) of the frame at `atMs`, read per the file's own range
 * tag — a limited-range clip and a full-range still land on one scale; an
 * untagged file reads as limited, ffmpeg's default. Past the clip's last
 * frame (a reveal tagged on duration_ms, one frame interval past the last
 * timestamp, is legal everywhere else) it reads the last frame. ffmpeg
 * area-averages the frame to 128×128 and Node averages the rest: ffmpeg's own
 * 1080→1 downscale is a nonlinear kernel path, not a mean — media-color.test.ts
 * pins both. One decode, ~0.3s.
 */
export async function meanRgb(
  file: string,
  atMs: number,
  /** Optional ffmpeg crop (e.g. "crop=iw/2:ih/2:iw/4:ih/4") — the region measured. */
  region?: string,
): Promise<Rgb> {
  let out = await rgbFrames(file, ["-ss", (atMs / 1000).toFixed(3)], 1, region);
  // Past the last frame's timestamp ffmpeg writes nothing and exits 0. The
  // last frame is then the first of the final half-second played backwards.
  if (out.length === 0) out = await rgbFrames(file, ["-sseof", "-0.5"], 1, region, "reverse,");
  if (out.length === 0) throw new Error(`meanRgb: no frame at ${atMs}ms in ${file}`);
  return out[0]!;
}

/** Mean RGB per source frame, `frames` frames from `fromMs` — a colour over time. */
export async function rgbSeries(
  file: string,
  fromMs: number,
  frames: number,
  region?: string,
): Promise<Rgb[]> {
  return rgbFrames(file, ["-ss", (fromMs / 1000).toFixed(3)], frames, region);
}

const RGB_SAMPLE = 128;

async function rgbFrames(
  file: string,
  seek: string[],
  frames: number,
  region?: string,
  filter = "",
): Promise<Rgb[]> {
  const out = await runRaw("ffmpeg", [
    ...["-v", "error", ...seek, "-i", file, "-frames:v", String(frames)],
    ...[
      "-vf",
      `${filter}scale=out_range=pc,format=yuv420p,${region ? `${region},` : ""}` +
        `scale=${RGB_SAMPLE}:${RGB_SAMPLE}:flags=area,format=rgb24`,
    ],
    ...["-f", "rawvideo", "-"],
  ]);
  const frameBytes = RGB_SAMPLE * RGB_SAMPLE * 3;
  const result: Rgb[] = [];
  for (let f = 0; f + frameBytes <= out.length; f += frameBytes) {
    const sum = [0, 0, 0];
    for (let i = f; i < f + frameBytes; i += 3) {
      sum[0]! += out[i]!;
      sum[1]! += out[i + 1]!;
      sum[2]! += out[i + 2]!;
    }
    result.push(sum.map((v) => v / (RGB_SAMPLE * RGB_SAMPLE)) as Rgb);
  }
  return result;
}

/**
 * How far frame B (file/time) has to move to sit on frame A, in pixels at the
 * files' own resolution — the talking head's idle frame against the opener's
 * reveal frame, both 1080×1920. Both are read as luma at quarter size and the
 * best of a ±5-step (±20px) search by sum of absolute differences wins; the
 * answer is a multiple of 4px, which is below what a cut shows. Measured
 * 2026-09-06 on the first real render: HeyGen's head sat 8px above the
 * opener's, and that alone read as a jump cut once the colours matched.
 */
export async function alignmentOffset(
  fileA: string,
  atMsA: number,
  fileB: string,
  atMsB: number,
): Promise<{ dx: number; dy: number }> {
  const SCALE = 4;
  const W = 1080 / SCALE;
  const H = 1920 / SCALE;
  const RANGE = 5;
  const [a, b] = await Promise.all([grayFrame(fileA, atMsA, W, H), grayFrame(fileB, atMsB, W, H)]);
  let best = { sad: Number.POSITIVE_INFINITY, dx: 0, dy: 0 };
  for (let dy = -RANGE; dy <= RANGE; dy++) {
    for (let dx = -RANGE; dx <= RANGE; dx++) {
      let sad = 0;
      for (let y = RANGE; y < H - RANGE; y++) {
        const rowA = y * W;
        const rowB = (y - dy) * W;
        for (let x = RANGE; x < W - RANGE; x++) {
          sad += Math.abs(a[rowA + x]! - b[rowB + x - dx]!);
        }
      }
      if (sad < best.sad) best = { sad, dx, dy };
    }
  }
  return { dx: best.dx * SCALE, dy: best.dy * SCALE };
}

/** One frame's luma at w×h, range-expanded like meanRgb; the last frame past the end. */
async function grayFrame(file: string, atMs: number, w: number, h: number): Promise<Buffer> {
  const plane = (seek: string[], filter = "") =>
    runRaw("ffmpeg", [
      ...["-v", "error", ...seek, "-i", file, "-frames:v", "1"],
      ...[
        "-vf",
        `${filter}scale=out_range=pc,format=yuv420p,scale=${w}:${h}:flags=area,format=gray`,
      ],
      ...["-f", "rawvideo", "-"],
    ]);
  let out = await plane(["-ss", (atMs / 1000).toFixed(3)]);
  if (out.length === 0) out = await plane(["-sseof", "-0.5"], "reverse,");
  if (out.length !== w * h) throw new Error(`grayFrame: no frame at ${atMs}ms in ${file}`);
  return out;
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
 * Prepend `ms` of digital silence. Re-encoded (a stream copy cannot insert
 * samples) with the input's sample rate and channel layout kept — ffmpeg
 * carries both through by default — and the codec chosen by the output
 * extension, so an mp3 in is an mp3 out and a duration probe of the output
 * reports input + ms. Feeds the Service B lip-sync: HeyGen Avatar IV idles on
 * the reference still only while the audio is silent, so the lead-in is what
 * lets the opener's hard cut land on a frame that still looks like the
 * reference image (docs/vault/facts/heygen-avatar-iv-idles-on-leading-silence.md).
 */
export async function padAudioStart(input: string, output: string, ms: number): Promise<void> {
  mkdirSync(path.dirname(output), { recursive: true });
  await run("ffmpeg", ["-y", "-i", input, "-af", `adelay=${Math.round(ms)}:all=1`, output]);
}

/**
 * The audio from `startMs` to the end, re-encoded for a sample-accurate cut
 * (`-ss` after `-i`; stream copy can only cut on frame boundaries). Feeds the
 * avatar-outro lip-sync, so the cut must land exactly on the word gap.
 */
export async function sliceAudioFrom(
  input: string,
  output: string,
  startMs: number,
): Promise<void> {
  mkdirSync(path.dirname(output), { recursive: true });
  await run("ffmpeg", ["-y", "-i", input, "-ss", (startMs / 1000).toFixed(3), output]);
}

// --- step-plan analysis samplers ---------------------------------------------

export interface ExtractedFrame {
  path: string;
  timestampMs: number;
}

/**
 * Sample the video to numbered JPEGs in one decode pass (no per-frame seeks).
 * Timestamps derive from index and fps — frame N (0-based) shows the video at
 * N/fps seconds — so extracting at the fps the hashes were computed at makes
 * cluster-representative timestamps match files exactly.
 */
export async function extractFrames(
  input: string,
  outDir: string,
  opts: { fps: number; width: number },
): Promise<ExtractedFrame[]> {
  mkdirSync(outDir, { recursive: true });
  // Retries reuse per-entity work dirs; ffmpeg -y overwrites frames 1..N but
  // never deletes N+1.., so leftovers from a longer previous run would come
  // back as phantom frames with fabricated timestamps.
  for (const f of readdirSync(outDir)) {
    if (/^\d{5,}\.jpg$/.test(f)) rmSync(path.join(outDir, f), { force: true });
  }
  await run("ffmpeg", [
    "-y",
    "-i",
    input,
    "-vf",
    `fps=${opts.fps},scale=${opts.width}:-2`,
    "-an",
    "-q:v",
    "3",
    path.join(outDir, "%05d.jpg"),
  ]);
  return readdirSync(outDir)
    .filter((f) => /^\d{5,}\.jpg$/.test(f))
    .map((f) => ({ file: f, index: Number.parseInt(f, 10) }))
    .sort((a, b) => a.index - b.index)
    .map(({ file, index }) => ({
      path: path.join(outDir, file),
      timestampMs: Math.round(((index - 1) * 1000) / opts.fps),
    }));
}

/**
 * One perceptual hash per sampled frame from a 9x8 grayscale downscale.
 * Three bands: 64 horizontal dHash bits (is this pixel darker than its right
 * neighbour), 63 vertical dHash bits (than the pixel below it — phone UI
 * change lives mostly on the vertical axis: lists, keyboards, sheets), and
 * 16 thermometer-coded bits of mean frame luma. Structure bits compare
 * layout, not pixel deltas, so handheld jitter does not read as a new state;
 * the luma band exists because structure alone is blind to a flat-to-flat
 * cut (white loading screen → black splash — both hash to zero structure
 * bits), and thermometer coding keeps auto-exposure drift to ~1 bit.
 */
export async function frameHashes(input: string, opts: { fps: number }): Promise<bigint[]> {
  const raw = await runRaw("ffmpeg", [
    "-i",
    input,
    "-vf",
    `fps=${opts.fps},scale=9:8,format=gray`,
    "-an",
    "-f",
    "rawvideo",
    "-",
  ]);
  const frameBytes = 9 * 8;
  if (raw.length === 0 || raw.length % frameBytes !== 0) {
    throw new Error(`rawvideo stream is ${raw.length} bytes — not a multiple of ${frameBytes}`);
  }
  const hashes: bigint[] = [];
  for (let offset = 0; offset < raw.length; offset += frameBytes) {
    let hash = 0n;
    let sum = 0;
    for (let i = 0; i < frameBytes; i++) sum += raw[offset + i]!;
    for (let y = 0; y < 8; y++) {
      const row = offset + y * 9;
      for (let x = 0; x < 8; x++) {
        hash = (hash << 1n) | (raw[row + x]! < raw[row + x + 1]! ? 1n : 0n);
      }
    }
    for (let y = 0; y < 7; y++) {
      const row = offset + y * 9;
      for (let x = 0; x < 9; x++) {
        hash = (hash << 1n) | (raw[row + x]! < raw[row + x + 9]! ? 1n : 0n);
      }
    }
    const lumaLevel = Math.min(15, Math.floor(sum / frameBytes / 16));
    hash = (hash << 16n) | ((1n << BigInt(lumaLevel)) - 1n);
    hashes.push(hash);
  }
  return hashes;
}

export interface StateCluster {
  startMs: number;
  endMs: number;
  representativeMs: number;
}

export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b;
  let bits = 0;
  while (x > 0n) {
    bits += Number(x & 1n);
    x >>= 1n;
  }
  return bits;
}

/**
 * Collapse runs of consecutive frames into one cluster per UI state. Each
 * frame is compared to the cluster's FIRST frame, not its neighbour —
 * adjacent comparison lets a slow scroll drift a full screen without any
 * single 200ms step crossing the threshold, chain-merging distinct states;
 * anchoring bounds cumulative drift while jitter still oscillates safely
 * around the anchor. Clusters shorter than `minFrames` are dropped: a single
 * glare/shake frame otherwise becomes its own cluster and puts a noise frame
 * in front of the vision model. The representative is the median-timestamp
 * frame, not the sharpest — variance-of-Laplacian needs OpenCV, and the model
 * reports per-frame legibility anyway, which is the gate that actually
 * matters.
 * TODO: sharpness-based representative selection within a cluster.
 */
export function clusterStates(
  hashes: bigint[],
  timestamps: number[],
  opts: { maxHamming: number; minFrames?: number },
): StateCluster[] {
  if (hashes.length !== timestamps.length) {
    throw new Error(`${hashes.length} hashes but ${timestamps.length} timestamps`);
  }
  const minFrames = opts.minFrames ?? 1;
  const clusters: StateCluster[] = [];
  let start = 0;
  for (let i = 1; i <= hashes.length; i++) {
    if (i < hashes.length && hamming(hashes[start]!, hashes[i]!) <= opts.maxHamming) continue;
    if (i - start >= minFrames) {
      clusters.push({
        startMs: timestamps[start]!,
        endMs: timestamps[i - 1]!,
        representativeMs: timestamps[start + Math.floor((i - 1 - start) / 2)]!,
      });
    }
    start = i;
  }
  return clusters;
}

// --- footage signatures (decision 0078) --------------------------------------

/** The frame the signatures are computed on: gray, 9:16, small enough to
 *  stream every native frame and large enough that a heading changing on a
 *  filmed monitor still moves the edge layout (the 9x8 hash above cannot see
 *  it — two wizard steps sit 3 bits apart, a scroll 80). */
export const SIGNATURE_WIDTH = 144;
export const SIGNATURE_HEIGHT = 256;
const SIGNATURE_BLOCK = 8;
const SIGNATURE_LUMA_SCALE = 4;

export interface FrameSignature {
  /** Where the detail sits: gradient energy per 8x8 block, as a share of the
   *  frame's total — layout, not brightness, so exposure drift cancels. */
  edges: Float32Array;
  /** A 36x64 thumbnail with its mean removed and its spread divided out. It
   *  exists for what `edges` is blind to: a blank page has no edges at all. */
  luma: Float32Array;
}

/** One frame of SIGNATURE_WIDTH x SIGNATURE_HEIGHT gray bytes -> its signature. */
export function signatureOf(frame: Uint8Array): FrameSignature {
  const W = SIGNATURE_WIDTH;
  const H = SIGNATURE_HEIGHT;
  if (frame.length !== W * H) {
    throw new Error(`signature frame is ${frame.length} bytes — expected ${W * H}`);
  }
  const blocksX = W / SIGNATURE_BLOCK;
  const blocksY = H / SIGNATURE_BLOCK;
  const edges = new Float32Array(blocksX * blocksY);
  let total = 0;
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      let sum = 0;
      for (let y = 0; y < SIGNATURE_BLOCK; y++) {
        const row = (by * SIGNATURE_BLOCK + y) * W + bx * SIGNATURE_BLOCK;
        for (let x = 0; x < SIGNATURE_BLOCK; x++) {
          const j = row + x;
          const v = frame[j]!;
          if (bx * SIGNATURE_BLOCK + x + 1 < W) sum += Math.abs(v - frame[j + 1]!);
          if (by * SIGNATURE_BLOCK + y + 1 < H) sum += Math.abs(v - frame[j + W]!);
        }
      }
      edges[by * blocksX + bx] = sum;
      total += sum;
    }
  }
  for (let k = 0; k < edges.length; k++) edges[k] = edges[k]! / (total || 1);

  const lumaW = W / SIGNATURE_LUMA_SCALE;
  const lumaH = H / SIGNATURE_LUMA_SCALE;
  const cell = SIGNATURE_LUMA_SCALE * SIGNATURE_LUMA_SCALE;
  const luma = new Float32Array(lumaW * lumaH);
  let mean = 0;
  for (let y = 0; y < lumaH; y++) {
    for (let x = 0; x < lumaW; x++) {
      let sum = 0;
      for (let yy = 0; yy < SIGNATURE_LUMA_SCALE; yy++) {
        for (let xx = 0; xx < SIGNATURE_LUMA_SCALE; xx++) {
          sum += frame[(y * SIGNATURE_LUMA_SCALE + yy) * W + x * SIGNATURE_LUMA_SCALE + xx]!;
        }
      }
      luma[y * lumaW + x] = sum / cell;
      mean += sum / cell;
    }
  }
  mean /= luma.length;
  let variance = 0;
  for (let k = 0; k < luma.length; k++) {
    luma[k] = luma[k]! - mean;
    variance += luma[k]! * luma[k]!;
  }
  // Floored: a flat frame's spread is sensor noise, and dividing by it would
  // turn that noise into a full-scale picture.
  const spread = Math.max(6, Math.sqrt(variance / luma.length));
  for (let k = 0; k < luma.length; k++) luma[k] = luma[k]! / spread;
  return { edges, luma };
}

/**
 * One signature per frame of the whole recording at `fps`, in one decode pass.
 * The frames are reduced as they stream: nothing but the signatures is kept.
 */
export async function frameSignatures(
  input: string,
  opts: { fps: number },
): Promise<FrameSignature[]> {
  const frameBytes = SIGNATURE_WIDTH * SIGNATURE_HEIGHT;
  const signatures: FrameSignature[] = [];
  let pending: Buffer = Buffer.alloc(0);
  await runStream(
    "ffmpeg",
    [
      "-i",
      input,
      "-vf",
      `fps=${opts.fps},scale=${SIGNATURE_WIDTH}:${SIGNATURE_HEIGHT}:flags=area,format=gray`,
      "-an",
      "-f",
      "rawvideo",
      "-",
    ],
    (chunk) => {
      pending = pending.length > 0 ? Buffer.concat([pending, chunk]) : chunk;
      let offset = 0;
      while (pending.length - offset >= frameBytes) {
        signatures.push(signatureOf(pending.subarray(offset, offset + frameBytes)));
        offset += frameBytes;
      }
      pending = pending.subarray(offset);
    },
  );
  if (signatures.length === 0 || pending.length !== 0) {
    throw new Error(
      `rawvideo stream ended ${pending.length} bytes into a frame after ${signatures.length} frames`,
    );
  }
  return signatures;
}

/**
 * The named frames of the recording at `fps` (0-based, as frameSignatures
 * counts them) as JPEGs, in one decode pass. `outDir` is cleared of numbered
 * frames first, for the reason extractFrames gives.
 */
export async function extractFramesAt(
  input: string,
  outDir: string,
  opts: { fps: number; width: number; frameIndexes: number[] },
): Promise<ExtractedFrame[]> {
  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(outDir)) {
    if (/^\d{5,}\.jpg$/.test(f)) rmSync(path.join(outDir, f), { force: true });
  }
  const indexes = [...new Set(opts.frameIndexes)].sort((a, b) => a - b);
  if (indexes.length === 0) return [];
  await run("ffmpeg", [
    "-y",
    "-i",
    input,
    "-vf",
    `fps=${opts.fps},select='${indexes.map((n) => `eq(n\\,${n})`).join("+")}',scale=${opts.width}:-2`,
    "-fps_mode",
    "passthrough",
    "-an",
    "-q:v",
    "3",
    path.join(outDir, "%05d.jpg"),
  ]);
  const files = readdirSync(outDir)
    .filter((f) => /^\d{5,}\.jpg$/.test(f))
    .sort();
  if (files.length !== indexes.length) {
    throw new Error(`asked for ${indexes.length} frames, ffmpeg wrote ${files.length}`);
  }
  return files.map((file, i) => ({
    path: path.join(outDir, file),
    timestampMs: Math.round((indexes[i]! * 1000) / opts.fps),
  }));
}

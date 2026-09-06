/**
 * The talking-head colour grade: per-channel gains that hold the head's
 * colour at the opener's for the first stretch after the cut, then settle to
 * one constant. Pure — the measuring (ffmpeg) lives in ffmpeg.ts and the
 * applying (an SVG feColorMatrix) in the ServiceB composition; this is the
 * arithmetic between them.
 *
 * Why a curve and not a number (measured 2026-09-06 on the first real
 * render): HeyGen's idle frame — the one the cut lands on — is ~9% darker
 * than its reference selfie, but once the head starts to move HeyGen renders
 * it 3–4% brighter than that idle frame, and warmer. A gain matched on the
 * cut frame alone therefore lets the head visibly brighten over the next
 * half second, which is what the founder saw as "a jump in brightness".
 */

export type Rgb = [number, number, number];

export interface GradeCurve {
  /** Sample spacing, in ms of talking-head time from its first shown frame. */
  stepMs: number;
  /** Per-channel gains per sample; the composition interpolates and holds the last. */
  r: number[];
  g: number[];
  b: number[];
}

export const GRADE_STEP_MS = 100;
/** Locked to the opener's colour for this long after the cut, per sample. */
export const GRADE_LOCK_MS = 2000;
/** Then eased into the constant over this long. */
export const GRADE_BLEND_MS = 500;
/** A gain outside this band means the frames are not comparable — no grade. */
const GAIN_MIN = 0.8;
const GAIN_MAX = 1.3;

/**
 * `target` is the opener's reveal frame (head box, mean RGB); `series` is the
 * head's mean RGB per source frame from its first shown frame, at `fps`. It
 * should cover at least lock + blend plus a stretch for the constant (the
 * median of the frames after the lock). Returns undefined when the two are
 * not comparable — a black frame, a reveal tagged on the palm — because no
 * grade is safer than a wrong one.
 */
export function gradeCurve(target: Rgb, series: Rgb[], fps: number): GradeCurve | undefined {
  if (series.length === 0 || fps <= 0) return undefined;
  const frameMs = 1000 / fps;
  const at = (i: number) => i * frameMs;

  // 100ms bins of the source frames, lightly smoothed, for the locked stretch.
  const bins: Rgb[] = [];
  for (let t = 0; t <= GRADE_LOCK_MS; t += GRADE_STEP_MS) {
    const inBin = series.filter((_, i) => Math.abs(at(i) - t) <= GRADE_STEP_MS / 2);
    if (inBin.length === 0) break;
    bins.push(mean(inBin));
  }
  if (bins.length === 0) return undefined;
  const smoothed = bins.map((bin, k) => {
    const prev = bins[k - 1] ?? bin;
    const next = bins[k + 1] ?? bin;
    return bin.map((v, c) => 0.25 * prev[c]! + 0.5 * v + 0.25 * next[c]!) as Rgb;
  });

  // The constant: the head's typical colour once it is talking.
  const rest = series.filter((_, i) => at(i) > GRADE_LOCK_MS);
  const settled = rest.length >= 3 ? median(rest) : (smoothed[smoothed.length - 1] ?? bins[0]!);

  const gains = (c: 0 | 1 | 2): number[] | undefined => {
    const locked = smoothed.map((bin) => target[c] / bin[c]);
    const constant = target[c] / settled[c];
    const last = locked[locked.length - 1]!;
    const blendSteps = Math.round(GRADE_BLEND_MS / GRADE_STEP_MS);
    const blend = Array.from({ length: blendSteps }, (_, i) => {
      const f = (i + 1) / blendSteps;
      return last + (constant - last) * f;
    });
    const all = [...locked, ...blend];
    if (all.some((g) => !Number.isFinite(g) || g < GAIN_MIN || g > GAIN_MAX)) return undefined;
    return all.map((g) => Number(g.toFixed(4)));
  };
  const r = gains(0);
  const g = gains(1);
  const b = gains(2);
  if (!r || !g || !b) return undefined;
  return { stepMs: GRADE_STEP_MS, r, g, b };
}

function mean(rows: Rgb[]): Rgb {
  const sum: Rgb = [0, 0, 0];
  for (const row of rows) for (let c = 0; c < 3; c++) sum[c]! += row[c]!;
  return sum.map((v) => v / rows.length) as Rgb;
}

function median(rows: Rgb[]): Rgb {
  const channel = (c: number) => {
    const sorted = rows.map((row) => row[c]!).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  };
  return [channel(0), channel(1), channel(2)];
}

/** The gains at `ms` into the talking head: linear between samples, held past the last. */
export function gradeAt(curve: GradeCurve, ms: number): Rgb {
  const pos = Math.max(0, ms / curve.stepMs);
  const i = Math.min(Math.floor(pos), curve.r.length - 1);
  const j = Math.min(i + 1, curve.r.length - 1);
  const f = Math.min(1, pos - i);
  const lerp = (arr: number[]) => arr[i]! + (arr[j]! - arr[i]!) * f;
  return [lerp(curve.r), lerp(curve.g), lerp(curve.b)];
}

import { describe, expect, it } from "vitest";
import {
  GRADE_BLEND_MS,
  GRADE_LOCK_MS,
  GRADE_STEP_MS,
  gradeAt,
  gradeCurve,
  type Rgb,
} from "../src/media/grade";

/**
 * The talking-head grade arithmetic. The shape it exists for: HeyGen's idle
 * frame is darker than its own animated frames, so the series starts low,
 * rises over the first second and then wanders around a level — and the
 * curve must hold the opener's colour through all of that, then settle.
 */

const FPS = 25;
const TARGET: Rgb = [100, 90, 80];

/** A series shaped like the real one: idle at 90%, a rise to 104% by 1s, then ±3% around 100%. */
function heygenLike(seconds: number): Rgb[] {
  const out: Rgb[] = [];
  for (let i = 0; i < seconds * FPS; i++) {
    const t = i / FPS;
    const level =
      t < 0.5 ? 0.9 : t < 1 ? 0.9 + ((t - 0.5) / 0.5) * 0.14 : 1 + 0.03 * Math.sin(t * 5);
    out.push(TARGET.map((v) => v * level) as Rgb);
  }
  return out;
}

describe("gradeCurve", () => {
  it("holds the opener's colour through the idle-to-talking rise, then settles to a constant", () => {
    const curve = gradeCurve(TARGET, heygenLike(8), FPS)!;
    expect(curve.stepMs).toBe(GRADE_STEP_MS);
    // Locked stretch: gain × measured level ≈ 1 at every sample.
    const series = heygenLike(8);
    for (let k = 0; k * GRADE_STEP_MS <= GRADE_LOCK_MS; k++) {
      const i = Math.round((k * GRADE_STEP_MS) / (1000 / FPS));
      const graded = series[i]![0] * curve.r[k]!;
      expect(Math.abs(graded / TARGET[0] - 1)).toBeLessThan(0.03);
    }
    // The constant lands on the typical talking level (1.0 × target → gain ≈ 1).
    const last = curve.r[curve.r.length - 1]!;
    expect(Math.abs(last - 1)).toBeLessThan(0.02);
    expect(curve.r.length).toBe(GRADE_LOCK_MS / GRADE_STEP_MS + 1 + GRADE_BLEND_MS / GRADE_STEP_MS);
  });

  it("is per channel", () => {
    const series: Rgb[] = Array.from({ length: 200 }, () => [50, 90, 100]);
    const curve = gradeCurve([60, 90, 80], series, FPS)!;
    expect(curve.r[0]).toBeCloseTo(1.2, 3);
    expect(curve.g[0]).toBeCloseTo(1, 3);
    expect(curve.b[0]).toBeCloseTo(0.8, 3);
  });

  it("refuses frames that are not comparable — a gain outside 0.8–1.3, or nothing to measure", () => {
    const dark: Rgb[] = Array.from({ length: 200 }, () => [10, 10, 10]);
    expect(gradeCurve(TARGET, dark, FPS)).toBeUndefined();
    expect(gradeCurve(TARGET, [], FPS)).toBeUndefined();
    expect(gradeCurve(TARGET, heygenLike(8), 0)).toBeUndefined();
  });

  it("copes with a short series by settling on what it has", () => {
    const curve = gradeCurve(TARGET, heygenLike(1), FPS);
    expect(curve).toBeDefined();
    expect(curve!.r.every((g) => g >= 0.8 && g <= 1.3)).toBe(true);
  });
});

describe("gradeAt", () => {
  const curve = { stepMs: 100, r: [1, 1.2, 1.1], g: [1, 1, 1], b: [0.9, 0.9, 0.9] };
  it("interpolates between samples and holds the last one", () => {
    expect(gradeAt(curve, 0)[0]).toBe(1);
    expect(gradeAt(curve, 50)[0]).toBeCloseTo(1.1, 6);
    expect(gradeAt(curve, 100)[0]).toBe(1.2);
    expect(gradeAt(curve, 150)[0]).toBeCloseTo(1.15, 6);
    expect(gradeAt(curve, 5000)[0]).toBe(1.1);
    expect(gradeAt(curve, -20)[2]).toBe(0.9);
  });
});

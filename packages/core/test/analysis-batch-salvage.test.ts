import { describe, expect, it } from "vitest";
import { BudgetError } from "../src/jobs/errors";
import { hamming, type StateCluster } from "../src/media/ffmpeg";
import {
  assembleTimeline,
  batchWireFormat,
  correctivePrompt,
  describeShortfall,
  parseBatchEnvelope,
  salvageBatchFrames,
  transcribeBatch,
  validateBatchFrames,
  type BatchFrame,
  type FrameRejection,
  type TranscribedFrame,
} from "../src/pipelines/demo-analysis";
import type { RawResult } from "../src/providers/anthropic";

/**
 * The batch layer of analyze_demo without ffmpeg or the network: assembly's
 * index mapping and seam bridging (lifted verbatim from the handler), pinned
 * first so the per-element salvage below can be shown not to move them; then
 * the salvage itself — one invalid frame drops that frame, never its batch —
 * and the wire bytes every batch call sends.
 */

// A dHash with n low bits set: h(0) vs h(20) is 20 bits apart (> MAX_HAMMING
// 14, a split); equal hashes are 0 apart (a merge). The fifth sets bits 40-59,
// 20+ bits from each of the others — pinned below, so the fixture cannot
// silently merge a pair.
const h = (n: number): bigint => (1n << BigInt(n)) - 1n;
const DISTINCT = [h(0), h(20), h(40), h(60), h(20) << 40n] as const;

function cluster(ms: number): StateCluster {
  return { startMs: ms, endMs: ms + 200, representativeMs: ms };
}

function frame(index: number, overrides: Partial<BatchFrame> = {}): BatchFrame {
  return {
    index,
    screenName: `state-${index}`,
    visibleText: [`text-${index}`],
    action: `action-${index}`,
    actionType: "tap",
    screenKind: "product",
    sameStateAsPrevious: false,
    legibility: "high",
    salienceNote: null,
    ...overrides,
  };
}

// Five clusters in two batches of three: kept-index g = bi * 3 + i.
const BATCHES: StateCluster[][] = [
  [cluster(0), cluster(1000), cluster(2000)],
  [cluster(3000), cluster(4000)],
];
const thumbPathAt = (ms: number) => `assets/thumb/${ms}.jpg`;

function assemble(
  batchResults: Record<string, (TranscribedFrame | null)[]>,
  keptHashes: bigint[] = [...DISTINCT],
) {
  return assembleTimeline({
    batches: BATCHES,
    batchResults,
    batchSize: 3,
    keptHashes,
    thumbPathAt,
  });
}

describe("assembleTimeline — index mapping", () => {
  it("the fixture's hashes are pairwise farther apart than MAX_HAMMING (14)", () => {
    for (let a = 0; a < DISTINCT.length; a++) {
      for (let b = a + 1; b < DISTINCT.length; b++) {
        expect(hamming(DISTINCT[a]!, DISTINCT[b]!)).toBeGreaterThan(14);
      }
    }
  });

  it("attaches every thumbnail to its own cluster when a middle position is null", () => {
    const { assembled, droppedMs } = assemble({
      0: [frame(0), null, frame(2)],
      1: [frame(0), frame(1)],
    });
    expect(droppedMs).toEqual([1000]);
    expect(assembled.map((s) => s.timestampMs)).toEqual([0, 2000, 3000, 4000]);
    expect(assembled.map((s) => s.thumbPath)).toEqual([0, 2000, 3000, 4000].map(thumbPathAt));
    // The transcription at position i stays with cluster i — nothing shifts.
    expect(assembled.map((s) => s.screenName)).toEqual([
      "state-0",
      "state-2",
      "state-0",
      "state-1",
    ]);
  });

  it("drops position 0 and the last position without moving their neighbours", () => {
    const { assembled, droppedMs } = assemble({
      0: [null, frame(1), frame(2)],
      1: [frame(0), null],
    });
    expect(droppedMs).toEqual([0, 4000]);
    expect(assembled.map((s) => [s.timestampMs, s.screenName])).toEqual([
      [1000, "state-1"],
      [2000, "state-2"],
      [3000, "state-0"],
    ]);
  });

  it("survives a whole batch of nulls", () => {
    const { assembled, droppedMs } = assemble({
      0: [null, null, null],
      1: [frame(0), frame(1)],
    });
    expect(droppedMs).toEqual([0, 1000, 2000]);
    expect(assembled.map((s) => s.timestampMs)).toEqual([3000, 4000]);
    expect(assembled[0]!.sameStateAsPrevious).toBe(false);
  });
});

describe("assembleTimeline — seam bridging", () => {
  it("the first assembled state is never a repeat, whatever the model said", () => {
    const { assembled } = assemble({
      0: [null, frame(1, { sameStateAsPrevious: true }), frame(2)],
      1: [frame(0), frame(1)],
    });
    expect(assembled[0]!.sameStateAsPrevious).toBe(false);
  });

  it("a null mid-batch breaks adjacency: the next state is re-judged by dHash, not by its flag", () => {
    // Model said "same" but the hashes are 20 bits apart: recomputed to false.
    const flagged = assemble({
      0: [frame(0), null, frame(2, { sameStateAsPrevious: true })],
      1: [frame(0), frame(1)],
    });
    expect(flagged.assembled[1]!.sameStateAsPrevious).toBe(false);
    // Model said "different" but cluster 2 hashes like cluster 0: recomputed to true.
    const merged = assemble({ 0: [frame(0), null, frame(2)], 1: [frame(0), frame(1)] }, [
      h(0),
      h(20),
      h(0),
      h(60),
      h(60),
    ]);
    expect(merged.assembled[1]!.sameStateAsPrevious).toBe(true);
  });

  it("a batch boundary with adjacency intact is bridged by dHash in addition to the flag", () => {
    // Position 0 of batch 1 (g=3) follows g=2: the model cannot see across the
    // seam, so an equal hash reads as a repeat even with the flag false...
    const bridged = assemble({ 0: [frame(0), frame(1), frame(2)], 1: [frame(0), frame(1)] }, [
      h(0),
      h(20),
      h(40),
      h(40),
      h(60),
    ]);
    expect(bridged.assembled[3]!.sameStateAsPrevious).toBe(true);
    // ...and a distinct hash keeps the flag's verdict.
    const split = assemble({ 0: [frame(0), frame(1), frame(2)], 1: [frame(0), frame(1)] });
    expect(split.assembled[3]!.sameStateAsPrevious).toBe(false);
    // Inside a batch the flag alone decides (the model saw both frames)...
    const inBatch = assemble({
      0: [frame(0), frame(1, { sameStateAsPrevious: true }), frame(2)],
      1: [frame(0), frame(1)],
    });
    expect(inBatch.assembled[1]!.sameStateAsPrevious).toBe(true);
    // ...so an equal hash does NOT override a false flag there: g=2 is i=2 of
    // batch 0, adjacent to g=1, hashed identically, and stays a split.
    const inBatchEqual = assemble({ 0: [frame(0), frame(1), frame(2)], 1: [frame(0), frame(1)] }, [
      h(0),
      h(20),
      h(20),
      h(60),
      h(20) << 40n,
    ]);
    expect(inBatchEqual.assembled[2]!.sameStateAsPrevious).toBe(false);
  });

  it("a null AT the batch boundary re-judges the next batch's first state by dHash", () => {
    // g=2 dropped: g=3's previous assembled state is g=1, adjacency broken.
    const merged = assemble({ 0: [frame(0), frame(1), null], 1: [frame(0), frame(1)] }, [
      h(0),
      h(20),
      h(40),
      h(20),
      h(60),
    ]);
    expect(merged.droppedMs).toEqual([2000]);
    expect(merged.assembled[2]!.timestampMs).toBe(3000);
    expect(merged.assembled[2]!.sameStateAsPrevious).toBe(true);
    const split = assemble({
      0: [frame(0), frame(1), null],
      1: [frame(0, { sameStateAsPrevious: true }), frame(1)],
    });
    expect(split.assembled[2]!.sameStateAsPrevious).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Per-element salvage
// ---------------------------------------------------------------------------

/** A sentinel for customer screen content: must never reach a log field, an
 *  error message or a corrective prompt. */
const SCREEN_TEXT = "מספר כרטיס 4580";
const ALLOWED_ACTIONS = "navigate, tap, type, select, scroll, result, idle";

/** A raw model entry: a valid frame carrying screen text, with overrides that
 *  may break it. */
function raw(index: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...frame(index), visibleText: [SCREEN_TEXT], ...overrides };
}

describe("validateBatchFrames", () => {
  it("removes one invalid element mid-batch; the others keep their claimed indexes", () => {
    const { frames, rejected, canonicalized } = validateBatchFrames([
      raw(0),
      raw(1, { actionType: "click" }),
      raw(2),
    ]);
    expect(frames.map((f) => f.index)).toEqual([0, 2]);
    expect(canonicalized).toEqual([]);
    expect(rejected).toEqual([
      {
        position: 1,
        claimedIndex: 1,
        issues: [{ path: "actionType", message: expect.stringContaining("Invalid option") }],
        received: { actionType: "click" },
      },
    ]);
    expect(salvageBatchFrames(frames, 3).map((f) => f?.index ?? null)).toEqual([0, null, 2]);
  });

  it("removes an invalid element at position 0 and at the last position", () => {
    const first = validateBatchFrames([raw(0, { legibility: "medium" }), raw(1), raw(2)]);
    expect(salvageBatchFrames(first.frames, 3).map((f) => f?.index ?? null)).toEqual([null, 1, 2]);
    const last = validateBatchFrames([raw(0), raw(1), raw(2, { screenKind: "popup" })]);
    expect(salvageBatchFrames(last.frames, 3).map((f) => f?.index ?? null)).toEqual([0, 1, null]);
    expect(last.rejected[0]).toMatchObject({
      position: 2,
      claimedIndex: 2,
      received: { screenKind: "popup" },
    });
  });

  it("maps an out-of-order response by claimed index, not array position, with one element invalid", () => {
    const { frames } = validateBatchFrames([raw(2), raw(0, { legibility: "medium" }), raw(1)]);
    const salvaged = salvageBatchFrames(frames, 3);
    expect(salvaged.map((f) => f?.index ?? null)).toEqual([null, 1, 2]);
    expect(salvaged[2]!.screenName).toBe("state-2");
  });

  it("rejects a whole batch of invalid elements without throwing", () => {
    const { frames, rejected } = validateBatchFrames([
      raw(0, { actionType: "click" }),
      raw(1, { sameStateAsPrevious: "no" }),
      raw(2, { salienceNote: undefined }),
    ]);
    expect(frames).toEqual([]);
    expect(rejected.map((r) => r.issues.map((i) => i.path))).toEqual([
      ["actionType"],
      ["sameStateAsPrevious"],
      ["salienceNote"],
    ]);
    expect(salvageBatchFrames(frames, 3)).toEqual([null, null, null]);
  });

  it("canonicalizes a case-only mismatch against the declared list, and reports each one", () => {
    const { frames, rejected, canonicalized } = validateBatchFrames([
      raw(0, { actionType: "Tap" }),
      raw(1, { screenKind: "LOGIN", legibility: "High" }),
    ]);
    expect(rejected).toEqual([]);
    expect(frames.map((f) => [f.actionType, f.screenKind, f.legibility])).toEqual([
      ["tap", "product", "high"],
      ["tap", "login", "high"],
    ]);
    expect(canonicalized).toEqual([
      { position: 0, claimedIndex: 0, field: "actionType", received: "Tap", canonical: "tap" },
      { position: 1, claimedIndex: 1, field: "screenKind", received: "LOGIN", canonical: "login" },
      { position: 1, claimedIndex: 1, field: "legibility", received: "High", canonical: "high" },
    ]);
  });

  it("does not canonicalize a value that is not a declared member under any casing", () => {
    const { frames, rejected, canonicalized } = validateBatchFrames([
      raw(0, { actionType: "Click" }),
    ]);
    expect(frames).toEqual([]);
    expect(canonicalized).toEqual([]);
    expect(rejected[0]!.received).toEqual({ actionType: "Click" });
  });

  it("gives a non-object or a non-integer index a null claimedIndex", () => {
    const { frames, rejected } = validateBatchFrames([
      42,
      null,
      "x",
      raw(0, { index: "0" }),
      raw(1, { index: 1.5 }),
    ]);
    expect(rejected.map((r) => [r.position, r.claimedIndex])).toEqual([
      [0, null],
      [1, null],
      [2, null],
      [3, null],
    ]);
    // index is z.number(), so 1.5 is a valid frame — and one salvage cannot
    // place (its existing contract), which the coverage wording then covers.
    expect(frames.map((f) => f.index)).toEqual([1.5]);
    expect(salvageBatchFrames(frames, 3)).toEqual([null, null, null]);
  });

  it("never carries screen text out: an enum slot is quoted only when it holds a token", () => {
    const label = `tap "${SCREEN_TEXT}"`; // the wire does not constrain the slot
    const { rejected, canonicalized } = validateBatchFrames([
      raw(0, { actionType: label, visibleText: [SCREEN_TEXT], screenName: SCREEN_TEXT }),
      raw(1, { visibleText: "not-an-array" }),
      raw(2, { screenKind: "x".repeat(200) }),
      raw(3, { legibility: "Click Now" }),
      raw(4, { actionType: "press-2" }),
    ]);
    const out = JSON.stringify({ rejected, canonicalized });
    expect(out).not.toContain(SCREEN_TEXT);
    expect(out).not.toContain("not-an-array");
    expect(rejected.map((r) => r.received)).toEqual([
      { actionType: `(${label.length} chars, not a token)` },
      {},
      { screenKind: "(200 chars, not a token)" },
      { legibility: "(9 chars, not a token)" },
      { actionType: "press-2" },
    ]);
    expect(rejected[1]!.issues).toEqual([
      { path: "visibleText", message: expect.stringContaining("expected array") },
    ]);
  });
});

describe("parseBatchEnvelope", () => {
  const stop = (stopReason: string | null, text: string | null) => ({ text, stopReason });
  const messageOf = (fn: () => unknown): string => {
    try {
      fn();
    } catch (err) {
      return (err as Error).message;
    }
    return "(did not throw)";
  };

  it("returns the raw entries of a frames envelope, unvalidated", () => {
    expect(parseBatchEnvelope(stop("end_turn", '{"frames":[1,{"index":0}]}'))).toEqual([
      1,
      { index: 0 },
    ]);
  });

  it("throws with the stop_reason and no content when there is no text block", () => {
    expect(messageOf(() => parseBatchEnvelope(stop("refusal", null)))).toBe(
      "analysis: batch response carried no text block (stop_reason: refusal)",
    );
  });

  it("throws with the stop_reason and no content on JSON cut off by max_tokens", () => {
    const cut = `{"frames":[{"index":0,"screenName":"${SCREEN_TEXT}","visibleTe`;
    expect(messageOf(() => parseBatchEnvelope(stop("max_tokens", cut)))).toBe(
      "analysis: batch response is not JSON (stop_reason: max_tokens)",
    );
  });

  it("throws on valid JSON that is not a frames envelope, without echoing it", () => {
    for (const text of [
      '{"other":[]}',
      "[]",
      `{"frames":"${SCREEN_TEXT}"}`,
      "null",
      `"${SCREEN_TEXT}"`,
    ]) {
      expect(messageOf(() => parseBatchEnvelope(stop("end_turn", text)))).toBe(
        "analysis: batch response is not a frames envelope (stop_reason: end_turn)",
      );
    }
  });
});

describe("describeShortfall + correctivePrompt", () => {
  const BASE = "Analyse the 3 frames above.";
  const enumRejection = (claimedIndex: number | null, value = "click"): FrameRejection => ({
    position: 1,
    claimedIndex,
    issues: [{ path: "actionType", message: "Invalid option" }],
    received: { actionType: value },
  });

  it("missing only: the coverage wording, no violation line", () => {
    const s = describeShortfall([frame(0), null, frame(2)], 2, []);
    expect(s).toEqual({ batchLength: 3, returned: 2, unexplained: [1], invalid: [] });
    const prompt = correctivePrompt(BASE, s);
    expect(prompt.startsWith(`${BASE}\n\nYour previous response was not accepted:\n`)).toBe(true);
    expect(prompt).toContain("- It covered only 2 of these 3 frames (2 entries returned).");
    expect(prompt).not.toContain("Frame ");
    expect(
      prompt.endsWith(
        "Return exactly 3 entries, with index 0 through 2 matching the frame labels.",
      ),
    ).toBe(true);
  });

  it("invalid only: names the frame, the field, the received value and the allowed values", () => {
    const s = describeShortfall([frame(0), null, frame(2)], 3, [enumRejection(1)]);
    expect(s.unexplained).toEqual([]);
    expect(s.invalid).toEqual([
      {
        index: 1,
        violations: [`actionType "click" is not an allowed value — use one of ${ALLOWED_ACTIONS}`],
      },
    ]);
    const prompt = correctivePrompt(BASE, s);
    expect(prompt).toContain(
      `- Frame 1: actionType "click" is not an allowed value — use one of ${ALLOWED_ACTIONS}.`,
    );
    expect(prompt).not.toContain("covered only");
  });

  it("both missing and invalid: one message names both", () => {
    const s = describeShortfall([frame(0), null, null, frame(3)], 3, [
      { ...enumRejection(2), position: 2 },
    ]);
    expect(s.unexplained).toEqual([1]);
    expect(s.invalid.map((v) => v.index)).toEqual([2]);
    const prompt = correctivePrompt(BASE, s);
    expect(prompt).toContain("- It covered only 3 of these 4 frames (3 entries returned).");
    expect(prompt).toContain('- Frame 2: actionType "click"');
  });

  it("an unusable or out-of-range claimed index cannot be named and falls under coverage", () => {
    const unusable = describeShortfall([frame(0), null, frame(2)], 3, [enumRejection(null)]);
    expect(unusable).toMatchObject({ unexplained: [1], invalid: [] });
    const outOfRange = describeShortfall([frame(0), null, frame(2)], 3, [enumRejection(7)]);
    expect(outOfRange).toMatchObject({ unexplained: [1], invalid: [] });
    expect(correctivePrompt(BASE, unusable)).not.toContain("Frame ");
  });

  it("a rejection whose position a valid entry filled is neither named nor a hole", () => {
    const s = describeShortfall([frame(0), frame(1), frame(2)], 4, [enumRejection(1)]);
    expect(s).toMatchObject({ unexplained: [], invalid: [] });
  });

  it("a non-token received value is named by field only, never quoted", () => {
    const s = describeShortfall([frame(0), null, frame(2)], 3, [
      enumRejection(1, "(27 chars, not a token)"),
    ]);
    expect(correctivePrompt(BASE, s)).toContain(
      `- Frame 1: actionType is not an allowed value — use one of ${ALLOWED_ACTIONS}.`,
    );
    expect(correctivePrompt(BASE, s)).not.toContain("not a token");
  });

  it("a non-enum violation is named by path and zod message", () => {
    const s = describeShortfall([frame(0), null, frame(2)], 3, [
      {
        position: 1,
        claimedIndex: 1,
        issues: [
          { path: "visibleText.1", message: "Invalid input: expected string, received number" },
        ],
        received: {},
      },
    ]);
    expect(correctivePrompt(BASE, s)).toContain(
      "- Frame 1: visibleText.1: Invalid input: expected string, received number.",
    );
  });
});

describe("transcribeBatch", () => {
  const usage = { inputTokens: 10, outputTokens: 5 };
  const ok = (frames: unknown[], stopReason: RawResult["stopReason"] = "end_turn"): RawResult => ({
    text: JSON.stringify({ frames }),
    stopReason,
    usage,
  });

  /** `answerAlone` answers the fill round's one-image calls by batch position.
   *  Its default is an error, which the fill round swallows by design — so a
   *  test that expects no fill asserts `alone` is empty. */
  function fakeIo(
    responses: (RawResult | Error)[],
    answerAlone: (position: number) => RawResult | Error | Promise<RawResult> = () =>
      new Error("test: unexpected fill"),
  ) {
    const prompts: string[] = [];
    const alone: number[] = [];
    const usages: RawResult["usage"][] = [];
    const warns: { fields: Record<string, unknown>; msg: string }[] = [];
    const io = {
      call: async (prompt: string): Promise<RawResult> => {
        prompts.push(prompt);
        const next = responses.shift();
        if (next === undefined) throw new Error("test: no more responses");
        if (next instanceof Error) throw next;
        return next;
      },
      callAlone: async (position: number): Promise<RawResult> => {
        alone.push(position);
        const next = await answerAlone(position);
        if (next instanceof Error) throw next;
        return next;
      },
      recordUsage: async (u: RawResult["usage"]) => {
        usages.push(u);
      },
      log: {
        warn: (fields: Record<string, unknown>, msg: string) => {
          warns.push({ fields, msg });
        },
      },
    };
    return { io, prompts, alone, usages, warns };
  }

  const run = (
    responses: (RawResult | Error)[],
    batchLength = 3,
    answerAlone?: (position: number) => RawResult | Error | Promise<RawResult>,
  ) => {
    const t = fakeIo(responses, answerAlone);
    const result = transcribeBatch({
      demoId: "demo-1",
      batch: 4,
      batchLength,
      basePrompt: "BASE",
      io: t.io,
    });
    return { ...t, result };
  };

  it("a clean response is one call, one usage row, no warnings", async () => {
    const t = run([ok([raw(0), raw(1), raw(2)])]);
    expect((await t.result).map((f) => f?.index)).toEqual([0, 1, 2]);
    expect(t.prompts).toEqual(["BASE"]);
    expect(t.usages).toEqual([usage]);
    expect(t.warns).toEqual([]);
  });

  it("a casing-only mismatch is canonicalized with NO corrective call", async () => {
    const t = run([ok([raw(0, { actionType: "Tap" }), raw(1, { legibility: "LOW" }), raw(2)])]);
    const frames = await t.result;
    expect(frames.map((f) => [f?.actionType, f?.legibility])).toEqual([
      ["tap", "high"],
      ["tap", "low"],
      ["tap", "high"],
    ]);
    expect(t.prompts).toHaveLength(1);
    expect(t.usages).toHaveLength(1);
    expect(t.warns.map((w) => w.msg)).toEqual([
      "analysis: frame enum canonicalized by case",
      "analysis: frame enum canonicalized by case",
    ]);
    expect(t.warns[0]!.fields).toMatchObject({
      demoId: "demo-1",
      batch: 4,
      claimedIndex: 0,
      field: "actionType",
      received: "Tap",
      canonical: "tap",
    });
  });

  it("one invalid frame buys one corrective call that names the violation; the retry fills it", async () => {
    const t = run([ok([raw(0), raw(1, { actionType: "click" }), raw(2)]), ok([raw(1)])]);
    const frames = await t.result;
    expect(frames.map((f) => f?.index)).toEqual([0, 1, 2]);
    expect(t.prompts).toHaveLength(2);
    expect(t.prompts[1]).toContain(
      `- Frame 1: actionType "click" is not an allowed value — use one of ${ALLOWED_ACTIONS}.`,
    );
    expect(t.prompts[1]).not.toContain("covered only");
    expect(t.usages).toHaveLength(2);
    expect(t.warns.map((w) => w.msg)).toEqual([
      "analysis: frame rejected by the schema — dropped from its batch",
      "analysis: batch response incomplete or invalid — corrective retry",
    ]);
    expect(t.warns[0]!.fields).toMatchObject({
      demoId: "demo-1",
      batch: 4,
      position: 1,
      claimedIndex: 1,
      received: { actionType: "click" },
    });
    expect(t.warns[1]!.fields).toMatchObject({
      sent: 3,
      returned: 3,
      unexplained: [],
      invalid: [1],
    });
  });

  it("a frame still invalid after the retry is re-sent alone, and dropped when that is invalid too; nothing else moves", async () => {
    const t = run(
      [
        ok([raw(0), raw(1, { actionType: "click" }), raw(2)]),
        ok([raw(1, { actionType: "press" })]),
      ],
      3,
      () => ok([raw(0, { actionType: "push" })]),
    );
    expect((await t.result).map((f) => f?.index ?? null)).toEqual([0, null, 2]);
    expect(t.prompts).toHaveLength(2);
    expect(t.alone).toEqual([1]);
    expect(t.usages).toHaveLength(3);
  });

  it("a whole batch of invalid frames is one corrective call naming every frame", async () => {
    const t = run([
      ok([
        raw(0, { actionType: "click" }),
        raw(1, { legibility: "medium" }),
        raw(2, { screenKind: "popup" }),
      ]),
      ok([raw(0), raw(1), raw(2)]),
    ]);
    expect((await t.result).map((f) => f?.index)).toEqual([0, 1, 2]);
    expect(t.prompts).toHaveLength(2);
    expect(t.prompts[1]).toContain("- Frame 0: actionType");
    expect(t.prompts[1]).toContain(
      '- Frame 1: legibility "medium" is not an allowed value — use one of high, low, unreadable.',
    );
    expect(t.prompts[1]).toContain('- Frame 2: screenKind "popup"');
  });

  it("missing and invalid in one batch are named in one message; the merge keeps the first response's good frames", async () => {
    const t = run([ok([raw(0), raw(2, { actionType: "click" })]), ok([raw(1), raw(2)])]);
    const frames = await t.result;
    expect(frames.map((f) => f?.index)).toEqual([0, 1, 2]);
    expect(t.prompts[1]).toContain("- It covered only 2 of these 3 frames (2 entries returned).");
    expect(t.prompts[1]).toContain('- Frame 2: actionType "click"');
  });

  it("an out-of-order response with one invalid element aligns by claimed index across both calls", async () => {
    const t = run([ok([raw(2), raw(0, { legibility: "medium" }), raw(1)]), ok([raw(0)])]);
    const frames = await t.result;
    expect(frames.map((f) => [f?.index, f?.screenName])).toEqual([
      [0, "state-0"],
      [1, "state-1"],
      [2, "state-2"],
    ]);
    expect(t.prompts[1]).toContain("- Frame 0: legibility");
  });

  it("the retry's own response goes through canonicalization and validation too", async () => {
    const t = run([ok([raw(0), raw(2)]), ok([raw(1, { actionType: "TYPE" })])]);
    const frames = await t.result;
    expect(frames.map((f) => [f?.index, f?.actionType])).toEqual([
      [0, "tap"],
      [1, "type"],
      [2, "tap"],
    ]);
  });

  it("a garbage envelope on the first call records its usage, then throws with the stop_reason and no content", async () => {
    const t = run([{ text: `{"frames":"${SCREEN_TEXT}"}`, stopReason: "end_turn", usage }]);
    await expect(t.result).rejects.toThrow(
      "analysis: batch response is not a frames envelope (stop_reason: end_turn)",
    );
    expect(t.usages).toHaveLength(1);
    expect(t.prompts).toHaveLength(1);
  });

  it("a response with no text block records its usage, then throws with the stop_reason", async () => {
    const t = run([{ text: null, stopReason: "refusal", usage }]);
    await expect(t.result).rejects.toThrow("(stop_reason: refusal)");
    expect(t.usages).toHaveLength(1);
  });

  it("JSON cut off by max_tokens records its usage, then throws with the stop_reason", async () => {
    const t = run([
      {
        text: `{"frames":[{"index":0,"screenName":"${SCREEN_TEXT}`,
        stopReason: "max_tokens",
        usage,
      },
    ]);
    await expect(t.result).rejects.toThrow(
      "analysis: batch response is not JSON (stop_reason: max_tokens)",
    );
    expect(t.usages).toHaveLength(1);
  });

  it("a garbage envelope on the corrective call still records both usages", async () => {
    const t = run([ok([raw(0), raw(2)]), { text: "not json", stopReason: "end_turn", usage }]);
    await expect(t.result).rejects.toThrow("(stop_reason: end_turn)");
    expect(t.usages).toHaveLength(2);
  });

  it("a throw from the call itself passes through untouched, with nothing recorded", async () => {
    const budget = new BudgetError("llm_tokens cap");
    const t = run([budget]);
    await expect(t.result).rejects.toBe(budget);
    expect(t.usages).toHaveLength(0);
    expect(t.warns).toEqual([]);
  });

  it("no log field and no prompt ever carries screen text — not even from an enum slot", async () => {
    const t = run(
      [
        ok([
          raw(0, { actionType: "click", screenName: SCREEN_TEXT }),
          raw(1, { action: SCREEN_TEXT }),
          raw(2, { actionType: `tap "${SCREEN_TEXT}"` }),
        ]),
        ok([raw(0, { legibility: SCREEN_TEXT }), raw(2)]),
      ],
      3,
      // The fill of frame 0 puts screen text in an enum slot once more.
      () => ok([raw(0, { screenKind: SCREEN_TEXT, screenName: SCREEN_TEXT })]),
    );
    const frames = await t.result;
    expect(frames.map((f) => f?.index ?? null)).toEqual([null, 1, 2]);
    expect(t.alone).toEqual([0]);
    expect(JSON.stringify(t.warns)).not.toContain(SCREEN_TEXT);
    expect(t.prompts.join("\n")).not.toContain(SCREEN_TEXT);
    expect(t.prompts[1]).toContain("- Frame 2: actionType is not an allowed value");
  });

  describe("the fill round", () => {
    const TEN = Array.from({ length: 10 }, (_, i) => i);
    /** A one-image answer: the model labels its only frame 0. */
    const aloneAnswer = (position: number, overrides: Record<string, unknown> = {}) =>
      ok([raw(0, { screenName: `alone-${position}`, ...overrides })]);
    // Its own prefix: a grep for the drop warn ("batch still short after
    // corrective retry") must not count a batch the fill round recovered.
    const FILL_SUMMARY = "analysis: fill round — re-sent each missing frame alone";

    it("a batch of 10 that collapses to one entry twice re-sends the 9 missing frames alone — all recovered, 11 usage rows", async () => {
      const t = run([ok([raw(0)]), ok([raw(0)])], 10, (p) => aloneAnswer(p));
      const frames = await t.result;
      expect(frames.map((f) => f?.index)).toEqual(TEN);
      expect(frames.map((f) => f?.screenName)).toEqual([
        "state-0",
        ...TEN.slice(1).map((p) => `alone-${p}`),
      ]);
      expect(frames.map((f) => f?.filledAlone ?? false)).toEqual([false, ...Array(9).fill(true)]);
      expect(t.prompts).toHaveLength(2); // the first call and the corrective, whole-batch
      expect(t.alone).toEqual(TEN.slice(1));
      expect(t.usages).toHaveLength(11);
      expect(t.warns.map((w) => w.msg)).toEqual([
        "analysis: batch response incomplete or invalid — corrective retry",
        FILL_SUMMARY,
      ]);
      // The shape of 6548af7e's batch 2 in the worker journal (2026-09-27).
      expect(t.warns[0]!.fields).toMatchObject({
        sent: 10,
        returned: 1,
        unexplained: TEN.slice(1),
        invalid: [],
      });
      expect(t.warns[1]!.fields).toEqual({
        demoId: "demo-1",
        batch: 4,
        sent: 10,
        missing: 9,
        recovered: 9,
      });
    });

    it("a fill that returns nothing, an invalid frame or another index stays null; the others are recovered", async () => {
      const t = run([ok([raw(0)]), ok([raw(0)])], 5, (p) =>
        p === 1
          ? ok([])
          : p === 2
            ? ok([raw(0, { actionType: "click" })])
            : p === 3
              ? ok([raw(1)]) // no frame 1 in a one-image batch
              : aloneAnswer(p),
      );
      const frames = await t.result;
      expect(frames.map((f) => f?.index ?? null)).toEqual([0, null, null, null, 4]);
      expect(frames[4]!.filledAlone).toBe(true);
      expect(t.alone).toEqual([1, 2, 3, 4]); // one attempt each: no fill is retried
      expect(t.usages).toHaveLength(6);
      const rejected = t.warns.find((w) => w.msg.startsWith("analysis: frame rejected"))!;
      expect(rejected.fields).toMatchObject({
        demoId: "demo-1",
        batch: 4,
        fillPosition: 2,
        position: 0,
        claimedIndex: 0,
        received: { actionType: "click" },
      });
      expect(t.warns.at(-1)!).toEqual({
        msg: FILL_SUMMARY,
        fields: { demoId: "demo-1", batch: 4, sent: 5, missing: 4, recovered: 1 },
      });
    });

    it("no fill call when the first call or the corrective retry completes the batch", async () => {
      const clean = run([ok([raw(0), raw(1), raw(2)])]);
      await clean.result;
      expect(clean.alone).toEqual([]);
      const corrected = run([ok([raw(0)]), ok([raw(1), raw(2)])]);
      expect((await corrected.result).map((f) => f?.filledAlone ?? false)).toEqual([
        false,
        false,
        false,
      ]);
      expect(corrected.alone).toEqual([]);
      expect(corrected.usages).toHaveLength(2);
      expect(corrected.warns.map((w) => w.msg)).not.toContain(FILL_SUMMARY);
    });

    it("fill calls run in parallel: every fill is in flight before any returns", async () => {
      // Each answer waits until all 9 fills have started — a sequential fill
      // round would wait on its first call forever and time out.
      let started = 0;
      let allStarted!: () => void;
      const gate = new Promise<void>((resolve) => (allStarted = resolve));
      const t = run([ok([raw(0)]), ok([raw(0)])], 10, async (p) => {
        if (++started === 9) allStarted();
        await gate;
        return aloneAnswer(p);
      });
      expect((await t.result).every((f) => f !== null)).toBe(true);
      expect(started).toBe(9);
    });

    it("spend bound: one call per position still empty after the corrective retry, never retried — a batch of 10 that returns nothing buys 2 + 10 calls", async () => {
      const t = run([ok([]), ok([])], 10, () => ok([]));
      expect(await t.result).toEqual(Array(10).fill(null));
      expect(t.prompts).toHaveLength(2);
      expect(t.alone).toEqual(TEN);
      expect(t.usages).toHaveLength(12);
      expect(t.warns.at(-1)!.fields).toMatchObject({ sent: 10, missing: 10, recovered: 0 });
    });

    it("a fill with a transient error or a garbage envelope stays null without throwing, logged with its position and no content", async () => {
      const t = run([ok([raw(0)]), ok([raw(0)])], 4, (p) =>
        p === 1
          ? new Error("529 overloaded")
          : p === 2
            ? { text: `{"frames":"${SCREEN_TEXT}"}`, stopReason: "end_turn", usage }
            : aloneAnswer(p),
      );
      expect((await t.result).map((f) => f?.index ?? null)).toEqual([0, null, null, 3]);
      // The thrown call recorded nothing; the garbage one was billed and is in the ledger.
      expect(t.usages).toHaveLength(2 + 2);
      expect(
        t.warns
          .filter((w) => w.msg === "analysis: fill call failed — position stays empty")
          .map((w) => w.fields),
      ).toEqual([
        { demoId: "demo-1", batch: 4, fillPosition: 1, err: "529 overloaded" },
        {
          demoId: "demo-1",
          batch: 4,
          fillPosition: 2,
          err: "analysis: batch response is not a frames envelope (stop_reason: end_turn)",
        },
      ]);
      expect(JSON.stringify(t.warns)).not.toContain(SCREEN_TEXT);
      expect(t.warns.at(-1)!.fields).toMatchObject({ missing: 3, recovered: 1 });
    });

    it("a fill with BudgetError throws it — only after every fill has settled, so no billed call escapes the ledger", async () => {
      const budget = new BudgetError("llm_tokens cap");
      const t = run([ok([raw(0)]), ok([raw(0)])], 4, (p) =>
        p === 2
          ? budget
          : // A sibling still in flight when the budget refusal lands.
            new Promise<RawResult>((resolve) => setTimeout(() => resolve(aloneAnswer(p)), 20)),
      );
      await expect(t.result).rejects.toBe(budget);
      expect(t.alone).toEqual([1, 2, 3]);
      expect(t.usages).toHaveLength(2 + 2);
      expect(t.warns.map((w) => w.msg)).not.toContain(FILL_SUMMARY);
    });

    it("the checkpoint round-trips the provenance; one written before the fill round resumes as not filled alone", async () => {
      // Batch 0 collapses to frame 0 twice; 1 and 2 come back alone, the model
      // claiming "same" with no neighbour to compare against.
      const t = run([ok([raw(0)]), ok([raw(0)])], 3, (p) =>
        aloneAnswer(p, { sameStateAsPrevious: true }),
      );
      // What saveCheckpoint writes to jobs.state and a resume reads back.
      const json = JSON.stringify({ 0: await t.result, 1: [frame(0), frame(1)] });
      const checkpoint = JSON.parse(json) as Record<string, (TranscribedFrame | null)[]>;
      expect(checkpoint[0]!.map((f) => f?.filledAlone ?? null)).toEqual([null, true, true]);
      // A frame transcribed in its batch is stored exactly as before the fill round.
      expect(Object.keys(checkpoint[0]![0]!)).not.toContain("filledAlone");
      // DISTINCT hashes: read back as filled alone, dHash overrules the model's "same".
      expect(assemble(checkpoint).assembled.map((s) => s.sameStateAsPrevious)).toEqual([
        false,
        false,
        false,
        false,
        false,
      ]);
      // The same frames without provenance — a pre-fill-round checkpoint —
      // resume as transcribed in their batch: adjacent, so the flag is trusted.
      const old = JSON.parse(json.replace(/,"filledAlone":true/g, "")) as Record<
        string,
        (TranscribedFrame | null)[]
      >;
      expect(JSON.stringify(old)).not.toContain("filledAlone");
      expect(assemble(old).assembled.map((s) => s.sameStateAsPrevious)).toEqual([
        false,
        true,
        true,
        false,
        false,
      ]);
    });
  });
});

describe("assembleTimeline — a frame filled alone is decided by dHash, never by its flag", () => {
  const filledAlone = (index: number, overrides: Partial<BatchFrame> = {}): TranscribedFrame => ({
    ...frame(index, overrides),
    filledAlone: true,
  });

  it("flagged same, hashes far apart: a split", () => {
    // Beside its neighbour, adjacent, the flag is trusted — the model saw both frames...
    const inBatch = assemble({
      0: [frame(0), frame(1, { sameStateAsPrevious: true }), frame(2)],
      1: [frame(0), frame(1)],
    });
    expect(inBatch.assembled[1]!.sameStateAsPrevious).toBe(true);
    // ...filled alone, the same flag says nothing: 20 bits apart, so false.
    const alone = assemble({
      0: [frame(0), filledAlone(1, { sameStateAsPrevious: true }), frame(2)],
      1: [frame(0), frame(1)],
    });
    expect(alone.assembled[1]!.sameStateAsPrevious).toBe(false);
  });

  it("not flagged, hashes close: a repeat", () => {
    const g1LikeG0 = [h(0), h(0), h(40), h(60), h(20) << 40n];
    // Beside its neighbour an equal hash does not override the flag...
    const inBatch = assemble(
      { 0: [frame(0), frame(1), frame(2)], 1: [frame(0), frame(1)] },
      g1LikeG0,
    );
    expect(inBatch.assembled[1]!.sameStateAsPrevious).toBe(false);
    // ...filled alone, the hash decides.
    const alone = assemble(
      { 0: [frame(0), filledAlone(1), frame(2)], 1: [frame(0), frame(1)] },
      g1LikeG0,
    );
    expect(alone.assembled[1]!.sameStateAsPrevious).toBe(true);
  });

  it("at a batch boundary the flag is not ORed in, as the boundary rule does for a frame from its batch", () => {
    // g=3 is position 0 of batch 1, adjacent to g=2, 20 bits apart.
    const fromBatch = assemble({
      0: [frame(0), frame(1), frame(2)],
      1: [frame(0, { sameStateAsPrevious: true }), frame(1)],
    });
    expect(fromBatch.assembled[3]!.sameStateAsPrevious).toBe(true);
    const alone = assemble({
      0: [frame(0), frame(1), frame(2)],
      1: [filledAlone(0, { sameStateAsPrevious: true }), frame(1)],
    });
    expect(alone.assembled[3]!.sameStateAsPrevious).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The wire
// ---------------------------------------------------------------------------

/**
 * The bytes every vision batch call puts under output_config.format — pinned
 * so a change to the model-facing schema (a grammar recompile and a prompt
 * cache invalidation) is a deliberate edit here, never a side effect. The
 * three enums are keywords of the decoding grammar (strictOutputFormat);
 * everything else is exactly what the SDK's transform (0.111.0) emits, the
 * root $schema fold included. Measured 2026-09-20: the folded wire returned
 * an out-of-enum value on request, this one refused it — vault
 * facts/sdk-folds-enum-and-const-into-description.
 */
const BATCH_WIRE = String.raw`{"type":"json_schema","schema":{"type":"object","properties":{"frames":{"type":"array","items":{"type":"object","properties":{"index":{"type":"number"},"screenName":{"type":"string"},"visibleText":{"type":"array","items":{"type":"string"}},"action":{"type":"string"},"actionType":{"type":"string","enum":["navigate","tap","type","select","scroll","result","idle"]},"screenKind":{"type":"string","enum":["product","login","loading","onboarding","error","tour","system","other"]},"sameStateAsPrevious":{"type":"boolean"},"legibility":{"type":"string","enum":["high","low","unreadable"]},"salienceNote":{"anyOf":[{"type":"string"},{"type":"null"}]}},"additionalProperties":false,"required":["index","screenName","visibleText","action","actionType","screenKind","sameStateAsPrevious","legibility","salienceNote"]}}},"additionalProperties":false,"required":["frames"],"description":"{$schema: \"https://json-schema.org/draft/2020-12/schema\"}"}}`;

/** The API's documented supported set for structured-output schemas. A keyword
 *  outside it on the wire is a 400 on the box; this guard turns a future
 *  schema edit red here instead. */
const SUPPORTED_KEYWORDS = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "minItems",
  "anyOf",
  "allOf",
  "$ref",
  "$defs",
  "definitions",
  "enum",
  "const",
  "default",
  "format",
  "description",
  "title",
]);
const SUPPORTED_FORMATS = new Set([
  "date-time",
  "time",
  "date",
  "duration",
  "email",
  "hostname",
  "uri",
  "ipv4",
  "ipv6",
  "uuid",
]);

/** Walk every schema node, yielding it with its path — `properties`/`$defs`
 *  values are names, not keywords, and are stepped over. */
function* schemaNodes(
  node: Record<string, unknown>,
  path = "$",
): Generator<[string, Record<string, unknown>]> {
  yield [path, node];
  for (const [key, value] of Object.entries(node)) {
    if ((key === "properties" || key === "$defs" || key === "definitions") && value) {
      for (const [name, sub] of Object.entries(value as Record<string, unknown>)) {
        yield* schemaNodes(sub as Record<string, unknown>, `${path}.${key}.${name}`);
      }
    } else if ((key === "anyOf" || key === "allOf") && Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        yield* schemaNodes(value[i] as Record<string, unknown>, `${path}.${key}[${i}]`);
      }
    } else if (key === "items" && value) {
      yield* schemaNodes(value as Record<string, unknown>, `${path}.items`);
    }
  }
}

describe("the batch wire format", () => {
  it("is byte-identical to the pinned bytes", () => {
    expect(JSON.stringify(batchWireFormat())).toBe(BATCH_WIRE);
  });

  it("carries no parse callback — the caller owns validation", () => {
    expect(Object.keys(batchWireFormat())).toEqual(["type", "schema"]);
  });

  it("uses only keywords the API supports, and no enum or const is left as description prose", () => {
    const seenEnums: string[] = [];
    for (const [path, node] of schemaNodes(batchWireFormat().schema)) {
      for (const [key, value] of Object.entries(node)) {
        expect(SUPPORTED_KEYWORDS.has(key), `${path}.${key} is not a supported keyword`).toBe(true);
        if (key === "format") expect(SUPPORTED_FORMATS.has(value as string)).toBe(true);
        if (key === "minItems") expect([0, 1]).toContain(value);
        if (key === "description") {
          // The SDK's fold is "{k: json, k: json}" — an enum can sit after a
          // comma, and a folded sub-schema carries it JSON-quoted.
          expect(value as string, `${path} folds a keyword into prose`).not.toMatch(
            /[{,]\s*(enum|const):|"(enum|const)":/,
          );
        }
        if (key === "enum") seenEnums.push(path);
      }
      if (node.type === "object") expect(node.additionalProperties).toBe(false);
    }
    expect(seenEnums).toEqual([
      "$.properties.frames.items.properties.actionType",
      "$.properties.frames.items.properties.screenKind",
      "$.properties.frames.items.properties.legibility",
    ]);
  });
});

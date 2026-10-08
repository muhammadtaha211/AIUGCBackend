import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Hoisted so the module factory below can close over it: generateTextBlocks
// reaches the real Claude call on the non-DRY_RUN path, and the retry is the
// behaviour under test.
const generateObject = vi.hoisted(() => vi.fn());
vi.mock("../src/providers/anthropic", () => ({
  generateObject,
  CLAUDE_MODEL: "claude-sonnet-5-5",
}));

import { eq } from "drizzle-orm";
import { resetEnvCache } from "../src/config";
import type { Db } from "../src/db";
import * as schema from "../src/db/schema";
import { createBusiness, setQuestionnaire } from "../src/pipelines/businesses";
import { generateTextBlocks, textBlockBatchProblem } from "../src/pipelines/copy";
import { TEXT_BLOCK_EXAMPLES, TEXT_BLOCK_SKELETON_IDS } from "../src/text-block";
import { createTestDb } from "./helpers/pglite";

/**
 * generateTextBlocks (decisions 0090–0091): one scripts row per text the model
 * returns, in the clip's speaker gender, with the text check run on the batch
 * and one re-request on a violation. The prompt is rendered on both paths so
 * prompt_version is always `text_block@v<N>`.
 */

const RECT = { x: 80, y: 360, w: 820, h: 1040 };

function batch(
  texts: { skeleton: string; text: string }[],
  skipped: { skeleton: string; reason: string }[] = [],
) {
  return { object: { texts, skipped }, usage: { inputTokens: 2000, outputTokens: 900 } };
}

const CLEAN = [
  { skeleton: "reframe", text: "לנהל עסק נשמע פשוט, עד שמבינים שהלקוחות כותבים ב-8 בערב." },
  { skeleton: "instead", text: "אל תענו ידנית. במקום זה תנו ל-Tavnit לענות, וזה מסתכם." },
];

describe("textBlockBatchProblem", () => {
  it("passes a clean batch and names the first problem otherwise", () => {
    expect(textBlockBatchProblem(CLEAN)).toBeUndefined();
    expect(textBlockBatchProblem([])).toBe("the batch is empty");
    expect(textBlockBatchProblem([{ skeleton: "pov_scene", text: "שלום" }])).toMatch(
      /unknown skeleton "pov_scene"/,
    );
    expect(textBlockBatchProblem([CLEAN[0]!, CLEAN[0]!])).toMatch(/"reframe" appears twice/);
    expect(textBlockBatchProblem([{ skeleton: "quiz", text: "שאלה — תשובה" }])).toBe(
      "quiz: a long dash (U+2014) where a plain hyphen belongs",
    );
    expect(textBlockBatchProblem([{ skeleton: "quiz", text: "שאלה – תשובה" }])).toBe(
      "quiz: a long dash (U+2013) where a plain hyphen belongs",
    );
    expect(textBlockBatchProblem([{ skeleton: "quiz", text: "שאלה 🔥" }])).toMatch(
      /^quiz: .*U\+1F525/,
    );
    expect(textBlockBatchProblem([{ skeleton: "quiz", text: "א".repeat(450) }])).toBeUndefined();
    expect(textBlockBatchProblem([{ skeleton: "quiz", text: "א".repeat(451) }])).toMatch(
      /^quiz: .*451/,
    );
  });

  it("passes all ten founder examples as a generated batch: every one obeys the generation rules", () => {
    expect(
      textBlockBatchProblem(
        TEXT_BLOCK_SKELETON_IDS.map((skeleton) => ({
          skeleton,
          text: TEXT_BLOCK_EXAMPLES[skeleton],
        })),
      ),
    ).toBeUndefined();
  });
});

describe("generateTextBlocks (real DB, mocked Claude)", () => {
  let db: Db;
  let pg: { close(): Promise<void> };
  let businessId: string;
  let clipId: string;
  let maleClipId: string;

  beforeAll(async () => {
    delete process.env.DRY_RUN;
    resetEnvCache();
    const testDb = await createTestDb();
    db = testDb.db;
    pg = testDb.pg;
    const business = await createBusiness(db, {
      ownerEmail: "founder@example.com",
      name: "תבנית",
      ownerRole: "admin",
    });
    businessId = business.id;
    await setQuestionnaire(db, businessId, {
      category: "app_or_digital",
      product_name: "Tavnit",
      what_it_does: "מייצר סרטוני פרסום בעברית מהדמו של העסק",
      advantages: ["סרטון תוך דקות", "בלי צלם"],
      target_audience: "בעלי עסקים קטנים",
      tone: "friendly",
    });
    const [clip] = await db
      .insert(schema.textBlockClips)
      .values({
        filePath: "assets/bank/text_block_clip/a/clip.mp4",
        durationMs: 10_000,
        speakerGender: "female",
        textSafeArea: RECT,
      })
      .returning();
    clipId = clip!.id;
    const [male] = await db
      .insert(schema.textBlockClips)
      .values({
        filePath: "assets/bank/text_block_clip/b/clip.mp4",
        durationMs: 8_000,
        speakerGender: "male",
        textSafeArea: RECT,
        active: false,
      })
      .returning();
    maleClipId = male!.id;
  });

  afterAll(async () => {
    await pg.close();
  });

  it("stores one text_block row per returned text, with the skeleton, the clip and the gender on params; skipped comes back unstored", async () => {
    generateObject
      .mockReset()
      .mockResolvedValueOnce(batch(CLEAN, [{ skeleton: "quiz", reason: "אין על מה לשאול" }]));

    const result = await generateTextBlocks(db, { businessId, clipId });

    expect(generateObject).toHaveBeenCalledTimes(1);
    const call = generateObject.mock.calls[0]![0] as {
      prompt: string;
      maxTokens?: number;
      thinking?: string;
    };
    expect(call.prompt).toContain("The speaker is female");
    expect(call.prompt).toContain('"product_name": "Tavnit"');
    expect(call.maxTokens).toBe(8192);
    // No setting, so the wrapper's default: thinking off (vault 0095).
    expect(call.thinking).toBeUndefined();

    expect(result.texts).toHaveLength(2);
    expect(result.texts.map((r) => r.kind)).toEqual(["text_block", "text_block"]);
    expect(result.texts[0]).toMatchObject({
      businessId,
      text: CLEAN[0]!.text,
      promptVersion: "text_block@v2",
      userEdited: false,
      params: { skeleton: "reframe", textBlockClipId: clipId, speakerGender: "female" },
    });
    expect(result.skipped).toEqual([{ skeleton: "quiz", reason: "אין על מה לשאול" }]);
    const stored = await db
      .select()
      .from(schema.scripts)
      .where(eq(schema.scripts.businessId, businessId));
    expect(stored).toHaveLength(2);
  });

  it("an em dash triggers exactly one retry with the same prompt, and the clean retry is what lands", async () => {
    const dirty = [{ skeleton: "reframe", text: "קשה — עד שמבינים" }];
    generateObject
      .mockReset()
      .mockResolvedValueOnce(batch(dirty))
      .mockResolvedValueOnce(batch(CLEAN));

    const result = await generateTextBlocks(db, { businessId, clipId });

    expect(generateObject).toHaveBeenCalledTimes(2);
    expect(generateObject.mock.calls[0]![0].prompt).toBe(generateObject.mock.calls[1]![0].prompt);
    expect(result.texts.map((r) => r.text)).toEqual(CLEAN.map((t) => t.text));
    expect(result.texts.some((r) => r.text.includes("—"))).toBe(false);
  });

  it("the thinking test's low setting reaches the first call and the retry alike", async () => {
    generateObject
      .mockReset()
      .mockResolvedValueOnce(batch([{ skeleton: "reframe", text: "קשה — עד שמבינים" }]))
      .mockResolvedValueOnce(batch(CLEAN));

    await generateTextBlocks(db, { businessId, clipId, thinking: "low" });

    expect(generateObject.mock.calls.map((c) => c[0].thinking)).toEqual(["low", "low"]);
  });

  it("an en dash twice fails the batch: the dash is refused on generated text, retried once, then raised", async () => {
    const before = (await db.select().from(schema.scripts)).length;
    generateObject
      .mockReset()
      .mockResolvedValue(batch([{ skeleton: "reframe", text: "קשה – עד שמבינים" }]));

    await expect(generateTextBlocks(db, { businessId, clipId })).rejects.toThrow(
      /failed the text check \(reframe: a long dash \(U\+2013\).*recurred/,
    );
    expect(generateObject).toHaveBeenCalledTimes(2);
    expect((await db.select().from(schema.scripts)).length).toBe(before);
  });

  it("a second failure raises, naming the problem, and inserts nothing", async () => {
    const before = (await db.select().from(schema.scripts)).length;
    generateObject.mockReset().mockResolvedValue(batch([{ skeleton: "nope", text: "שלום" }]));

    await expect(generateTextBlocks(db, { businessId, clipId })).rejects.toThrow(
      /unknown skeleton "nope".*recurred/,
    );
    expect(generateObject).toHaveBeenCalledTimes(2);
    expect((await db.select().from(schema.scripts)).length).toBe(before);
  });

  it("refuses an inactive clip before any call, and a missing one", async () => {
    generateObject.mockReset();
    await expect(generateTextBlocks(db, { businessId, clipId: maleClipId })).rejects.toThrow(
      /is not active/,
    );
    await expect(
      generateTextBlocks(db, { businessId, clipId: "00000000-0000-0000-0000-000000000009" }),
    ).rejects.toThrow(/not found/);
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("writes in the clip's gender: a male clip puts 'The speaker is male' in the prompt", async () => {
    await db
      .update(schema.textBlockClips)
      .set({ active: true })
      .where(eq(schema.textBlockClips.id, maleClipId));
    generateObject.mockReset().mockResolvedValueOnce(batch(CLEAN));

    const result = await generateTextBlocks(db, { businessId, clipId: maleClipId });

    expect(generateObject.mock.calls[0]![0].prompt).toContain("The speaker is male");
    expect(result.texts[0]!.params).toMatchObject({ speakerGender: "male" });
  });

  it("DRY_RUN stores the ten founder examples, keyed by skeleton, with the real prompt version", async () => {
    process.env.DRY_RUN = "1";
    resetEnvCache();
    try {
      generateObject.mockReset();
      const result = await generateTextBlocks(db, { businessId, clipId });
      expect(generateObject).not.toHaveBeenCalled();
      expect(result.texts).toHaveLength(10);
      expect(result.skipped).toEqual([]);
      for (const [i, id] of TEXT_BLOCK_SKELETON_IDS.entries()) {
        expect(result.texts[i]!.text).toBe(TEXT_BLOCK_EXAMPLES[id]);
        expect((result.texts[i]!.params as { skeleton: string }).skeleton).toBe(id);
        expect(result.texts[i]!.promptVersion).toBe("text_block@v2");
      }
    } finally {
      delete process.env.DRY_RUN;
      resetEnvCache();
    }
  });
});

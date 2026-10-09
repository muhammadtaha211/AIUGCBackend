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
import {
  generateTextBlocks,
  TEXT_BLOCK_NO_WOW_REASON,
  textBlockBatchProblem,
} from "../src/pipelines/copy";
import { TEXT_BLOCK_EXAMPLES, TEXT_BLOCK_SKELETON_IDS } from "../src/text-block";
import { createTestDb } from "./helpers/pglite";

/**
 * generateTextBlocks (decisions 0090–0091): one scripts row per text the model
 * returns, in the clip's speaker gender, with the text check run on the batch
 * and one re-request on a violation. The prompt is rendered on both paths so
 * prompt_version is always `text_block@v<N>`. Only the fitting skeletons are
 * requested (v3's `{{skeletons}}`: never `discovery` without a `wow`), and an
 * entry the batch did not ask for is dropped before the checks (decision 0099).
 */

const RECT = { x: 80, y: 360, w: 820, h: 1040 };

/** What a questionnaire with no `wow` requests: the bank less `discovery`, in bank order. */
const NO_WOW = TEXT_BLOCK_SKELETON_IDS.filter((id) => id !== "discovery");

/** The `{{skeletons}}` list as the rendered prompt carries it. */
function requestedIn(prompt: string): string | undefined {
  return /This batch requests these skeletons, and only these: (.*)\. Write nothing/.exec(
    prompt,
  )?.[1];
}

const asList = (ids: readonly string[]) => ids.map((id) => `\`${id}\``).join(", ");

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
  let wowBusinessId: string;
  let clipId: string;
  let maleClipId: string;

  /** The business row's questionnaire stamp, as a batch pins it on params. */
  async function stampOf(id: string): Promise<string> {
    const row = (await db.select().from(schema.businesses).where(eq(schema.businesses.id, id)))[0]!;
    return row.questionnaireUpdatedAt!.toISOString();
  }

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
    const wowBusiness = await createBusiness(db, {
      ownerEmail: "founder@example.com",
      name: "שבילו",
      ownerRole: "admin",
    });
    wowBusinessId = wowBusiness.id;
    await setQuestionnaire(db, wowBusinessId, {
      category: "app_or_digital",
      product_name: "Shvilo",
      what_it_does: "מראה כל מסלול טיול בצפון בצילום אמיתי",
      advantages: ["רואים את המסלול לפני שיוצאים"],
      target_audience: "מטיילים",
      tone: "friendly",
      wow: "רואים כל מטר של המסלול עוד מהבית",
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
    const call = generateObject.mock.calls[0]![0] as { prompt: string; maxTokens?: number };
    expect(call.prompt).toContain("The speaker is female");
    expect(call.prompt).toContain('"product_name": "Tavnit"');
    expect(call.maxTokens).toBe(8192);

    expect(result.texts).toHaveLength(2);
    expect(result.texts.map((r) => r.kind)).toEqual(["text_block", "text_block"]);
    expect(result.texts[0]).toMatchObject({
      businessId,
      text: CLEAN[0]!.text,
      promptVersion: "text_block@v3",
      userEdited: false,
      params: {
        skeleton: "reframe",
        textBlockClipId: clipId,
        speakerGender: "female",
        questionnaireUpdatedAt: await stampOf(businessId),
      },
    });
    // The fixture has no `wow`: discovery was never requested, and the admin
    // studio still sees why, with the model's own skips first.
    expect(result.skipped).toEqual([
      { skeleton: "quiz", reason: "אין על מה לשאול" },
      { skeleton: "discovery", reason: TEXT_BLOCK_NO_WOW_REASON },
    ]);
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

  it("requests only the fitting skeletons: without a wow the list omits discovery and keeps the other nine in bank order", async () => {
    generateObject.mockReset().mockResolvedValueOnce(batch(CLEAN));

    await generateTextBlocks(db, { businessId, clipId });

    expect(NO_WOW).toHaveLength(9);
    expect(requestedIn(generateObject.mock.calls[0]![0].prompt)).toBe(asList(NO_WOW));
  });

  it("with a wow all ten are requested, and nothing is added to skipped", async () => {
    generateObject.mockReset().mockResolvedValueOnce(batch(CLEAN));

    const result = await generateTextBlocks(db, { businessId: wowBusinessId, clipId });

    expect(requestedIn(generateObject.mock.calls[0]![0].prompt)).toBe(
      asList(TEXT_BLOCK_SKELETON_IDS),
    );
    expect(result.skipped).toEqual([]);
    expect(result.texts[0]!.params).toMatchObject({
      questionnaireUpdatedAt: await stampOf(wowBusinessId),
    });
  });

  it("drops an entry for a known skeleton the batch never asked for (discovery without a wow): not stored, no retry", async () => {
    const before = (
      await db.select().from(schema.scripts).where(eq(schema.scripts.businessId, businessId))
    ).length;
    generateObject
      .mockReset()
      .mockResolvedValueOnce(
        batch([...CLEAN, { skeleton: "discovery", text: TEXT_BLOCK_EXAMPLES.discovery }]),
      );

    const result = await generateTextBlocks(db, { businessId, clipId });

    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(result.texts.map((r) => (r.params as { skeleton: string }).skeleton)).toEqual([
      "reframe",
      "instead",
    ]);
    const stored = await db
      .select()
      .from(schema.scripts)
      .where(eq(schema.scripts.businessId, businessId));
    expect(stored).toHaveLength(before + 2);
    expect(stored.some((r) => (r.params as { skeleton?: string }).skeleton === "discovery")).toBe(
      false,
    );
  });

  it("drops an entry the model also listed in skipped: a hedged answer is a skip", async () => {
    generateObject
      .mockReset()
      .mockResolvedValueOnce(batch(CLEAN, [{ skeleton: "instead", reason: "לא בטוח שמתאים" }]));

    const result = await generateTextBlocks(db, { businessId, clipId });

    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(result.texts.map((r) => r.text)).toEqual([CLEAN[0]!.text]);
    expect(result.skipped).toEqual([
      { skeleton: "instead", reason: "לא בטוח שמתאים" },
      { skeleton: "discovery", reason: TEXT_BLOCK_NO_WOW_REASON },
    ]);
  });

  it("an UNKNOWN skeleton is still a violation: one retry, and the clean retry is what lands", async () => {
    generateObject
      .mockReset()
      .mockResolvedValueOnce(batch([...CLEAN, { skeleton: "pov_scene", text: "שלום" }]))
      .mockResolvedValueOnce(batch(CLEAN));

    const result = await generateTextBlocks(db, { businessId, clipId });

    expect(generateObject).toHaveBeenCalledTimes(2);
    expect(result.texts.map((r) => r.text)).toEqual(CLEAN.map((t) => t.text));
  });

  it("DRY_RUN stores the founder example of every requested skeleton, keyed by skeleton, with the real prompt version", async () => {
    process.env.DRY_RUN = "1";
    resetEnvCache();
    try {
      generateObject.mockReset();
      const result = await generateTextBlocks(db, { businessId, clipId });
      expect(generateObject).not.toHaveBeenCalled();
      // No wow: nine, discovery absent and listed as skipped.
      expect(result.texts).toHaveLength(9);
      expect(result.skipped).toEqual([{ skeleton: "discovery", reason: TEXT_BLOCK_NO_WOW_REASON }]);
      for (const [i, id] of NO_WOW.entries()) {
        expect(result.texts[i]!.text).toBe(TEXT_BLOCK_EXAMPLES[id]);
        expect((result.texts[i]!.params as { skeleton: string }).skeleton).toBe(id);
        expect(result.texts[i]!.promptVersion).toBe("text_block@v3");
      }

      const withWow = await generateTextBlocks(db, { businessId: wowBusinessId, clipId });
      expect(withWow.skipped).toEqual([]);
      expect(withWow.texts.map((r) => (r.params as { skeleton: string }).skeleton)).toEqual([
        ...TEXT_BLOCK_SKELETON_IDS,
      ]);
    } finally {
      delete process.env.DRY_RUN;
      resetEnvCache();
    }
  });
});

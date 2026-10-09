import { and, eq, isNotNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted so the factory can close over it: only the "nothing servable" case
// leaves DRY_RUN, and what the model returns there is the behaviour under test.
const generateObject = vi.hoisted(() => vi.fn());
vi.mock("../src/providers/anthropic", () => ({
  generateObject,
  CLAUDE_MODEL: "claude-sonnet-5-5",
}));

// Wrapped, not replaced: the real batch runs, and the spy counts the calls —
// "one batch, then served from stock" is what this file pins.
vi.mock("../src/pipelines/copy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/pipelines/copy")>();
  return { ...actual, generateTextBlocks: vi.fn(actual.generateTextBlocks) };
});

import { AccountBudgetError, recordUsage } from "../src/budget";
import { resetEnvCache } from "../src/config";
import type { Db } from "../src/db";
import * as schema from "../src/db/schema";
import { addPersona, updatePersona } from "../src/pipelines/bank";
import { createBusiness, getBusiness, setQuestionnaire } from "../src/pipelines/businesses";
import { generateTextBlocks } from "../src/pipelines/copy";
import { serveNextTextBlock, TextBlockStockEmptyError } from "../src/pipelines/text-blocks";
import { TEXT_BLOCK_EXAMPLES, TEXT_BLOCK_SKELETON_IDS } from "../src/text-block";
import { createTestDb } from "./helpers/pglite";

/**
 * serveNextTextBlock, the customer wizard's "another text" (decision 0099,
 * R2): one model call writes every fitting structure, the wizard shows the
 * stored texts one at a time, and the rotation — the structure this business
 * has gone longest without seeing — is server state that outlives a visit.
 *
 * Everything runs against CUSTOMER businesses (the clip refusals and the
 * per-account cap are what an admin-owned fixture would skip), each on its own
 * owner account so one test's usage and stock never reach the next.
 */

let db: Db;
let pg: { close(): Promise<void> };
let femaleClipId: string;
let secondFemaleClipId: string;
let maleClipId: string;
let femalePersonaId: string;

const RECT = { x: 80, y: 360, w: 820, h: 1040 };

const QUESTIONNAIRE = {
  category: "app_or_digital" as const,
  product_name: "Tavnit",
  what_it_does: "מייצר סרטוני פרסום בעברית מהדמו של העסק",
  advantages: ["סרטון תוך דקות", "בלי צלם"],
  target_audience: "בעלי עסקים קטנים",
  tone: "friendly" as const,
};
const WITH_WOW = { ...QUESTIONNAIRE, wow: "סרטון מוכן לפני שהקפה מתקרר" };

/** What a questionnaire with no `wow` requests: the bank less `discovery`, in bank order. */
const NO_WOW = TEXT_BLOCK_SKELETON_IDS.filter((id) => id !== "discovery");

/** The shipped per-account LLM cap (0040), as authz-12-llm-caps burns it. */
const PER_ACCOUNT_LLM_CAP = 500_000;

const skeletonOf = (row: { params: unknown }) => (row.params as { skeleton: string }).skeleton;
const batches = () => vi.mocked(generateTextBlocks).mock.calls.length;

async function customer(email: string, questionnaire: object = QUESTIONNAIRE): Promise<string> {
  const business = await createBusiness(db, { ownerEmail: email, name: "לקוח" });
  await setQuestionnaire(db, business.id, questionnaire);
  return business.id;
}

/** The admin register route's write: an uploaded clip ("/" in the path) of one character. */
async function clipOf(
  personaId: string | null,
  speakerGender: "female" | "male",
  opts: { active?: boolean; filePath?: string } = {},
): Promise<string> {
  const [row] = await db
    .insert(schema.textBlockClips)
    .values({
      filePath: opts.filePath ?? `assets/text_block_clip/${crypto.randomUUID()}/clip.mp4`,
      durationMs: 10_000,
      speakerGender,
      personaId,
      textSafeArea: RECT,
      active: opts.active ?? true,
    })
    .returning();
  return row!.id;
}

async function serve(businessId: string, clipId: string): Promise<string> {
  return skeletonOf(await serveNextTextBlock(db, { businessId, clipId }));
}

async function textBlockRows(businessId: string) {
  return db
    .select()
    .from(schema.scripts)
    .where(and(eq(schema.scripts.businessId, businessId), eq(schema.scripts.kind, "text_block")));
}

/**
 * Re-stamp when each skeleton was last seen, oldest first, a second apart:
 * serving inside one millisecond would tie shown_at, and a tie falls to bank
 * order — which would make the rotation look right for the wrong reason.
 */
async function stampSeen(businessId: string, oldestFirst: readonly string[]): Promise<void> {
  const base = Date.now() - 60 * 60 * 1000;
  for (const [i, skeleton] of oldestFirst.entries()) {
    await db
      .update(schema.scripts)
      .set({ shownAt: new Date(base + i * 1000) })
      .where(
        and(
          eq(schema.scripts.businessId, businessId),
          isNotNull(schema.scripts.shownAt),
          sql`${schema.scripts.params} ->> 'skeleton' = ${skeleton}`,
        ),
      );
  }
}

beforeAll(async () => {
  process.env.DRY_RUN = "1";
  resetEnvCache();
  const testDb = await createTestDb();
  db = testDb.db;
  pg = testDb.pg;
  // A character for גוש טקסט alone: a gender, no voice (decision 0099, R1).
  femalePersonaId = (await addPersona(db, { name: "נועה", gender: "female" })).id;
  const secondFemale = (await addPersona(db, { name: "מאיה", gender: "female" })).id;
  const male = (await addPersona(db, { name: "דני", gender: "male" })).id;
  femaleClipId = await clipOf(femalePersonaId, "female");
  secondFemaleClipId = await clipOf(secondFemale, "female");
  maleClipId = await clipOf(male, "male");
});

beforeEach(() => {
  vi.mocked(generateTextBlocks).mockClear();
  generateObject.mockReset();
});

afterAll(async () => {
  await pg.close();
});

describe("serveNextTextBlock", () => {
  it("one batch serves every fitting structure once, in bank order — never discovery without a wow", async () => {
    const businessId = await customer("rotation@example.com");

    const served: string[] = [];
    for (let i = 0; i < NO_WOW.length; i++) served.push(await serve(businessId, femaleClipId));

    expect(served).toEqual(NO_WOW);
    expect(batches()).toBe(1);
    expect(await textBlockRows(businessId)).toHaveLength(9);
  });

  it("with a wow the batch is ten, and discovery is served in its bank place", async () => {
    const businessId = await customer("wow@example.com", WITH_WOW);

    const served: string[] = [];
    for (let i = 0; i < 10; i++) served.push(await serve(businessId, femaleClipId));

    expect(served).toEqual([...TEXT_BLOCK_SKELETON_IDS]);
    expect(batches()).toBe(1);
  });

  it("the click after the last unseen text buys ONE new batch and serves the structure seen longest ago", async () => {
    const businessId = await customer("wrap@example.com");
    for (let i = 0; i < NO_WOW.length; i++) await serve(businessId, femaleClipId);
    // Seen longest ago is NOT the bank's first, so bank order cannot decide it.
    const oldestFirst = [
      "quiz",
      "cautionary_confession",
      ...NO_WOW.filter((id) => id !== "quiz" && id !== "cautionary_confession"),
    ];
    await stampSeen(businessId, oldestFirst);

    expect(await serve(businessId, femaleClipId)).toBe("quiz");
    expect(batches()).toBe(2);
    expect(await textBlockRows(businessId)).toHaveLength(18);

    // ...and the next click is served from that new batch, the next-oldest.
    expect(await serve(businessId, femaleClipId)).toBe("cautionary_confession");
    expect(await serve(businessId, femaleClipId)).toBe("reframe");
    expect(batches()).toBe(2);
  });

  it("the rotation is server state: a later visit, on another character's clip of the same gender, continues where the last stopped", async () => {
    const businessId = await customer("session@example.com");
    for (let i = 0; i < 3; i++) await serve(businessId, femaleClipId);

    // A new visit carries nothing client-side; the stock is the business's
    // per speaker gender, not the clip's.
    expect(await serve(businessId, secondFemaleClipId)).toBe(NO_WOW[3]);
    expect(batches()).toBe(1);
  });

  it("the other gender has its own stock: a male character's clip buys its own batch, and the female stock is untouched", async () => {
    const businessId = await customer("gender@example.com");
    expect(await serve(businessId, femaleClipId)).toBe("reframe");

    const male = await serveNextTextBlock(db, { businessId, clipId: maleClipId });

    expect(batches()).toBe(2);
    expect(male.params).toMatchObject({ speakerGender: "male" });
    // The rotation is the business's across genders: reframe was just seen,
    // so the male batch opens on the next structure.
    expect(skeletonOf(male)).toBe("instead");
    const rows = await textBlockRows(businessId);
    const unseenFemale = rows.filter(
      (r) => (r.params as { speakerGender: string }).speakerGender === "female" && !r.shownAt,
    );
    expect(unseenFemale).toHaveLength(8);

    // Back on the female clip: served from its own stock, no third batch.
    expect(await serve(businessId, femaleClipId)).toBe("shoutout_hack");
    expect(batches()).toBe(2);
  });

  it("a questionnaire change makes the unseen stock stale: the next click buys a fresh batch written against it", async () => {
    const businessId = await customer("stale@example.com");
    await serve(businessId, femaleClipId);
    await serve(businessId, femaleClipId);
    const before = (await getBusiness(db, businessId)).questionnaireUpdatedAt!.toISOString();

    // The customer adds a wow: the old unseen seven are stale, and discovery now fits.
    await setQuestionnaire(db, businessId, WITH_WOW);
    const stamp = (await getBusiness(db, businessId)).questionnaireUpdatedAt!.toISOString();
    expect(stamp).not.toBe(before);

    const next = await serveNextTextBlock(db, { businessId, clipId: femaleClipId });

    expect(batches()).toBe(2);
    expect(next.params).toMatchObject({ questionnaireUpdatedAt: stamp });
    expect(skeletonOf(next)).toBe("shoutout_hack");
    const fresh = (await textBlockRows(businessId)).filter(
      (r) => (r.params as { questionnaireUpdatedAt: string }).questionnaireUpdatedAt === stamp,
    );
    expect(fresh).toHaveLength(10);
  });

  it("never serves a placeholder, an edited text, or a skeleton that does not fit", async () => {
    const businessId = await customer("junk@example.com");
    const stamp = (await getBusiness(db, businessId)).questionnaireUpdatedAt!.toISOString();
    const stockRow = (skeleton: string, text: string, userEdited = false) => ({
      businessId,
      kind: "text_block" as const,
      text,
      params: {
        skeleton,
        textBlockClipId: femaleClipId,
        speakerGender: "female",
        questionnaireUpdatedAt: stamp,
      },
      promptVersion: "text_block@v3",
      userEdited,
    });
    const junk = await db
      .insert(schema.scripts)
      .values([
        // What the model wrote in place of a skip (Sonnet 5.5, measured).
        stockRow("reframe", "skipped"),
        stockRow("instead", "discovery"),
        // The customer's own copy of a text already shown.
        stockRow("shoutout_hack", "שאפו למי שגילה שאפשר לערוך את הטקסט", true),
        // No wow in this questionnaire: discovery does not fit.
        stockRow("discovery", TEXT_BLOCK_EXAMPLES.discovery),
      ])
      .returning();
    const junkIds = new Set(junk.map((r) => r.id));

    const served: (typeof schema.scripts.$inferSelect)[] = [];
    for (let i = 0; i < NO_WOW.length; i++) {
      served.push(await serveNextTextBlock(db, { businessId, clipId: femaleClipId }));
    }

    // The junk was no stock: the first click bought a batch.
    expect(batches()).toBe(1);
    expect(served.map(skeletonOf)).toEqual(NO_WOW);
    expect(served.some((r) => junkIds.has(r.id))).toBe(false);

    // With the batch spent, the junk is still no stock: the next click buys another.
    const next = await serveNextTextBlock(db, { businessId, clipId: femaleClipId });
    expect(junkIds.has(next.id)).toBe(false);
    expect(batches()).toBe(2);
    const junkAfter = (await textBlockRows(businessId)).filter((r) => junkIds.has(r.id));
    expect(junkAfter.every((r) => r.shownAt === null)).toBe(true);
  });

  it("a click served from stock touches neither the model nor the caps; an empty stock checks them first", async () => {
    const businessId = await customer("capped@example.com");
    await serve(businessId, femaleClipId);
    expect(batches()).toBe(1);

    await recordUsage(db, {
      provider: "anthropic",
      kind: "llm_tokens",
      quantity: PER_ACCOUNT_LLM_CAP,
      businessId,
    });

    // The other eight come out of stock with the account over its cap.
    for (let i = 1; i < NO_WOW.length; i++) await serve(businessId, femaleClipId);
    expect(batches()).toBe(1);

    // The stock is spent: the cap refuses before any batch is asked for.
    await expect(
      serveNextTextBlock(db, { businessId, clipId: femaleClipId }),
    ).rejects.toBeInstanceOf(AccountBudgetError);
    expect(batches()).toBe(1);
  });

  it("refuses, for a customer, an inactive clip, a pending one, a clip with no character and one whose character is inactive; the founder's business may use an unassigned clip", async () => {
    const businessId = await customer("refused@example.com");
    const inactive = await clipOf(femalePersonaId, "female", { active: false });
    const pending = await clipOf(femalePersonaId, "female", { filePath: "pending" });
    const unassigned = await clipOf(null, "female");
    const retired = (await addPersona(db, { name: "רותם", gender: "female" })).id;
    await db.update(schema.personas).set({ active: false }).where(eq(schema.personas.id, retired));
    const retiredClip = await clipOf(retired, "female");

    await expect(serve(businessId, inactive)).rejects.toThrow(/is not active/);
    await expect(serve(businessId, pending)).rejects.toThrow(/never finished uploading/);
    await expect(serve(businessId, unassigned)).rejects.toThrow(/belongs to no active character/);
    await expect(serve(businessId, retiredClip)).rejects.toThrow(/belongs to no active character/);
    await expect(serve(businessId, "00000000-0000-0000-0000-000000000009")).rejects.toThrow(
      /not found/,
    );
    expect(batches()).toBe(0);
    expect(await textBlockRows(businessId)).toHaveLength(0);

    const founder = await createBusiness(db, {
      ownerEmail: "founder@example.com",
      name: "תבנית",
      ownerRole: "admin",
    });
    await setQuestionnaire(db, founder.id, QUESTIONNAIRE);
    expect(await serve(founder.id, unassigned)).toBe("reframe");
  });

  it("a fresh batch with nothing servable in it raises TextBlockStockEmptyError, and stamps nothing as seen", async () => {
    const businessId = await customer("empty@example.com");
    generateObject.mockResolvedValueOnce({
      object: {
        texts: [
          { skeleton: "reframe", text: "skipped" },
          { skeleton: "instead", text: "skip" },
        ],
        skipped: [],
      },
      usage: { inputTokens: 2000, outputTokens: 40 },
    });

    process.env.DRY_RUN = "";
    resetEnvCache();
    try {
      await expect(
        serveNextTextBlock(db, { businessId, clipId: femaleClipId }),
      ).rejects.toBeInstanceOf(TextBlockStockEmptyError);
    } finally {
      process.env.DRY_RUN = "1";
      resetEnvCache();
    }

    expect(generateObject).toHaveBeenCalledTimes(1);
    // Stored — the admin studio shows a whole batch — but never served.
    const rows = await textBlockRows(businessId);
    expect(rows.map((r) => r.text)).toEqual(["skipped", "skip"]);
    expect(rows.every((r) => r.shownAt === null)).toBe(true);
  });
});

describe("updatePersona carries a gender change to the character's clips", () => {
  it("rewrites speaker_gender on every clip of that persona and on no other", async () => {
    const persona = (await addPersona(db, { name: "עדי", gender: "female" })).id;
    const other = (await addPersona(db, { name: "שירה", gender: "female" })).id;
    const own = [await clipOf(persona, "female"), await clipOf(persona, "female")];
    const untouched = [await clipOf(other, "female"), await clipOf(null, "female")];

    await updatePersona(db, persona, { gender: "male" });

    const genderOf = async (id: string) =>
      (await db.select().from(schema.textBlockClips).where(eq(schema.textBlockClips.id, id)))[0]!
        .speakerGender;
    for (const id of own) expect(await genderOf(id)).toBe("male");
    for (const id of untouched) expect(await genderOf(id)).toBe("female");

    // A patch with no gender in it leaves the clips alone.
    await updatePersona(db, persona, { name: "עדי ב" });
    for (const id of own) expect(await genderOf(id)).toBe("male");
  });
});

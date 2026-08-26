import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stripTagWords, type CaptionChunk, type WordTiming } from "../src/captions";
import { resetEnvCache } from "../src/config";
import type { Db } from "../src/db";
import * as dbSchema from "../src/db/schema";
import { buildHandlers } from "../src/handlers";
import { runLane } from "../src/jobs/worker";
import { createBusiness } from "../src/pipelines/businesses";
import { requestAudio, sameWordSequence, stripAudioTags } from "../src/pipelines/tts";
import { setStorage } from "../src/storage";
import { createTestDb } from "./helpers/pglite";
import { tempStorage } from "./helpers/storage";

/**
 * ElevenLabs v3 audio tags: the tags are sent to TTS but must never reach a
 * caption, and the enhancement must never change the Hebrew words.
 */

function timings(...tokens: string[]): WordTiming[] {
  return tokens.map((word, i) => ({ word, startMs: i * 300, endMs: i * 300 + 250 }));
}

const spoken = (words: WordTiming[]) => words.map((w) => w.word);

describe("stripTagWords", () => {
  it("drops a single-token tag", () => {
    expect(spoken(stripTagWords(timings("[sighs]", "ניסיתי", "מיליון", "דברים")))).toEqual([
      "ניסיתי",
      "מיליון",
      "דברים",
    ]);
  });

  it("drops a multi-token tag span (alignment splits on whitespace)", () => {
    expect(spoken(stripTagWords(timings("ואז", "[short", "pause]", "ראיתי", "תוצאה")))).toEqual([
      "ואז",
      "ראיתי",
      "תוצאה",
    ]);
  });

  it("drops tags with punctuation stuck to the brackets", () => {
    expect(spoken(stripTagWords(timings("…[excited]", "תלחצו", "[laughs]!", "עכשיו")))).toEqual([
      "תלחצו",
      "עכשיו",
    ]);
  });

  it("returns nothing for tag-only input", () => {
    expect(stripTagWords(timings("[sighs]"))).toEqual([]);
    expect(stripTagWords(timings("[short", "pause]"))).toEqual([]);
  });

  it("passes tag-free Hebrew through untouched (timings preserved)", () => {
    const words = timings("ניסיתי", "מיליון", "דברים");
    expect(stripTagWords(words)).toEqual(words);
  });

  it("keeps an unclosed bracket rather than swallowing the rest of the line", () => {
    expect(spoken(stripTagWords(timings("[oops", "ניסיתי", "הכל")))).toEqual([
      "[oops",
      "ניסיתי",
      "הכל",
    ]);
  });
});

describe("stripAudioTags", () => {
  it("removes tags and collapses the whitespace they leave behind", () => {
    expect(stripAudioTags("[excited] תלחצו על הקישור [short pause] עכשיו!")).toBe(
      "תלחצו על הקישור עכשיו!",
    );
  });

  it("is a no-op on plain Hebrew", () => {
    expect(stripAudioTags("ניסיתי מיליון דברים")).toBe("ניסיתי מיליון דברים");
  });
});

describe("sameWordSequence (fail-open validation)", () => {
  const original = "ניסיתי מיליון דברים ושום דבר לא עבד";

  it("accepts added tags and punctuation", () => {
    expect(sameWordSequence(original, "[sighs] ניסיתי מיליון דברים… ושום דבר לא עבד.")).toBe(true);
    expect(
      sameWordSequence(
        "תלחצו על הקישור לפני שזה נגמר",
        "[excited] תלחצו על הקישור [short pause] לפני שזה נגמר!",
      ),
    ).toBe(true);
  });

  it("rejects a rewritten word", () => {
    expect(sameWordSequence(original, "[sighs] ניסיתי אלף דברים ושום דבר לא עבד")).toBe(false);
  });

  it("rejects a dropped word", () => {
    expect(sameWordSequence(original, "[sighs] ניסיתי מיליון דברים ושום דבר עבד")).toBe(false);
  });

  it("rejects an added word", () => {
    expect(sameWordSequence(original, "ניסיתי מיליון דברים ושום דבר לא באמת עבד")).toBe(false);
  });

  it("rejects a reorder", () => {
    expect(sameWordSequence("ואז חברה שלחה לי את זה", "ואז שלחה חברה לי את זה… [surprised]")).toBe(
      false,
    );
  });
});

describe("synth_tts with audio tags (dry-run, real DB + jobs)", () => {
  const SCRIPT = "ניסיתי מיליון דברים ושום דבר לא עבד עד שגיליתי את זה";
  let db: Db;
  let pg: { close(): Promise<void> };
  let cleanupStorage: () => void;
  let businessId: string;

  async function synth(): Promise<typeof dbSchema.audioRenders.$inferSelect> {
    const inserted = await db
      .insert(dbSchema.scripts)
      .values({ businessId, kind: "vo_script", text: SCRIPT, promptVersion: "test" })
      .returning();
    const audio = await requestAudio(db, { scriptId: inserted[0]!.id, voiceId: "voice_test" });
    await runLane(db, { workerId: "test", handlers: buildHandlers(), drainAndExit: true });
    const rows = await db
      .select()
      .from(dbSchema.audioRenders)
      .where(sql`${dbSchema.audioRenders.id} = ${audio.id}`);
    return rows[0]!;
  }

  beforeAll(async () => {
    process.env.DRY_RUN = "1";
    resetEnvCache();
    const testDb = await createTestDb();
    db = testDb.db;
    pg = testDb.pg;
    const ts = tempStorage();
    setStorage(ts.storage);
    cleanupStorage = ts.cleanup;
    const business = await createBusiness(db, {
      ownerEmail: "founder@example.com",
      name: "מסעדת הבית",
      ownerRole: "admin",
    });
    businessId = business.id;
  });

  afterAll(async () => {
    setStorage(undefined);
    cleanupStorage();
    await pg.close();
  });

  it("tts_enhance absent: the sent text is the script, byte for byte", async () => {
    // 0031 seeds tts_enhance=false, so absence is arranged rather than assumed —
    // otherwise this passes on the seeded false and never exercises the no-row path.
    await db.delete(dbSchema.appConfig).where(sql`${dbSchema.appConfig.key} = 'tts_enhance'`);

    const row = await synth();
    expect(row.status).toBe("ready");
    expect(row.renderedText).toBe(SCRIPT);
  });

  it("tts_enhance on: tags reach the TTS text and never reach the captions", async () => {
    // Upsert, not insert: 0031 seeds the row, and the preceding test deletes it.
    await db
      .insert(dbSchema.appConfig)
      .values({ key: "tts_enhance", value: true })
      .onConflictDoUpdate({ target: dbSchema.appConfig.key, set: { value: true } });

    const row = await synth();
    expect(row.status).toBe("ready");
    // The tagged text is what was sent (and what rendered_text records).
    expect(row.renderedText).toBe(`[excited] ${SCRIPT}`);

    const chunks = row.wordTimestamps as CaptionChunk[];
    const captionText = chunks.map((c) => c.text).join(" ");
    expect(captionText).not.toMatch(/[[\]]/);
    expect(captionText.split(/\s+/)).toEqual(SCRIPT.split(" "));
  });
});

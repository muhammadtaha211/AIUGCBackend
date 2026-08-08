import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Db } from "../src/db";
import * as schema from "../src/db/schema";
import {
  AUDIO_SCRIPT_POINTER_MOVED,
  getAudioWithScript,
  recordAudioScriptPointerMove,
} from "../src/pipelines/audio-script";
import { createBusiness } from "../src/pipelines/businesses";
import { updateScriptText } from "../src/pipelines/copy";
import { createTestDb } from "./helpers/pglite";

/**
 * The audio gate's invariant: what the customer is shown and what the render
 * speaks are the same row, because both resolve through audio_renders.script_id.
 *
 * The length-fit regeneration in pipelines/tts.ts could move that pointer after
 * the wizard had already shown the customer the old text. These cover the read
 * that closes the gap and the tripwire that announces it if it ever happens
 * again — including that the tripwire stays quiet on the two orderings that
 * look similar but are ordinary: a plain run and a user edit.
 */

async function makeScript(db: Db, businessId: string, text: string, wordBudget: number) {
  const rows = await db
    .insert(schema.scripts)
    .values({ businessId, kind: "vo_script", text, params: { wordBudget } })
    .returning();
  return rows[0]!;
}

/** What requestAudio does: point a NEW audio row at an ALREADY EXISTING script. */
async function makeAudio(db: Db, scriptId: string) {
  const rows = await db
    .insert(schema.audioRenders)
    .values({ scriptId, voiceId: "voice-1", status: "ready" })
    .returning();
  return rows[0]!;
}

async function setup() {
  const { db, pg } = await createTestDb();
  const business = await createBusiness(db, {
    ownerEmail: `owner-${crypto.randomUUID()}@test.local`,
    name: "Biz",
  });
  return { db, pg, business };
}

/** The swap as tts.ts performs it: generate a tighter script, then repoint. */
async function swapIn(db: Db, businessId: string, audioId: string) {
  const spoken = await makeScript(db, businessId, "תסריט קצר יותר", 18);
  await db
    .update(schema.audioRenders)
    .set({ scriptId: spoken.id })
    .where(eq(schema.audioRenders.id, audioId));
  return spoken;
}

describe("getAudioWithScript", { timeout: 60_000 }, () => {
  it("returns the script the pointer names, not the one the audio started on", async () => {
    const { db, pg, business } = await setup();
    const shown = await makeScript(db, business.id, "התסריט שהלקוח קרא", 21);
    const audio = await makeAudio(db, shown.id);

    const before = await getAudioWithScript(db, audio.id);
    expect(before?.script.id).toBe(shown.id);
    expect(before?.pointerMoved).toBe(false);

    const spoken = await swapIn(db, business.id, audio.id);

    // Same call, same arguments — the answer follows the pointer. A caller
    // holding `shown.id` has no way to make this return `shown`: the function
    // takes no script id at all.
    const after = await getAudioWithScript(db, audio.id);
    expect(after?.script.id).toBe(spoken.id);
    expect(after?.script.text).toBe("תסריט קצר יותר");
    expect(after?.script.params).toMatchObject({ wordBudget: 18 });
    expect(after?.audio.id).toBe(audio.id);
    expect(after?.pointerMoved).toBe(true);

    await pg.close();
  });

  it("is null for an audio render that does not exist", async () => {
    const { db, pg } = await setup();
    expect(await getAudioWithScript(db, crypto.randomUUID())).toBeNull();
    await pg.close();
  });
});

describe("pointerMoved (no client input, no false positives)", { timeout: 60_000 }, () => {
  it("stays false for a plain run — the script predates its audio", async () => {
    const { db, pg, business } = await setup();
    const script = await makeScript(db, business.id, "תסריט רגיל", 21);
    const audio = await makeAudio(db, script.id);

    expect((await getAudioWithScript(db, audio.id))?.pointerMoved).toBe(false);
    await pg.close();
  });

  it("stays false for a user edit — the new row is created BEFORE its audio", async () => {
    const { db, pg, business } = await setup();
    // The shape that could look like a swap: two script rows, the audio on the
    // second. It is not one, because the edit happens before TTS is requested.
    const original = await makeScript(db, business.id, "התסריט המקורי", 21);
    const edited = await updateScriptText(db, original.id, "הטקסט שהלקוח כתב בעצמו");
    const audio = await makeAudio(db, edited.id);

    const found = await getAudioWithScript(db, audio.id);
    expect(found?.script.id).toBe(edited.id);
    expect(found?.script.userEdited).toBe(true);
    expect(found?.pointerMoved).toBe(false);

    await pg.close();
  });

  it("turns true only once the pointer is rewritten after the fact", async () => {
    const { db, pg, business } = await setup();
    const original = await makeScript(db, business.id, "התסריט המקורי", 21);
    const edited = await updateScriptText(db, original.id, "הטקסט שהלקוח כתב בעצמו");
    const audio = await makeAudio(db, edited.id);
    expect((await getAudioWithScript(db, audio.id))?.pointerMoved).toBe(false);

    await swapIn(db, business.id, audio.id);
    expect((await getAudioWithScript(db, audio.id))?.pointerMoved).toBe(true);

    await pg.close();
  });
});

describe("recordAudioScriptPointerMove", { timeout: 60_000 }, () => {
  it("writes one queryable row naming the spoken script and both instants", async () => {
    const { db, pg, business } = await setup();
    const shown = await makeScript(db, business.id, "התסריט שהלקוח קרא", 21);
    const audio = await makeAudio(db, shown.id);
    await swapIn(db, business.id, audio.id);
    const found = (await getAudioWithScript(db, audio.id))!;

    await recordAudioScriptPointerMove(db, {
      audioRenderId: audio.id,
      businessId: business.id,
      toScriptId: found.script.id,
      audioCreatedAt: found.audio.createdAt,
      scriptCreatedAt: found.script.createdAt,
      actorUserId: business.ownerUserId,
    });

    const rows = await db
      .select()
      .from(schema.events)
      .where(eq(schema.events.kind, AUDIO_SCRIPT_POINTER_MOVED));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      businessId: business.id,
      subjectType: "audio_render",
      subjectId: audio.id,
      actorUserId: business.ownerUserId,
    });
    const payload = rows[0]!.payload as Record<string, string>;
    expect(payload.toScriptId).toBe(found.script.id);
    // The anchor for finding the script the pointer moved away from by hand.
    expect(Date.parse(payload.scriptCreatedAt!)).toBeGreaterThan(
      Date.parse(payload.audioCreatedAt!),
    );

    await pg.close();
  });

  it("writes exactly once across repeated polls of the same audio render", async () => {
    const { db, pg, business } = await setup();
    const shown = await makeScript(db, business.id, "התסריט שהלקוח קרא", 21);
    const audio = await makeAudio(db, shown.id);
    await swapIn(db, business.id, audio.id);

    // Five polls, two seconds apart in production. The predicate is a property
    // of the rows, so every one of them sees pointerMoved and calls in.
    for (let poll = 0; poll < 5; poll++) {
      const found = (await getAudioWithScript(db, audio.id))!;
      expect(found.pointerMoved).toBe(true);
      await recordAudioScriptPointerMove(db, {
        audioRenderId: audio.id,
        businessId: business.id,
        toScriptId: found.script.id,
        audioCreatedAt: found.audio.createdAt,
        scriptCreatedAt: found.script.createdAt,
      });
    }

    expect(
      await db.select().from(schema.events).where(eq(schema.events.subjectId, audio.id)),
    ).toHaveLength(1);

    await pg.close();
  });

  it("keeps a second audio render's move separate", async () => {
    const { db, pg, business } = await setup();
    const shown = await makeScript(db, business.id, "התסריט שהלקוח קרא", 21);
    const audio = await makeAudio(db, shown.id);
    const other = await makeAudio(db, shown.id);

    for (const id of [audio.id, other.id]) {
      const spoken = await swapIn(db, business.id, id);
      const found = (await getAudioWithScript(db, id))!;
      await recordAudioScriptPointerMove(db, {
        audioRenderId: id,
        businessId: business.id,
        toScriptId: spoken.id,
        audioCreatedAt: found.audio.createdAt,
        scriptCreatedAt: found.script.createdAt,
      });
    }

    const rows = await db
      .select()
      .from(schema.events)
      .where(eq(schema.events.kind, AUDIO_SCRIPT_POINTER_MOVED));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.subjectId).sort()).toEqual([audio.id, other.id].sort());

    await pg.close();
  });
});

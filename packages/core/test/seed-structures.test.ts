import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLOSER_TEMPLATES } from "../src/closer-templates";
import type { Db } from "../src/db";
import * as dbSchema from "../src/db/schema";
import { addStructure, seedStructures } from "../src/pipelines/bank";
import { createTestDb } from "./helpers/pglite";

/**
 * The checked-in skeletons (seed/structures/*.json) go into the bank through
 * the same insert as `aiugc bank add-structure`, keyed by file name, and the
 * seed is safe to re-run. `--update` is how an edited file reaches rows that
 * already exist: `addStructure` is insert-only, so without it editing a seed
 * file changes nothing live.
 */

const SEED_TITLES = [
  "before-after",
  "objection-flip",
  "problem-agitate-solve",
  "show-and-react",
  "three-things",
];

type Skeleton = { beats: { id: string; intent: string; example: string }[] };

/** Every closer the bank can offer, with its punctuation as the script would carry it. */
function endsWithACloser(example: string): boolean {
  return CLOSER_TEMPLATES.some((c) =>
    c.punctuation.kind === "fixed"
      ? example.endsWith(c.text + c.punctuation.mark)
      : new RegExp(`${c.text}!{1,${c.punctuation.max}}$`).test(example),
  );
}

describe("seedStructures", () => {
  let db: Db;
  let pg: { close(): Promise<void> };

  beforeAll(async () => {
    const testDb = await createTestDb();
    db = testDb.db;
    pg = testDb.pg;
  });

  afterAll(async () => {
    await pg.close();
  });

  it("seeds the five checked-in skeletons with parseable beats", async () => {
    const { added, updated } = await seedStructures(db);
    expect(added.sort()).toEqual(SEED_TITLES);
    expect(updated).toEqual([]);

    const rows = await db.select().from(dbSchema.structures);
    for (const title of SEED_TITLES) {
      const row = rows.find((r) => r.title === title)!;
      expect(row, title).toBeDefined();
      expect(row.active).toBe(true);
      const skeleton = row.skeleton as Skeleton;
      expect(skeleton.beats.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("every skeleton ends on a closer from the bank, and says so", async () => {
    const rows = await db.select().from(dbSchema.structures);
    for (const title of SEED_TITLES) {
      const { beats } = rows.find((r) => r.title === title)!.skeleton as Skeleton;
      const last = beats[beats.length - 1]!;
      expect(last.intent, title).toContain("closers offered in the prompt");
      expect(endsWithACloser(last.example), `${title}: ${last.example}`).toBe(true);
    }
  });

  it("is idempotent and leaves manually-added structures alone", async () => {
    await addStructure(db, { title: "hook-story-cta", skeleton: { beats: [] } });
    const { added, updated } = await seedStructures(db);
    expect(added).toEqual([]);
    expect(updated).toEqual([]);

    const rows = await db.select().from(dbSchema.structures);
    expect(rows).toHaveLength(SEED_TITLES.length + 1);
  });

  it("without --update, an existing row keeps a skeleton that drifted from the file", async () => {
    const drifted = { beats: [{ id: "hook", intent: "old", example: "ישן" }] };
    await db
      .update(dbSchema.structures)
      .set({ skeleton: drifted })
      .where(eq(dbSchema.structures.title, "before-after"));

    await seedStructures(db);

    const [row] = await db
      .select()
      .from(dbSchema.structures)
      .where(eq(dbSchema.structures.title, "before-after"));
    expect(row!.skeleton).toEqual(drifted);
  });

  it("with --update, existing titles get their skeleton replaced from the file and nothing else moves", async () => {
    const before = await db.select().from(dbSchema.structures);
    const { added, updated } = await seedStructures(db, { update: true });
    expect(added).toEqual([]);
    expect(updated.sort()).toEqual(SEED_TITLES);

    const after = await db.select().from(dbSchema.structures);
    expect(after).toHaveLength(before.length);
    const restored = after.find((r) => r.title === "before-after")!;
    const { beats } = restored.skeleton as Skeleton;
    expect(beats.map((b) => b.id)).toEqual(["hook", "before", "found", "name_and_close"]);
    // Same row, not a re-insert; id, active and created_at untouched.
    const original = before.find((r) => r.title === "before-after")!;
    expect(restored.id).toBe(original.id);
    expect(restored.active).toBe(original.active);
    expect(restored.createdAt).toEqual(original.createdAt);
    // The hand-added structure is not in the seed dir, so --update never touches it.
    expect(after.find((r) => r.title === "hook-story-cta")!.skeleton).toEqual({ beats: [] });
  });
});

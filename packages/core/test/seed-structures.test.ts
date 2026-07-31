import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db";
import * as dbSchema from "../src/db/schema";
import { addStructure, seedStructures } from "../src/pipelines/bank";
import { createTestDb } from "./helpers/pglite";

/**
 * The checked-in skeletons (seed/structures/*.json) go into the bank through
 * the same insert as `aiugc bank add-structure`, keyed by file name, and the
 * seed is safe to re-run.
 */

const SEED_TITLES = [
  "before-after",
  "objection-flip",
  "problem-agitate-solve",
  "show-and-react",
  "three-things",
];

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
    const added = await seedStructures(db);
    expect(added.sort()).toEqual(SEED_TITLES);

    const rows = await db.select().from(dbSchema.structures);
    for (const title of SEED_TITLES) {
      const row = rows.find((r) => r.title === title)!;
      expect(row, title).toBeDefined();
      expect(row.active).toBe(true);
      const skeleton = row.skeleton as { beats: { id: string }[] };
      expect(skeleton.beats.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("is idempotent and leaves manually-added structures alone", async () => {
    await addStructure(db, { title: "hook-story-cta", skeleton: { beats: [] } });
    const added = await seedStructures(db);
    expect(added).toEqual([]);

    const rows = await db.select().from(dbSchema.structures);
    expect(rows).toHaveLength(SEED_TITLES.length + 1);
  });
});

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "../src/config";
import type { Db } from "../src/db";
import { structures } from "../src/db/schema";
import { addPersona, addStructure } from "../src/pipelines/bank";
import { createBusiness, setQuestionnaire } from "../src/pipelines/businesses";
import { generateBScript, pickStructureForBusiness, updateScriptText } from "../src/pipelines/copy";
import { createTestDb } from "./helpers/pglite";

/**
 * The structure bank rotates least-recently-used first, per business. The
 * wizard used to pick a random active structure, so with five in the bank a
 * customer regenerating drew the same skeleton again about one time in five.
 *
 * Fresh DB per test: the picker reads the whole active bank, so structures
 * left behind by one test would sit at the head of the next test's queue.
 */

let db: Db;
let personaId: string;

/** One turn of the wizard's script step: pick a structure, generate against it. */
async function generate(businessId: string) {
  const structureId = await pickStructureForBusiness(db, businessId);
  if (!structureId) throw new Error("no active structure");
  return generateBScript(db, { businessId, personaId, structureId });
}

/** The same turn, when only the structure it landed on matters. */
async function pick(businessId: string): Promise<string> {
  return (await generate(businessId)).structureId!;
}

async function newBusiness(ownerEmail: string): Promise<string> {
  const business = await createBusiness(db, { ownerEmail, name: "קרם הפנים", ownerRole: "admin" });
  await setQuestionnaire(db, business.id, {
    category: "physical_product",
    product_name: "קרם הפנים",
    what_it_does: "קרם לחות טבעי לעור רגיש",
    advantages: ["רכיבים טבעיים בלבד"],
    target_audience: "נשים 25-45",
    tone: "friendly",
  });
  return business.id;
}

/**
 * The bank, in a known order: structures.created_at is the rotation's
 * tie-break, and PGlite's now() only has millisecond granularity — two
 * addStructure calls inside one millisecond would share a timestamp and make
 * the order these tests assert ambiguous. Measured 0 ties in 160 gaps here
 * (floor exactly 1ms), but a faster machine is not owed that, so the fixture
 * stamps the order it means instead of inheriting it from insert timing.
 */
async function seedBank(titles: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const [i, title] of titles.entries()) {
    const { id } = await addStructure(db, { title, skeleton: { beats: [title] } });
    await db
      .update(structures)
      .set({ createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)) })
      .where(eq(structures.id, id));
    ids.push(id);
  }
  return ids;
}

const FIVE = ["one", "two", "three", "four", "five"];

beforeEach(async () => {
  process.env.DRY_RUN = "1";
  resetEnvCache();
  ({ db } = await createTestDb());
  personaId = (await addPersona(db, { name: "נועה", voiceId: "voice_noa" })).id;
});

describe("pickStructureForBusiness", () => {
  it("returns undefined when the bank has no active structure", async () => {
    const businessId = await newBusiness("empty@example.com");
    expect(await pickStructureForBusiness(db, businessId)).toBeUndefined();

    const [only] = await seedBank(["one"]);
    await db.update(structures).set({ active: false }).where(eq(structures.id, only!));
    expect(await pickStructureForBusiness(db, businessId)).toBeUndefined();
  });

  it("rotates through all five in bank order, then wraps to the first", async () => {
    const bank = await seedBank(FIVE);
    const businessId = await newBusiness("rotate@example.com");

    const picks: string[] = [];
    for (let i = 0; i < 6; i++) picks.push(await pick(businessId));

    // Never used -> null last-use -> the structures' own created_at decides.
    expect(picks.slice(0, 5)).toEqual(bank);
    expect(new Set(picks.slice(0, 5)).size).toBe(5);
    expect(picks[5]).toBe(bank[0]);
  });

  it("picks a structure seeded into an exhausted bank on the next generation", async () => {
    const bank = await seedBank(["one", "two", "three"]);
    const businessId = await newBusiness("seeded@example.com");
    for (let i = 0; i < 3; i++) await pick(businessId);

    const fresh = await addStructure(db, { title: "four", skeleton: {} });
    expect(await pick(businessId)).toBe(fresh.id);
    // And then the rotation carries on from the oldest use.
    expect(await pick(businessId)).toBe(bank[0]);
  });

  it("never picks an inactive structure", async () => {
    const bank = await seedBank(FIVE);
    const businessId = await newBusiness("inactive@example.com");
    const retired = bank[2]!;
    await db.update(structures).set({ active: false }).where(eq(structures.id, retired));

    const picks: string[] = [];
    for (let i = 0; i < 8; i++) picks.push(await pick(businessId));

    expect(picks).not.toContain(retired);
    // Four left, so the rotation is four long and comes round twice.
    const active = bank.filter((id) => id !== retired);
    expect(picks).toEqual([...active, ...active]);
  });

  it("gives every business its own rotation", async () => {
    const bank = await seedBank(FIVE);
    const first = await newBusiness("first@example.com");
    const second = await newBusiness("second@example.com");

    expect([await pick(first), await pick(first), await pick(first)]).toEqual(bank.slice(0, 3));
    // The other business's three generations are invisible here.
    expect([await pick(second), await pick(second)]).toEqual(bank.slice(0, 2));
    expect(await pick(first)).toBe(bank[3]);
  });

  it("is not disturbed by a user edit of the script just generated", async () => {
    const bank = await seedBank(FIVE);
    const businessId = await newBusiness("edited@example.com");

    let last = await generate(businessId);
    for (let i = 0; i < 4; i++) last = await generate(businessId);
    expect(last.structureId).toBe(bank[4]);

    // The wizard's edit step: a new row, same structure_id, newer created_at —
    // on the structure that was already the most recently used.
    const edited = await updateScriptText(db, last.id, `${last.text} עוד משפט`);
    expect(edited.structureId).toBe(bank[4]);

    expect(await pick(businessId)).toBe(bank[0]);
    expect(await pick(businessId)).toBe(bank[1]);
  });
});

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Hoisted so the module factory below can close over it: generateHookLines
// reaches the real Claude call on the non-DRY_RUN path, and the retry is the
// behaviour under test.
const generateObject = vi.hoisted(() => vi.fn());
vi.mock("../src/providers/anthropic", () => ({
  generateObject,
  CLAUDE_MODEL: "claude-sonnet-5-5",
}));

import { resetEnvCache } from "../src/config";
import type { Db } from "../src/db";
import { createBusiness, setQuestionnaire } from "../src/pipelines/businesses";
import { findIllegalHookLineChar, generateHookLines } from "../src/pipelines/copy";
import { createTestDb } from "./helpers/pglite";

/**
 * v7's character rule. Prompt rules reduce artifacts, they do not guarantee
 * absence: a v6 run emitted U+0640 ARABIC TATWEEL inside `לـAI`, which would
 * have burned into the frame as a stray glyph. The hook line is the primary
 * artifact, so this rejects and re-requests rather than sanitising.
 */

const TATWEEL = "ـ";

describe("findIllegalHookLineChar", () => {
  it("passes a clean Hebrew batch, including Latin product names and digits", () => {
    expect(
      findIllegalHookLineChar([
        { text: "מצאתי דירה לפני כולם ולא מאמינה שהיה קל" },
        { text: "POV: מישהו שאל אותי איך עשיתי את זה" },
        { text: "בגלל זה כולם מוחקים את ChatGPT" },
        { text: "עשיתי את זה ב-0 שקל... זה נורמלי?" },
        { text: '"אין לי זמן לחפש דירה"' },
      ]),
    ).toBeUndefined();
  });

  it("passes the typographic marks that render correctly in an RTL line", () => {
    expect(findIllegalHookLineChar([{ text: "זהו — נגמר… ₪0 על פרסום" }])).toBeUndefined();
  });

  it("reports the codepoint of an Arabic tatweel hiding in a Hebrew/Latin mix", () => {
    const bad = findIllegalHookLineChar([
      { text: "שורה נקייה לגמרי" },
      { text: `כולם עברו ל${TATWEEL}AI` },
    ]);
    expect(bad?.codepoint).toBe("U+0640");
    expect(bad?.text).toBe(`כולם עברו ל${TATWEEL}AI`);
  });

  it("rejects zero-width and formatting characters", () => {
    expect(findIllegalHookLineChar([{ text: "מצאתי​דירה" }])?.codepoint).toBe("U+200B");
    expect(findIllegalHookLineChar([{ text: "‫מצאתי דירה" }])?.codepoint).toBe("U+202B");
  });

  it("rejects emoji (one code point, not two surrogate halves)", () => {
    const bad = findIllegalHookLineChar([{ text: "מצאתי דירה 🔥" }]);
    expect(bad?.codepoint).toBe("U+1F525");
  });
});

describe("generateHookLines character validation (real DB, mocked Claude)", () => {
  let db: Db;
  let pg: { close(): Promise<void> };
  let businessId: string;

  /** One batch of ten, `angle` per v7's frame order (only frame 3 is named). */
  function batch(thirdLine: string) {
    return {
      object: {
        options: Array.from({ length: 10 }, (_, i) => ({
          text: i === 2 ? thirdLine : `שורה נקייה מספר ${i + 1}`,
          angle: i === 2 ? "disbelief_at_ease" : `frame_${i + 1}`,
        })),
      },
      usage: { inputTokens: 1200, outputTokens: 300 },
    };
  }

  const CLEAN = "מצאתי דירה לפני כולם ולא מאמינה שהיה קל";
  const DIRTY = `כולם עברו ל${TATWEEL}AI ולא מאמינה שהיה קל`;

  beforeAll(async () => {
    // The validation only runs on the live path; DRY_RUN returns canned lines.
    delete process.env.DRY_RUN;
    resetEnvCache();
    const testDb = await createTestDb();
    db = testDb.db;
    pg = testDb.pg;
    const business = await createBusiness(db, {
      ownerEmail: "founder@example.com",
      name: "רון דירון",
      ownerRole: "admin",
    });
    businessId = business.id;
    await setQuestionnaire(db, businessId, {
      category: "app_or_digital",
      product_name: "רון דירון",
      what_it_does: "מתריע על דירות חדשות ביד2 לפני כולם",
      advantages: ["התראות מיידיות", "בלי לרענן ידנית"],
      target_audience: "מחפשי דירות בתל אביב",
      tone: "friendly",
    });
  });

  afterAll(async () => {
    await pg.close();
  });

  it("a clean batch passes on the first call and is inserted", async () => {
    generateObject.mockReset().mockResolvedValueOnce(batch(CLEAN));

    const rows = await generateHookLines(db, { businessId });

    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(10);
    expect(rows[2]!.text).toBe(CLEAN);
    expect((rows[2]!.params as { angle: string }).angle).toBe("disbelief_at_ease");
  });

  it("a tatweel triggers exactly one retry, and the clean retry is what lands", async () => {
    generateObject
      .mockReset()
      .mockResolvedValueOnce(batch(DIRTY))
      .mockResolvedValueOnce(batch(CLEAN));

    const rows = await generateHookLines(db, { businessId });

    expect(generateObject).toHaveBeenCalledTimes(2);
    expect(rows[2]!.text).toBe(CLEAN);
    // Reject-and-retry, not sanitise: the rejected batch never reaches a row.
    expect(rows.some((r) => r.text.includes(TATWEEL))).toBe(false);
  });

  it("a second failure raises, naming the codepoint, and inserts nothing", async () => {
    generateObject.mockReset().mockResolvedValue(batch(DIRTY));

    await expect(generateHookLines(db, { businessId })).rejects.toThrow(/U\+0640/);
    expect(generateObject).toHaveBeenCalledTimes(2);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CLOSER_OPTIONS_PER_GENERATION,
  CLOSER_TEMPLATES,
  type CloserTemplate,
  describeCloser,
  pickClosers,
} from "../src/closer-templates";
import { resetEnvCache } from "../src/config";
import type { Db } from "../src/db";
import { pickHookTemplates } from "../src/hook-templates";
import { addPersona, addStructure } from "../src/pipelines/bank";
import { createBusiness, setQuestionnaire } from "../src/pipelines/businesses";
import type { Questionnaire } from "../src/pipelines/businesses";
import { generateBScript } from "../src/pipelines/copy";
import { renderPrompt } from "../src/prompts";
import { createTestDb } from "./helpers/pglite";

/**
 * The closer bank — the twin of the hook bank. A tone-filtered handful of
 * curated closers is injected into every b_script prompt as
 * {{closer_options}}, the script must end on one of them, and the offered texts
 * are recorded on scripts.params so a winning closer can be traced back.
 */

const TONES: Questionnaire["tone"][] = ["friendly", "direct", "professional"];

describe("CLOSER_TEMPLATES", () => {
  it("every tone has at least one closer", () => {
    for (const tone of TONES) {
      expect(
        CLOSER_TEMPLATES.filter((c) => c.tones.includes(tone)).length,
        tone,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it("carries the founder's tested punctuation byte for byte", () => {
    const byText = Object.fromEntries(CLOSER_TEMPLATES.map((c) => [c.text, c]));
    expect(byText["הכי ממליצה בעולם"]!.punctuation).toEqual({ kind: "exclaim", max: 4 });
    expect(byText["חבל על הזמן"]!.punctuation).toEqual({ kind: "fixed", mark: ".." });
    expect(byText["אין על זה, אין"]!.punctuation).toEqual({ kind: "fixed", mark: "." });
  });

  it("the plural-only closer is audience-axis", () => {
    for (const c of CLOSER_TEMPLATES.filter((c) => c.pluralOnly)) {
      expect(c.agrees).toBe("audience");
    }
  });
});

describe("pickClosers", () => {
  it("returns the requested count when the tone has enough closers", () => {
    expect(pickClosers("friendly")).toHaveLength(CLOSER_OPTIONS_PER_GENERATION);
    expect(pickClosers("friendly", 5)).toHaveLength(5);
  });

  it("is capped at the size of the tone's pool", () => {
    const friendly = CLOSER_TEMPLATES.filter((c) => c.tones.includes("friendly")).length;
    expect(pickClosers("friendly", friendly + 10)).toHaveLength(friendly);
  });

  it("filters by tone", () => {
    for (const tone of TONES) {
      for (let i = 0; i < 20; i++) {
        for (const c of pickClosers(tone)) expect(c.tones, `${tone}: ${c.text}`).toContain(tone);
      }
    }
  });

  it("is never empty, for any tone", () => {
    for (const tone of TONES) expect(pickClosers(tone).length, tone).toBeGreaterThanOrEqual(1);
  });

  it("never repeats a closer within one pick, and only picks from the pool", () => {
    for (let i = 0; i < 30; i++) {
      const picked = pickClosers("friendly");
      expect(new Set(picked.map((c) => c.text)).size).toBe(picked.length);
      for (const c of picked) expect(CLOSER_TEMPLATES).toContain(c);
    }
  });

  it("varies across calls", () => {
    const draws = new Set(
      Array.from({ length: 20 }, () =>
        pickClosers("friendly")
          .map((c) => c.text)
          .join("|"),
      ),
    );
    expect(draws.size).toBeGreaterThan(1);
  });
});

describe("describeCloser", () => {
  const byText = Object.fromEntries(CLOSER_TEMPLATES.map((c) => [c.text, c])) as Record<
    string,
    CloserTemplate
  >;

  it("an exclamation, speaker-axis closer", () => {
    expect(describeCloser(byText["הכי ממליצה בעולם"]!)).toBe(
      '"הכי ממליצה בעולם" + 1 to 4 exclamation marks (4 = most casual) — conjugate speaker gender only',
    );
  });

  it("a two-dot closer with nothing to conjugate", () => {
    expect(describeCloser(byText["חבל על הזמן"]!)).toBe(
      '"חבל על הזמן.." — copy exactly, two dots, nothing to conjugate',
    );
  });

  it("a plural-only audience closer", () => {
    expect(describeCloser(byText["תודו לי אחר כך"]!)).toBe(
      '"תודו לי אחר כך." — plural audience only; copy exactly',
    );
  });

  it("a fixed-dot, speaker-axis closer and an audience closer that conjugates", () => {
    expect(describeCloser(byText["אני לא חוזרת אחורה"]!)).toBe(
      '"אני לא חוזרת אחורה." — conjugate speaker gender only',
    );
    expect(describeCloser(byText["תנסו ותגידו לי"]!)).toMatch(
      /^"תנסו ותגידו לי\." — conjugate only the audience form/,
    );
  });

  it("shows every closer's text with its punctuation attached", () => {
    for (const c of CLOSER_TEMPLATES) {
      const line = describeCloser(c);
      if (c.punctuation.kind === "fixed")
        expect(line).toContain(`"${c.text}${c.punctuation.mark}"`);
      else expect(line).toContain(`"${c.text}" + 1 to ${c.punctuation.max} exclamation marks`);
    }
  });
});

// Mirrors how generateBScript formats its prompt variables.
function bScriptVars(closers: CloserTemplate[]) {
  return {
    questionnaire: JSON.stringify({ product_name: "קרם הפנים", tone: "friendly" }, null, 2),
    persona: JSON.stringify({ name: "נועה", gender: "f" }),
    persona_gender: "female",
    skeleton: JSON.stringify({ beats: ["hook", "story", "close"] }, null, 2),
    hook_options: pickHookTemplates()
      .map((t, i) => `${i + 1}. ${t}`)
      .join("\n"),
    closer_options: closers.map((c, i) => `${i + 1}. ${describeCloser(c)}`).join("\n"),
    pointers: "(אין — התבסס על השאלון בלבד)",
    word_budget: 33,
    words_per_second: 2.2,
    duration_preset: 15,
  };
}

describe("b_script prompt rendering — closers (v12+)", () => {
  const closers = pickClosers("friendly");
  let text: string;
  let promptVersion: string;

  // In a hook, not the describe body: a template/vars mismatch (renderPrompt
  // throws on a missing {{var}}) then fails these tests by name instead of
  // failing the whole file at collection.
  beforeAll(() => {
    ({ text, promptVersion } = renderPrompt("b_script", bScriptVars(closers)));
  });

  it("is v12 or later", () => {
    expect(Number(promptVersion.split("@v")[1])).toBeGreaterThanOrEqual(12);
  });

  it("shows the offered closers, numbered, and no unreplaced placeholders", () => {
    closers.forEach((c, i) => expect(text).toContain(`${i + 1}. ${describeCloser(c)}`));
    expect(text).toContain("Closers — the script ends on ONE of these, copied verbatim");
    expect(text).not.toMatch(/\{\{\w+\}\}/);
  });

  it("puts the name before the advantages and the closer last", () => {
    const name = text.indexOf("3. The name, casually");
    const advantages = text.indexOf("4. The one or two strongest advantages");
    const closer = text.indexOf("5. The closer");
    expect(name).toBeGreaterThan(0);
    expect(advantages).toBeGreaterThan(name);
    expect(closer).toBeGreaterThan(advantages);
    expect(text).toContain("Nothing follows the closer");
  });

  it("no longer carries the fixed verdict close", () => {
    expect(text).not.toContain("ממליצה בחום");
    expect(text).not.toContain("הלינק למטה");
    expect(text).not.toContain("שווה לך לבדוק");
    expect(text).not.toContain("After the name, say almost nothing");
  });

  it("states the conjugation and punctuation rules for closers", () => {
    expect(text).toContain("`ממליצה` → `ממליץ`");
    expect(text).toContain("`תנסו` → `תנסי`");
    expect(text).toContain("plural-audience-only");
    expect(text).toContain("never 0");
    expect(text).toContain("two full stops by design, not an ellipsis");
    expect(text).toContain("`!!!!` is deliberate");
    expect(text).toContain("אני לא חוזרת אחורה (female)");
    expect(text).toContain("אני לא חוזר אחורה (male)");
  });

  it("carries the naming policy and drops the stale emotion-tag note", () => {
    expect(text).toContain("ChatGPT, Google, Excel, WhatsApp");
    expect(text).toContain("any direct competitor of this customer");
    expect(text).toContain("defective, unsafe, illegal or fraudulent");
    expect(text).not.toContain("emotion is added automatically");
    expect(text).toContain("anything in brackets is read aloud");
  });
});

describe("generateBScript (dry-run, real DB)", () => {
  let db: Db;
  let pg: { close(): Promise<void> };
  let personaId: string;
  let structureId: string;
  const businessIds: Partial<Record<Questionnaire["tone"], string>> = {};

  beforeAll(async () => {
    process.env.DRY_RUN = "1";
    resetEnvCache();
    const testDb = await createTestDb();
    db = testDb.db;
    pg = testDb.pg;
    for (const tone of TONES) {
      const business = await createBusiness(db, {
        ownerEmail: `founder+${tone}@example.com`,
        name: `קרם הפנים ${tone}`,
        ownerRole: "admin",
      });
      businessIds[tone] = business.id;
      await setQuestionnaire(db, business.id, {
        category: "physical_product",
        product_name: "קרם הפנים",
        what_it_does: "קרם לחות טבעי לעור רגיש",
        advantages: ["רכיבים טבעיים בלבד"],
        target_audience: "נשים 25-45",
        tone,
      });
    }
    personaId = (await addPersona(db, { name: "נועה", voiceId: "voice_noa" })).id;
    structureId = (
      await addStructure(db, {
        title: "show-and-react",
        skeleton: { beats: ["hook", "react", "close"] },
      })
    ).id;
  });

  afterAll(async () => {
    await pg.close();
  });

  it("records the offered closers on scripts.params, filtered by the business's tone", async () => {
    for (const tone of TONES) {
      const script = await generateBScript(db, {
        businessId: businessIds[tone]!,
        personaId,
        structureId,
      });
      const { closers, hookTemplates } = script.params as {
        closers: string[];
        hookTemplates: string[];
      };
      expect(hookTemplates, tone).toBeDefined();
      // Deterministic: min(3, the tone's pool) — 3 / 3 / 2 for friendly / direct / professional.
      const pool = CLOSER_TEMPLATES.filter((c) => c.tones.includes(tone)).length;
      expect(closers, tone).toHaveLength(Math.min(CLOSER_OPTIONS_PER_GENERATION, pool));
      expect(new Set(closers).size).toBe(closers.length);
      for (const text of closers) {
        const template = CLOSER_TEMPLATES.find((c) => c.text === text);
        expect(template, `${tone}: ${text}`).toBeDefined();
        expect(template!.tones, `${tone}: ${text}`).toContain(tone);
      }
    }
  });
});

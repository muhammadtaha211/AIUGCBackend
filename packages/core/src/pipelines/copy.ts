import { eq } from "drizzle-orm";
import { z } from "zod";
import { getConfigValue } from "../appConfig";
import { recordUsage } from "../budget";
import { getEnv, wordsPerSecondSchema } from "../config";
import type { Db } from "../db";
import { demos, events, personas, scripts, structures } from "../db/schema";
import { pickHookTemplates } from "../hook-templates";
import { logger } from "../logger";
import { generateObject } from "../providers/anthropic";
import { renderPrompt } from "../prompts";
import { requireQuestionnaire } from "./businesses";

type Script = typeof scripts.$inferSelect;

/** Rough cost bookkeeping: sonnet input $3 / output $15 per MTok, ~370 agorot/USD. */
function llmCostAgorot(inputTokens: number, outputTokens: number): number {
  return Math.ceil(((inputTokens * 3 + outputTokens * 15) / 1_000_000) * 370);
}

async function callClaude<T>(
  db: Db,
  businessId: string,
  promptName: string,
  vars: Record<string, string | number>,
  schema: z.ZodType<T>,
): Promise<{ object: T; promptVersion: string }> {
  const { text, promptVersion } = renderPrompt(promptName, vars);
  const { object, usage } = await generateObject({ prompt: text, schema });
  await recordUsage(db, {
    provider: "anthropic",
    kind: "llm_tokens",
    quantity: usage.inputTokens + usage.outputTokens,
    costEstimateAgorot: llmCostAgorot(usage.inputTokens, usage.outputTokens),
    businessId,
  });
  return { object, promptVersion };
}

async function wordsPerSecond(db: Db, voiceId?: string): Promise<number> {
  const wps = await getConfigValue(db, "words_per_second", wordsPerSecondSchema);
  return (voiceId && wps[voiceId]) || wps.default || 2.2;
}

// ---------------------------------------------------------------------------
// Hook lines (Service A, step 4)
// ---------------------------------------------------------------------------

// `angle` stays a free string: the set of angles is defined by the prompt file
// (prompts/hook_lines/v<N>.md), and iterating a prompt must never need a code
// change.
const hookLinesOutput = z.object({
  options: z.array(z.object({ text: z.string(), angle: z.string() })),
});

/**
 * One line per frame in the prompt's frame library. The prompt always writes
 * all ten at equal effort — `n` only decides how many rows we keep, so a
 * smaller `n` head-slices the frame order (fine for `copy hooks --n 3`).
 */
export const HOOK_LINE_FRAMES = 10;

/** Frame order matches prompts/hook_lines/v7.md — the wizard interleaves on index. */
const CANNED_HOOK_LINES = [
  { text: "POV: מישהו שאל אותי איך עשיתי את זה", angle: "pov_scene" },
  { text: "סליחה, ככה עושים את זה עכשיו???", angle: "disbelief" },
  { text: "מצאתי דירה לפני כולם ולא מאמינה שהיה קל", angle: "disbelief_at_ease" },
  { text: "חושבת על כל הזמן שבזבזתי על זה", angle: "regret_waste" },
  { text: "עשיתי את זה ב-0 שקל... זה נורמלי?", angle: "humblebrag_uncertainty" },
  { text: "אני יכולה להתחתן עם מי ששלח לי את זה", angle: "absurd_affection" },
  { text: "מזתומרת מצאו דרך לעשות את זה בדקה", angle: "generational" },
  { text: '"אין לי זמן ללמוד" — יאללה, בסדר', angle: "quoted_objection" },
  { text: "זהו. נגמר. השתנה לי כל הסמסטר", angle: "era_declaration" },
  { text: "בגלל זה כולם מוחקים את ChatGPT", angle: "hidden_method" },
];

/**
 * Characters that survive the burn: Hebrew, Latin, digits, ASCII punctuation,
 * plus the typographic marks that render correctly inside an RTL line. Anything
 * else — Arabic script, zero-width joiners, formatting marks — either burns as
 * a stray glyph or corrupts the line invisibly. A v6 run emitted U+0640 ARABIC
 * TATWEEL inside `לـAI`.
 */
// Written as escapes, not literals: a Hebrew range inside a character class
// reorders in every editor that renders bidi.
const ILLEGAL_HOOK_LINE_CHAR = new RegExp(
  "[^" +
    "\\u0020-\\u007E" + // space, digits, Latin, ASCII punctuation
    "\\u0590-\\u05FF" + // the Hebrew block
    "\\u2013\\u2014\\u2018\\u2019\\u201C\\u201D\\u2026\\u20AA" + // – — ‘ ’ “ ” … ₪
    "]",
  "u",
);

/** The first unrenderable character in a batch, described for an error message. */
export function findIllegalHookLineChar(
  options: { text: string }[],
): { char: string; codepoint: string; text: string } | undefined {
  for (const option of options) {
    const char = ILLEGAL_HOOK_LINE_CHAR.exec(option.text)?.[0];
    if (char !== undefined) {
      const hex = char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");
      return { char, codepoint: `U+${hex}`, text: option.text };
    }
  }
  return undefined;
}

export async function generateHookLines(
  db: Db,
  opts: {
    businessId: string;
    n?: number;
    /** Lines already written for this business this session — not to be repeated. */
    avoid?: string[];
    /** The speaker: hook lines are first-person, and Hebrew first person is gendered. */
    personaId?: string;
  },
): Promise<Script[]> {
  const n = opts.n ?? HOOK_LINE_FRAMES;
  const questionnaire = await requireQuestionnaire(db, opts.businessId);

  // Same resolution as generateVoScript: nullable column -> female + warn.
  let personaGender = "female";
  if (opts.personaId) {
    const personaRows = await db
      .select()
      .from(personas)
      .where(eq(personas.id, opts.personaId))
      .limit(1);
    const persona = personaRows[0];
    if (!persona) throw new Error(`persona ${opts.personaId} not found`);
    if (persona.gender) {
      personaGender = persona.gender;
    } else {
      logger.warn({ personaId: persona.id }, "persona has no gender; defaulting speaker to female");
    }
  } else {
    logger.warn(
      { businessId: opts.businessId },
      "hook lines without a persona; defaulting speaker to female",
    );
  }

  const vars = {
    questionnaire: JSON.stringify(questionnaire, null, 2),
    avoid: opts.avoid?.length
      ? opts.avoid.map((line) => `- ${line}`).join("\n")
      : "(אין — זו הקבוצה הראשונה)",
    persona_gender: personaGender,
  };

  let options: { text: string; angle: string }[];
  let promptVersion: string;
  if (getEnv().DRY_RUN) {
    // Dry-run still renders the template so prompt_version stays traceable and
    // a template/vars mismatch surfaces in tests, not in production.
    ({ promptVersion } = renderPrompt("hook_lines", vars));
    options = Array.from({ length: n }, (_, i) => CANNED_HOOK_LINES[i % CANNED_HOOK_LINES.length]!);
  } else {
    const generate = async () => {
      const result = await callClaude(db, opts.businessId, "hook_lines", vars, hookLinesOutput);
      return { options: result.object.options.slice(0, n), promptVersion: result.promptVersion };
    };

    // Reject-and-retry, never sanitise. A hook line is the artifact the
    // customer approves and we burn into the frame, so dropping a character
    // silently would ship text nobody signed off on — and a stray glyph is
    // unfixable once rendered. (tts_enhance fails open because it guards an
    // enhancement; this guards the artifact itself.)
    let batch = await generate();
    let bad = findIllegalHookLineChar(batch.options);
    if (bad) {
      logger.warn(
        { businessId: opts.businessId, codepoint: bad.codepoint },
        "hook lines contain an unrenderable character — regenerating once",
      );
      batch = await generate();
      bad = findIllegalHookLineChar(batch.options);
      if (bad) {
        throw new Error(
          `hook lines contain an unrenderable character ${bad.codepoint} ` +
            `in "${bad.text}" — regenerated once and it recurred`,
        );
      }
    }
    ({ options, promptVersion } = batch);
  }

  const rows = await db
    .insert(scripts)
    .values(
      options.map((option) => ({
        businessId: opts.businessId,
        kind: "hook_line" as const,
        text: option.text,
        params: { angle: option.angle },
        promptVersion,
      })),
    )
    .returning();
  return rows;
}

// ---------------------------------------------------------------------------
// Silent variant benefit captions (Service A, step 5)
// ---------------------------------------------------------------------------

const captionsOutput = z.object({ captions: z.array(z.string()) });

export async function generateBenefitCaptions(
  db: Db,
  opts: { businessId: string; demoId: string; n?: number },
): Promise<Script> {
  const n = opts.n ?? 6;
  const questionnaire = await requireQuestionnaire(db, opts.businessId);
  const demo = await getReadyDemo(db, opts.demoId);

  let captions: string[];
  let promptVersion = "dry_run";
  if (getEnv().DRY_RUN) {
    captions = [
      "זה הפתרון שחיפשתם",
      "פשוט מצלמים ומתחילים",
      "חוסך שעות כל שבוע",
      "עובד מכל טלפון",
      "בלי התחייבות",
      "נסו עכשיו — הקישור בפרופיל",
    ].slice(0, n);
  } else {
    const result = await callClaude(
      db,
      opts.businessId,
      "benefit_captions",
      {
        questionnaire: JSON.stringify(questionnaire, null, 2),
        demo_seconds: Math.round((demo.durationMs ?? 0) / 1000),
        n,
      },
      captionsOutput,
    );
    captions = result.object.captions;
    promptVersion = result.promptVersion;
  }

  const rows = await db
    .insert(scripts)
    .values({
      businessId: opts.businessId,
      demoId: opts.demoId,
      kind: "benefit_captions",
      text: captions.join("\n"),
      params: { lines: captions },
      promptVersion,
    })
    .returning();
  return rows[0]!;
}

// ---------------------------------------------------------------------------
// Voiced variant script (Service A, step 6) — word budget from demo duration
// ---------------------------------------------------------------------------

const scriptOutput = z.object({ script: z.string() });

export async function generateVoScript(
  db: Db,
  opts: {
    businessId: string;
    demoId: string;
    /** Questionnaire advantages the user ticked as visible in the footage. */
    selectedAdvantages: string[];
    /** Derives the voice (persona.voiceId) and is recorded on the script row. */
    personaId?: string;
    /** Explicit voice — the CLI escape hatch; wins over the persona's voice. */
    voiceId?: string;
    /** The chosen hook line, so the opener escalates past it instead of repeating it. */
    hookLineText?: string;
  },
): Promise<Script> {
  const questionnaire = await requireQuestionnaire(db, opts.businessId);
  const demo = await getReadyDemo(db, opts.demoId);

  let voiceId = opts.voiceId;
  // v5 speaks first-person as the persona, so the prompt needs the speaker's
  // gender even when the voice was passed explicitly (the CLI's --voice).
  let personaGender = "female";
  if (opts.personaId) {
    const personaRows = await db
      .select()
      .from(personas)
      .where(eq(personas.id, opts.personaId))
      .limit(1);
    const persona = personaRows[0];
    if (!persona) throw new Error(`persona ${opts.personaId} not found`);
    voiceId = voiceId ?? persona.voiceId;
    if (persona.gender) {
      personaGender = persona.gender;
    } else {
      logger.warn({ personaId: persona.id }, "persona has no gender; defaulting speaker to female");
    }
  } else {
    logger.warn(
      { businessId: opts.businessId },
      "vo script without a persona; defaulting speaker to female",
    );
  }

  const demoSeconds = Math.round((demo.durationMs ?? 0) / 1000);
  const wps = await wordsPerSecond(db, voiceId);
  // A FLOOR, not a cap — the length that fills the demo. Coming in under it is
  // the only unrecoverable outcome (the demo is muted under the VO, so a short
  // script ends the ad in silence); running over becomes an ending, which
  // planAOutro shapes and the advisory prices. v7 states it to the model that
  // way round. Kept as `wordBudget` because scripts.params persists the name.
  const wordBudget = Math.floor(demoSeconds * wps);
  // Soft grounding from the demo row (customer-typed, optional). Snapshotted
  // into params below — the demo row stays editable, scripts must stay traceable.
  const demoDescription = demo.description?.trim() || undefined;

  let text: string;
  let promptVersion = "dry_run";
  if (getEnv().DRY_RUN) {
    const filler =
      "אני כבר לא חוזרת לעשות את זה ידנית בזבזתי שעתיים על באנר אחד ובסוף עשיתי אותו מחדש " +
      "ואז מצאתי משהו שסגר לי את זה כאילו הכל במסך אחד תוך שתי דקות תבדקו לבד";
    // 115% of the budget, repeating the filler when it runs out. Slicing to
    // exactly wordBudget made a dry run incapable of overrunning, so freeze and
    // avatar endings were unreachable without an API key; at 115% the dry-run
    // synthesizer's words/2.2 lands past MAX_STRETCH and the ending path runs.
    const fillerWords = filler.split(" ");
    const target = Math.ceil(wordBudget * 1.15);
    text = Array.from({ length: target }, (_, i) => fillerWords[i % fillerWords.length]!).join(" ");
  } else {
    const result = await callClaude(
      db,
      opts.businessId,
      "vo_script",
      {
        questionnaire: JSON.stringify(questionnaire, null, 2),
        selected_advantages: opts.selectedAdvantages.map((a) => `- ${a}`).join("\n"),
        demo_description: demoDescription ?? "(אין — התבסס על השאלון בלבד)",
        hook_line: opts.hookLineText ?? "(אין — משפט הפתיחה לא ידוע)",
        demo_seconds: demoSeconds,
        word_budget: wordBudget,
        words_per_second: wps,
        persona_gender: personaGender,
      },
      scriptOutput,
    );
    text = result.object.script;
    promptVersion = result.promptVersion;
  }

  const rows = await db
    .insert(scripts)
    .values({
      businessId: opts.businessId,
      demoId: opts.demoId,
      personaId: opts.personaId,
      kind: "vo_script",
      text,
      params: {
        selectedAdvantages: opts.selectedAdvantages,
        wordBudget,
        voiceId,
        demoDescription,
        hookLineText: opts.hookLineText,
      },
      promptVersion,
    })
    .returning();
  return rows[0]!;
}

// ---------------------------------------------------------------------------
// Service B script — adapt a curated structure skeleton to the product,
// steered by the customer's rough pointers when they typed any
// ---------------------------------------------------------------------------

const durationPresetSchema = z.union([z.literal(15), z.literal(30)]);

export async function generateBScript(
  db: Db,
  opts: {
    businessId: string;
    personaId: string;
    structureId: string;
    /** Rough free-text notes from the customer on what the avatar should say. */
    pointers?: string;
    /** Target video length in seconds; 15 or 30. */
    durationPreset?: number;
  },
): Promise<Script> {
  const questionnaire = await requireQuestionnaire(db, opts.businessId);
  const durationPreset = durationPresetSchema.parse(opts.durationPreset ?? 30);
  const pointers = opts.pointers?.trim() || undefined;

  const personaRows = await db
    .select()
    .from(personas)
    .where(eq(personas.id, opts.personaId))
    .limit(1);
  const persona = personaRows[0];
  if (!persona) throw new Error(`persona ${opts.personaId} not found`);

  const structureRows = await db
    .select()
    .from(structures)
    .where(eq(structures.id, opts.structureId))
    .limit(1);
  const structure = structureRows[0];
  if (!structure) throw new Error(`structure ${opts.structureId} not found`);

  const wps = await wordsPerSecond(db, persona.voiceId);
  const wordBudget = Math.floor(durationPreset * wps);

  let personaGender = persona.gender;
  if (!personaGender) {
    logger.warn({ personaId: persona.id }, "persona has no gender; defaulting speaker to female");
    personaGender = "female";
  }

  const hookTemplates = pickHookTemplates();
  const vars = {
    questionnaire: JSON.stringify(questionnaire, null, 2),
    persona: JSON.stringify({ name: persona.name, ...(persona.identity as object) }),
    persona_gender: personaGender,
    skeleton: JSON.stringify(structure.skeleton, null, 2),
    hook_options: hookTemplates.map((t, i) => `${i + 1}. ${t}`).join("\n"),
    pointers: pointers ?? "(אין — התבסס על השאלון בלבד)",
    word_budget: wordBudget,
    words_per_second: wps,
    duration_preset: durationPreset,
  };

  let text: string;
  let promptVersion: string;
  if (getEnv().DRY_RUN) {
    // Dry-run still renders the template so prompt_version stays traceable and
    // a template/vars mismatch surfaces in tests, not in production.
    ({ promptVersion } = renderPrompt("b_script", vars));
    text =
      "חייבת לספר לכם על משהו שגיליתי השבוע ניסיתי את זה בספקנות מוחלטת ותוך יום " +
      "הבנתי שאין סיכוי שאני חוזרת אחורה זה עושה בדיוק מה שהבטיחו תבדקו בעצמכם";
  } else {
    const result = await callClaude(db, opts.businessId, "b_script", vars, scriptOutput);
    text = result.object.script;
    promptVersion = result.promptVersion;
  }

  const rows = await db
    .insert(scripts)
    .values({
      businessId: opts.businessId,
      personaId: opts.personaId,
      structureId: opts.structureId,
      kind: "b_script",
      text,
      // hookTemplates: the exact openers offered this generation, so a winning
      // hook can be traced back to its template later.
      params: { pointers, durationPreset, wordBudget, hookTemplates },
      promptVersion,
    })
    .returning();
  return rows[0]!;
}

/**
 * Reject text over the word budget. The web edit path ("write it myself" /
 * post-generation edits) calls this before updateScriptText, so an oversized
 * script never reaches TTS.
 */
export function assertWithinWordBudget(text: string, wordBudget: number): void {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words > wordBudget) {
    throw new Error(`התסריט ארוך מדי: ${words} מילים, המקסימום הוא ${wordBudget}`);
  }
}

// ---------------------------------------------------------------------------
// Content policy (Service A — B is covered by the founder QC gate)
// ---------------------------------------------------------------------------

const policyOutput = z.object({
  flagged: z.boolean(),
  category: z.string().nullable(),
  reason: z.string().nullable(),
});

export async function contentPolicyCheck(
  db: Db,
  opts: { businessId: string; text: string },
): Promise<{ flagged: boolean; category?: string; reason?: string }> {
  if (getEnv().DRY_RUN) return { flagged: false };

  const { object } = await callClaude(
    db,
    opts.businessId,
    "content_policy",
    { text: opts.text },
    policyOutput,
  );
  if (object.flagged) {
    await db.insert(events).values({
      kind: "content_policy_flag",
      businessId: opts.businessId,
      payload: { category: object.category, reason: object.reason },
    });
    return {
      flagged: true,
      category: object.category ?? undefined,
      reason: object.reason ?? undefined,
    };
  }
  return { flagged: false };
}

// ---------------------------------------------------------------------------

async function getReadyDemo(db: Db, demoId: string) {
  const rows = await db.select().from(demos).where(eq(demos.id, demoId)).limit(1);
  const demo = rows[0];
  if (!demo) throw new Error(`demo ${demoId} not found`);
  if (demo.status !== "ready") {
    throw new Error(`demo ${demoId} is not ready (status: ${demo.status})`);
  }
  return demo;
}

export async function updateScriptText(db: Db, scriptId: string, text: string): Promise<Script> {
  // User edits create a NEW row (scripts are immutable once audio references them).
  const rows = await db.select().from(scripts).where(eq(scripts.id, scriptId)).limit(1);
  const original = rows[0];
  if (!original) throw new Error(`script ${scriptId} not found`);
  const inserted = await db
    .insert(scripts)
    .values({
      businessId: original.businessId,
      demoId: original.demoId,
      personaId: original.personaId,
      structureId: original.structureId,
      kind: original.kind,
      text,
      params: original.params as Record<string, unknown>,
      promptVersion: original.promptVersion,
      userEdited: true,
    })
    .returning();
  return inserted[0]!;
}

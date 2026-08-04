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

export async function generateHookLines(
  db: Db,
  opts: { businessId: string; n?: number },
): Promise<Script[]> {
  const n = opts.n ?? 6;
  const questionnaire = await requireQuestionnaire(db, opts.businessId);

  let options: { text: string; angle: string }[];
  let promptVersion = "dry_run";
  if (getEnv().DRY_RUN) {
    const canned = [
      { text: "הדבר הזה חסך לי שעה ביום", angle: "pain" },
      { text: "לא האמנתי שזה באמת עובד", angle: "feature" },
      { text: "עולה פחות מקפה בחודש", angle: "price" },
    ];
    options = Array.from({ length: n }, (_, i) => canned[i % canned.length]!);
  } else {
    const result = await callClaude(
      db,
      opts.businessId,
      "hook_lines",
      { questionnaire: JSON.stringify(questionnaire, null, 2), n },
      hookLinesOutput,
    );
    options = result.object.options;
    promptVersion = result.promptVersion;
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
    /** Override for the length-fit regeneration path. */
    wordBudgetOverride?: number;
  },
): Promise<Script> {
  const questionnaire = await requireQuestionnaire(db, opts.businessId);
  const demo = await getReadyDemo(db, opts.demoId);

  let voiceId = opts.voiceId;
  if (!voiceId && opts.personaId) {
    const personaRows = await db
      .select()
      .from(personas)
      .where(eq(personas.id, opts.personaId))
      .limit(1);
    if (!personaRows[0]) throw new Error(`persona ${opts.personaId} not found`);
    voiceId = personaRows[0].voiceId;
  }

  const demoSeconds = Math.round((demo.durationMs ?? 0) / 1000);
  const wps = await wordsPerSecond(db, voiceId);
  const wordBudget = opts.wordBudgetOverride ?? Math.floor(demoSeconds * wps);
  // Soft grounding from the demo row (customer-typed, optional). Snapshotted
  // into params below — the demo row stays editable, scripts must stay traceable.
  const demoDescription = demo.description?.trim() || undefined;

  let text: string;
  let promptVersion = "dry_run";
  if (getEnv().DRY_RUN) {
    const filler =
      "פותחים את האפליקציה ומיד רואים כמה זה פשוט הכל במקום אחד בלי הגדרות מסובכות " +
      "מנסים פעם אחת ומבינים כמה זמן זה חוסך כל יום שווה לנסות עכשיו";
    text = filler.split(" ").slice(0, wordBudget).join(" ");
  } else {
    const result = await callClaude(
      db,
      opts.businessId,
      "vo_script",
      {
        questionnaire: JSON.stringify(questionnaire, null, 2),
        selected_advantages: opts.selectedAdvantages.map((a) => `- ${a}`).join("\n"),
        demo_description: demoDescription ?? "(אין — התבסס על השאלון בלבד)",
        demo_seconds: demoSeconds,
        word_budget: wordBudget,
        words_per_second: wps,
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
      params: { selectedAdvantages: opts.selectedAdvantages, wordBudget, voiceId, demoDescription },
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

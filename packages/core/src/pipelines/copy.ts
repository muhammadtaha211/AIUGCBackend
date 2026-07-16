import { eq } from "drizzle-orm";
import { z } from "zod";
import { getConfigValue } from "../appConfig";
import { recordUsage } from "../budget";
import { getEnv, wordsPerSecondSchema } from "../config";
import type { Db } from "../db";
import { demos, events, personas, scripts, structures } from "../db/schema";
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

const hookLinesOutput = z.object({
  options: z.array(z.object({ text: z.string(), angle: z.enum(["pain", "feature", "price"]) })),
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
    /** Questionnaire features the user ticked as visible in the footage. */
    selectedFeatures: string[];
    voiceId?: string;
    /** Override for the length-fit regeneration path. */
    wordBudgetOverride?: number;
  },
): Promise<Script> {
  const questionnaire = await requireQuestionnaire(db, opts.businessId);
  const demo = await getReadyDemo(db, opts.demoId);
  const demoSeconds = Math.round((demo.durationMs ?? 0) / 1000);
  const wps = await wordsPerSecond(db, opts.voiceId);
  const wordBudget = opts.wordBudgetOverride ?? Math.floor(demoSeconds * wps);

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
        selected_features: opts.selectedFeatures.map((f) => `- ${f}`).join("\n"),
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
      kind: "vo_script",
      text,
      params: { selectedFeatures: opts.selectedFeatures, wordBudget, voiceId: opts.voiceId },
      promptVersion,
    })
    .returning();
  return rows[0]!;
}

// ---------------------------------------------------------------------------
// Service B script — adapt a curated structure skeleton to the product
// ---------------------------------------------------------------------------

export async function generateBScript(
  db: Db,
  opts: { businessId: string; personaId: string; structureId: string; targetSeconds?: number },
): Promise<Script> {
  const questionnaire = await requireQuestionnaire(db, opts.businessId);
  const targetSeconds = opts.targetSeconds ?? 30;

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
  const wordBudget = Math.floor(targetSeconds * wps);

  let text: string;
  let promptVersion = "dry_run";
  if (getEnv().DRY_RUN) {
    text =
      "חייבת לספר לכם על משהו שגיליתי השבוע ניסיתי את זה בספקנות מוחלטת ותוך יום " +
      "הבנתי שאין סיכוי שאני חוזרת אחורה זה עושה בדיוק מה שהבטיחו תבדקו בעצמכם";
  } else {
    const result = await callClaude(
      db,
      opts.businessId,
      "b_script",
      {
        questionnaire: JSON.stringify(questionnaire, null, 2),
        persona: JSON.stringify({ name: persona.name, ...(persona.identity as object) }),
        skeleton: JSON.stringify(structure.skeleton, null, 2),
        word_budget: wordBudget,
        words_per_second: wps,
        target_seconds: targetSeconds,
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
      personaId: opts.personaId,
      structureId: opts.structureId,
      kind: "b_script",
      text,
      params: { targetSeconds, wordBudget },
      promptVersion,
    })
    .returning();
  return rows[0]!;
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

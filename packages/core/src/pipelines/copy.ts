import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getConfigValue } from "../appConfig";
import { assertBudget, recordUsage } from "../budget";
import { getEnv, wordsPerSecondSchema } from "../config";
import type { Db } from "../db";
import { describeCloser, pickClosers } from "../closer-templates";
import { demos, events, personas, scripts, structures, textBlockClips } from "../db/schema";
import { hookTextError } from "../hook-text";
import { pickHookTemplates } from "../hook-templates";
import { PermanentError } from "../jobs/errors";
import { logger } from "../logger";
import { llmCostAgorot } from "../pricing";
import { generateObject } from "../providers/anthropic";
import { renderPrompt } from "../prompts";
import {
  findGeneratedTextBlockDash,
  fittingTextBlockSkeletons,
  isTextBlockSkeletonId,
  normalizeTextBlockText,
  speakerGenderSchema,
  TEXT_BLOCK_EXAMPLES,
  textBlockTextError,
  type TextBlockSkeletonId,
} from "../text-block";
import { getBusiness, questionnaireSchema, requireQuestionnaire } from "./businesses";

type Script = typeof scripts.$inferSelect;

async function callClaude<T>(
  db: Db,
  businessId: string,
  promptName: string,
  vars: Record<string, string | number>,
  schema: z.ZodType<T>,
  opts?: {
    maxTokens?: number;
    /** Appended under the rendered prompt — a corrective message naming what
     *  the previous answer missed, the way correctivePrompt appends
     *  (demo-analysis.ts), so the prompt file stays the shipped one. */
    appendix?: string;
  },
): Promise<{ object: T; promptVersion: string }> {
  const { text, promptVersion } = renderPrompt(promptName, vars);
  const { object, usage } = await generateObject({
    prompt: opts?.appendix ? `${text}\n\n${opts.appendix}` : text,
    schema,
    maxTokens: opts?.maxTokens,
  });
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
// Text blocks (Service C, גוש טקסט — decisions 0089–0091)
// ---------------------------------------------------------------------------

// `skeleton` stays a free string on the wire: the ids are checked against the
// list in text-block.ts after the call, so an unknown one is a violation the
// retry can catch, not a parse failure nobody can read.
const textBlocksOutput = z.object({
  texts: z.array(z.object({ skeleton: z.string(), text: z.string() })),
  skipped: z.array(z.object({ skeleton: z.string(), reason: z.string() })),
});

/**
 * Ten Hebrew texts of up to 450 characters each, plus the skipped list, do
 * not fit generateObject's 4096 default (Hebrew tokenises at roughly one token
 * per character or two).
 */
const TEXT_BLOCK_MAX_TOKENS = 8192;

export type TextBlockBatch = {
  texts: Script[];
  /**
   * Skeletons the model judged a poor fit for this business, with its reason —
   * returned, never stored. `discovery` is listed here with a code-side reason
   * when the questionnaire has no `wow`, because it was never requested.
   */
  skipped: { skeleton: string; reason: string }[];
};

/** Shown in the admin studio's skipped list for a batch that never asked for `discovery`. */
export const TEXT_BLOCK_NO_WOW_REASON = "אין wow בשאלון";

/**
 * What a batch keeps of the model's answer before the checks: only the
 * requested skeletons (a known id the batch did not ask for is dropped and
 * logged, never stored — `discovery` without a `wow` must never reach a
 * customer, decision 0099 §5), and never one the model also listed in
 * `skipped` (a hedged answer is a skip). An UNKNOWN id is kept, so
 * textBlockBatchProblem still refuses it and the retry can catch it.
 */
function keepRequestedTextBlocks(
  batch: {
    texts: { skeleton: string; text: string }[];
    skipped: { skeleton: string; reason: string }[];
  },
  requested: readonly TextBlockSkeletonId[],
  businessId: string,
): {
  texts: { skeleton: string; text: string }[];
  skipped: { skeleton: string; reason: string }[];
} {
  const asked = new Set<string>(requested);
  const skippedIds = new Set(batch.skipped.map((entry) => entry.skeleton));
  const dropped: string[] = [];
  const texts = batch.texts.filter((entry) => {
    if (!isTextBlockSkeletonId(entry.skeleton)) return true;
    const keep = asked.has(entry.skeleton) && !skippedIds.has(entry.skeleton);
    if (!keep) dropped.push(entry.skeleton);
    return keep;
  });
  if (dropped.length > 0) {
    logger.warn(
      { businessId, dropped },
      "text blocks: dropped unrequested or also-skipped entries",
    );
  }
  return { texts, skipped: batch.skipped.filter((entry) => asked.has(entry.skeleton)) };
}

/**
 * Why a generated batch cannot be stored, or undefined when it can: every
 * skeleton id is one of the ten, none repeats, every text passes the burn
 * check (the character set and the cap) AND carries no en or em dash — the
 * generation-only rule (0091, amended 2026-10-07: an edited text is not
 * checked for it) — and there is at least one. The model is re-asked once on
 * a violation, with the same prompt (the hook-line pattern), then the batch
 * fails.
 */
export function textBlockBatchProblem(
  texts: { skeleton: string; text: string }[],
): string | undefined {
  if (texts.length === 0) return "the batch is empty";
  const seen = new Set<string>();
  for (const entry of texts) {
    if (!isTextBlockSkeletonId(entry.skeleton)) return `unknown skeleton "${entry.skeleton}"`;
    if (seen.has(entry.skeleton)) return `skeleton "${entry.skeleton}" appears twice`;
    seen.add(entry.skeleton);
    const problem = textBlockTextError(entry.text);
    if (problem) return `${entry.skeleton}: ${problem}`;
    const dash = findGeneratedTextBlockDash(entry.text);
    if (dash) return `${entry.skeleton}: a long dash (${dash}) where a plain hyphen belongs`;
  }
  return undefined;
}

/**
 * One text per skeleton that fits the business, in the speaker gender of the
 * clip it will burn over (text-block.ts has the rules). Each text is a
 * scripts row of kind text_block; the skipped skeletons come back with the
 * model's reason and are stored nowhere. The admin studio shows the whole
 * batch; the customer wizard serves it one text at a time
 * (serveNextTextBlock, decision 0099 R2).
 *
 * Only the fitting skeletons are requested (`{{skeletons}}`, text_block v3):
 * `discovery` never without a `wow`. Each row pins the questionnaire stamp it
 * was written against, so the wizard can tell a batch the questionnaire has
 * since outdated.
 */
export async function generateTextBlocks(
  db: Db,
  opts: { businessId: string; clipId: string },
): Promise<TextBlockBatch> {
  const business = await getBusiness(db, opts.businessId);
  if (!business.questionnaire) {
    throw new Error(`business ${opts.businessId} has no questionnaire yet — fill it first`);
  }
  const questionnaire = questionnaireSchema.parse(business.questionnaire);
  const questionnaireUpdatedAt = business.questionnaireUpdatedAt?.toISOString() ?? null;
  const requested = fittingTextBlockSkeletons(questionnaire);
  const clip = (
    await db.select().from(textBlockClips).where(eq(textBlockClips.id, opts.clipId)).limit(1)
  )[0];
  if (!clip) throw new Error(`text block clip ${opts.clipId} not found`);
  if (!clip.active) throw new Error(`text block clip ${opts.clipId} is not active`);
  const speakerGender = speakerGenderSchema.parse(clip.speakerGender);

  const vars = {
    questionnaire: JSON.stringify(questionnaire, null, 2),
    speaker_gender: speakerGender,
    skeletons: requested.map((id) => `\`${id}\``).join(", "),
  };

  let texts: { skeleton: string; text: string }[];
  let skipped: { skeleton: string; reason: string }[];
  let promptVersion: string;
  if (getEnv().DRY_RUN) {
    // Dry-run still renders the template so prompt_version stays traceable and
    // a template/vars mismatch surfaces in tests, not in production.
    ({ promptVersion } = renderPrompt("text_block", vars));
    texts = requested.map((skeleton) => ({ skeleton, text: TEXT_BLOCK_EXAMPLES[skeleton] }));
    skipped = [];
  } else {
    const generate = async () => {
      const result = await callClaude(db, opts.businessId, "text_block", vars, textBlocksOutput, {
        maxTokens: TEXT_BLOCK_MAX_TOKENS,
      });
      return {
        ...keepRequestedTextBlocks(result.object, requested, opts.businessId),
        promptVersion: result.promptVersion,
      };
    };

    // Reject-and-retry, never sanitise — the same stance as the hook lines: the
    // text is the artifact that gets burned, so nothing is dropped or trimmed
    // on its way to the frame.
    let batch = await generate();
    let problem = textBlockBatchProblem(batch.texts);
    if (problem) {
      logger.warn(
        { businessId: opts.businessId, problem },
        "text blocks failed the text check — regenerating once",
      );
      batch = await generate();
      problem = textBlockBatchProblem(batch.texts);
      if (problem) {
        throw new Error(
          `text blocks failed the text check (${problem}) — regenerated once and it recurred`,
        );
      }
    }
    ({ texts, skipped, promptVersion } = batch);
  }
  if (!requested.includes("discovery")) {
    skipped = [...skipped, { skeleton: "discovery", reason: TEXT_BLOCK_NO_WOW_REASON }];
  }

  const rows = await db
    .insert(scripts)
    .values(
      texts.map((entry) => ({
        businessId: opts.businessId,
        kind: "text_block" as const,
        text: normalizeTextBlockText(entry.text),
        params: {
          skeleton: entry.skeleton,
          textBlockClipId: clip.id,
          speakerGender,
          questionnaireUpdatedAt,
        },
        promptVersion,
      })),
    )
    .returning();
  return { texts: rows, skipped };
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
    voiceId = voiceId ?? persona.voiceId ?? undefined;
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

// Service B's own output contract (v9+). Deliberately NOT `scriptOutput`
// above: that schema is also what vo_script is parsed with, and a required
// hook_text there would fail every Service A voiced script that (correctly)
// has none.
const bScriptOutput = z.object({ script: z.string(), hook_text: z.string() });

/** DRY_RUN stand-in for the model's hook_text: the script's first five words. */
function dryRunHookText(script: string): string {
  return script.trim().split(/\s+/).slice(0, 5).join(" ");
}

/**
 * A hook_text outside the caps is a bad generation, never something to trim:
 * the string is burned into the frame, so nothing here silently shortens it.
 */
function assertHookText(hookText: string): string {
  const problem = hookTextError(hookText);
  if (problem) throw new PermanentError(problem);
  return hookText.trim();
}

/**
 * The model's own hook_text, or `hook_text`'s extraction when that misses a cap.
 *
 * b_script emits the on-screen line with the script, and the line is used as
 * written. When it comes back over a cap — "hook_text is 8 words — the cap is
 * 7", seen in production 2026-09-08 — the whole generation used to fail, so a
 * customer lost a good script to a bad hook line and got "try again". The
 * fallback re-derives the line from the finished script with `hook_text`
 * (prompts/hook_text/v2.md), a verbatim-prefix extractor under the same caps,
 * so the read-then-hear rule still holds. The extractor gets one corrective
 * call of its own when ITS line misses (deriveHookTextWithVersion, since
 * 2026-10-20); a miss after that throws, as before.
 *
 * Nothing is trimmed here: an over-cap line is still never silently shortened
 * (hook-text.ts) — it is replaced by a line the extractor cut on purpose.
 */
async function hookTextOrDerived(
  db: Db,
  opts: { businessId: string; script: string; candidate: string },
): Promise<{ hookText: string; derivedPromptVersion?: string }> {
  const problem = hookTextError(opts.candidate);
  if (!problem) return { hookText: opts.candidate.trim() };

  let derived: { hookText: string; promptVersion: string };
  try {
    const result = await deriveHookTextWithVersion(db, {
      businessId: opts.businessId,
      text: opts.script,
    });
    // Asserted here as well as inside the live derivation: DRY_RUN's stand-in
    // is not checked there, and this function must never return a line that
    // cannot be burned.
    derived = { hookText: assertHookText(result.hookText), promptVersion: result.promptVersion };
  } catch (err) {
    // Both candidates in one place: without this the thrown message names the
    // re-derived line's problem only, and the model's original is invisible.
    logger.warn(
      { businessId: opts.businessId, modelHookText: opts.candidate, problem, err },
      "b_script hook_text missed a cap and the re-derivation did too",
    );
    throw err;
  }
  logger.warn(
    {
      businessId: opts.businessId,
      modelHookText: opts.candidate,
      problem,
      derivedHookText: derived.hookText,
    },
    "b_script hook_text missed a cap; re-derived from the finished script",
  );
  return { hookText: derived.hookText, derivedPromptVersion: derived.promptVersion };
}

/**
 * Least-recently-used pick from the active structure bank, for this business.
 * A random pick repeated a skeleton roughly one regeneration in five with a
 * bank of five; rotating means five consecutive generations get five
 * different skeletons and the sixth wraps to the first.
 *
 * The join is LEFT so a structure this business has never used sorts ahead of
 * every used one — Postgres puts nulls LAST on ASC, hence the explicit NULLS
 * FIRST — which is also how a newly seeded skeleton reaches the front of the
 * queue rather than the back (behind any older skeleton still unused).
 * A user edit (updateScriptText) copies structure_id onto its new row, so it
 * counts as another use of the structure just used, which is already last in
 * the queue. Returns undefined when the bank has no active structure.
 */
export async function pickStructureForBusiness(
  db: Db,
  businessId: string,
): Promise<string | undefined> {
  const rows = await db
    .select({ id: structures.id })
    .from(structures)
    .leftJoin(
      scripts,
      and(
        eq(scripts.structureId, structures.id),
        eq(scripts.businessId, businessId),
        eq(scripts.kind, "b_script"),
      ),
    )
    .where(eq(structures.active, true))
    .groupBy(structures.id)
    .orderBy(sql`max(${scripts.createdAt}) asc nulls first`, asc(structures.createdAt))
    .limit(1);
  return rows[0]?.id;
}

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

  const wps = await wordsPerSecond(db, persona.voiceId ?? undefined);
  const wordBudget = Math.floor(durationPreset * wps);

  let personaGender = persona.gender;
  if (!personaGender) {
    logger.warn({ personaId: persona.id }, "persona has no gender; defaulting speaker to female");
    personaGender = "female";
  }

  const hookTemplates = pickHookTemplates();
  const closers = pickClosers(questionnaire.tone);
  const vars = {
    questionnaire: JSON.stringify(questionnaire, null, 2),
    persona: JSON.stringify({ name: persona.name, ...(persona.identity as object) }),
    persona_gender: personaGender,
    skeleton: JSON.stringify(structure.skeleton, null, 2),
    hook_options: hookTemplates.map((t, i) => `${i + 1}. ${t}`).join("\n"),
    closer_options: closers.map((c, i) => `${i + 1}. ${describeCloser(c)}`).join("\n"),
    pointers: pointers ?? "(אין — התבסס על השאלון בלבד)",
    word_budget: wordBudget,
    words_per_second: wps,
    duration_preset: durationPreset,
  };

  let text: string;
  let draftHookText: string;
  let promptVersion: string;
  if (getEnv().DRY_RUN) {
    // Dry-run still renders the template so prompt_version stays traceable and
    // a template/vars mismatch surfaces in tests, not in production.
    ({ promptVersion } = renderPrompt("b_script", vars));
    // Ends on the first offered closer, so a dry run shows the mechanism.
    const closer = closers[0]!;
    text =
      "חייבת לספר לכם על משהו שגיליתי השבוע ניסיתי את זה בספקנות מוחלטת ותוך יום " +
      "הבנתי שאין סיכוי שאני חוזרת אחורה זה עושה בדיוק מה שהבטיחו. " +
      `${closer.text}${closer.punctuation}`;
    draftHookText = dryRunHookText(text);
  } else {
    const result = await callClaude(db, opts.businessId, "b_script", vars, bScriptOutput);
    text = result.object.script;
    draftHookText = result.object.hook_text;
    promptVersion = result.promptVersion;
  }
  const hook = await hookTextOrDerived(db, {
    businessId: opts.businessId,
    script: text,
    candidate: draftHookText,
  });

  const rows = await db
    .insert(scripts)
    .values({
      businessId: opts.businessId,
      personaId: opts.personaId,
      structureId: opts.structureId,
      kind: "b_script",
      text,
      // hookTemplates / closers: the exact openers and closers offered this
      // generation, so a winning hook or closer can be traced back to its
      // template later. hookText: the DRAFT on-screen line — the customer
      // edits it in the effect step and the FINAL string is copied into the
      // render's params (vault 0017).
      params: {
        pointers,
        durationPreset,
        wordBudget,
        hookTemplates,
        closers: closers.map((c) => c.text),
        hookText: hook.hookText,
        // Present only when the model's own line missed a cap and `hook_text`
        // re-derived it, so a hook that differs from the b_script draft is
        // explainable later — and traceable to the version that cut it.
        ...(hook.derivedPromptVersion
          ? { hookTextDerived: true, hookTextPromptVersion: hook.derivedPromptVersion }
          : {}),
      },
      promptVersion,
    })
    .returning();
  return rows[0]!;
}

const hookTextOutput = z.object({ hook_text: z.string() });

/**
 * Re-derive the on-screen hook text from an edited script: the script goes
 * in, hook_text comes out, under the caps generateBScript enforces. One
 * llm_tokens usage row, gated by the platform cap the way tts_enhance is.
 * Kind-agnostic on purpose — the caller decides which scripts carry one.
 */
export async function deriveHookText(
  db: Db,
  opts: { businessId: string; text: string },
): Promise<string> {
  return (await deriveHookTextWithVersion(db, opts)).hookText;
}

/**
 * The same derivation, plus the `hook_text` version that produced the line —
 * recorded on scripts.params when generateBScript falls back to it, so the
 * version is the one actually used rather than one re-resolved afterwards.
 *
 * One corrective call when the extractor's line misses a cap. The extractor
 * is the last step on every path that reaches it — generateBScript's fallback
 * and the edit save (vault 0030) — so a miss here was the failure the customer
 * saw: 2026-10-20, "hook_text is 44 characters — the cap is 40" four times in
 * a row on the generation path, and three edit saves of a customer's the same
 * night. The model counts words, not characters, and a six-word Hebrew opening
 * is over 40 characters whenever its words run long. The retry is not a blind
 * re-roll: it hands back the rejected line with the rule it missed — the
 * deterministic-check-plus-one-corrective-call shape of findPlanViolations —
 * so the model cuts one word earlier. Exactly one, so a bad line costs at most
 * two small calls; the line is still never trimmed here.
 */
async function deriveHookTextWithVersion(
  db: Db,
  opts: { businessId: string; text: string },
): Promise<{ hookText: string; promptVersion: string }> {
  const vars = { script: opts.text };
  if (getEnv().DRY_RUN) {
    // Rendered for the same reason generateBScript renders in DRY_RUN: a
    // template/vars mismatch must surface in tests, not in production.
    const { promptVersion } = renderPrompt("hook_text", vars);
    return { hookText: dryRunHookText(opts.text), promptVersion };
  }
  await assertBudget(db, "llm_tokens");
  const first = await callClaude(db, opts.businessId, "hook_text", vars, hookTextOutput);
  const problem = hookTextError(first.object.hook_text);
  if (!problem) {
    return { hookText: first.object.hook_text.trim(), promptVersion: first.promptVersion };
  }
  logger.warn(
    { businessId: opts.businessId, hookText: first.object.hook_text, problem },
    "hook_text rejected — one corrective call",
  );
  // Gated again, immediately before the paid call, the way the plan
  // pipeline's callOnce gates each of its corrective rounds.
  await assertBudget(db, "llm_tokens");
  const retry = await callClaude(db, opts.businessId, "hook_text", vars, hookTextOutput, {
    // JSON.stringify, as correctivePrompt quotes the previous answer: a quote
    // mark or a control character in the line must not break the bullet.
    appendix:
      `Your previous answer was not accepted:\n- ${JSON.stringify(first.object.hook_text)} — ${problem}\n` +
      "Return hook_text again under every rule above, fixing exactly what is named. When it " +
      "is over a cap, cut as many words earlier as it takes to come under it — the count " +
      "above says how far over it is, and one word is often not enough — at a natural break: " +
      "a shorter verbatim prefix of the same opening line, never a paraphrase. When it is a " +
      "mark or a character, return the same words without it.",
  });
  return { hookText: assertHookText(retry.object.hook_text), promptVersion: retry.promptVersion };
}

// ---------------------------------------------------------------------------
// Content policy (Service A — B is covered by the founder QC gate)
// ---------------------------------------------------------------------------

/**
 * events.kind written when the classifier was asked and could not answer — the
 * render went out UNCHECKED. The opposite of `content_policy_flag`, which
 * contentPolicyCheck writes itself when it does reach a verdict. Without this
 * row a classifier outage is indistinguishable from a clean run.
 */
export const CONTENT_POLICY_CHECK_FAILED = "content_policy_check_failed";

/**
 * The classifier refused the content. Typed, like InsufficientCreditsError, so
 * the web layer maps it on `instanceof` rather than on a message substring.
 *
 * `reason` quotes the offending part of the customer's own text and is
 * deliberately kept OUT of the Error message: messages travel further than
 * fields — into logs, and on the job path into `jobs.last_error`, which the
 * worker ships to Sentry unsanitised (vault 0037, legal-review P10). Whoever
 * wants it reads the field.
 */
export class ContentPolicyError extends Error {
  readonly category?: string;
  readonly reason?: string;

  constructor(category?: string, reason?: string) {
    super(`content policy refused the request${category ? `: ${category}` : ""}`);
    this.name = "ContentPolicyError";
    this.category = category;
    this.reason = reason;
  }
}

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

export async function getScript(db: Db, scriptId: string): Promise<Script> {
  const rows = await db.select().from(scripts).where(eq(scripts.id, scriptId)).limit(1);
  if (!rows[0]) throw new Error(`script ${scriptId} not found`);
  return rows[0];
}

/**
 * User edits create a NEW row (scripts are immutable once audio references
 * them). `params` is merged over the original row's params in that SAME
 * insert — there is never a second UPDATE. Kind-agnostic and model-free:
 * callers derive what the new text implies (deriveHookText for a b_script)
 * and pass it in.
 */
export async function updateScriptText(
  db: Db,
  scriptId: string,
  text: string,
  params?: Record<string, unknown>,
): Promise<Script> {
  const original = await getScript(db, scriptId);
  const inserted = await db
    .insert(scripts)
    .values({
      businessId: original.businessId,
      demoId: original.demoId,
      personaId: original.personaId,
      structureId: original.structureId,
      kind: original.kind,
      text,
      params: { ...(original.params as Record<string, unknown>), ...params },
      promptVersion: original.promptVersion,
      userEdited: true,
    })
    .returning();
  return inserted[0]!;
}

import { and, desc, eq, isNull } from "drizzle-orm";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getConfigValueOr } from "../appConfig";
import { AccountBudgetError, assertAccountBudget, assertBudget, recordUsage } from "../budget";
import { getEnv } from "../config";
import type { Db } from "../db";
import { demoAnalyses, demoStepPlans, demos, jobs } from "../db/schema";
import { BudgetError, PermanentError } from "../jobs/errors";
import { enqueue, isLastAttempt, type Job } from "../jobs/queue";
import type { JobContext, JobResult } from "../jobs/worker";
import { FIXTURES_DIR } from "../paths";
import {
  A_STEPS_MAX_DEFAULT,
  A_STEPS_MIN_DEFAULT,
  LABEL_LEAD_MS,
  LABEL_WORDS_PER_SECOND,
  MAX_LABEL_CHARS,
  MAX_LABEL_WORDS,
  MIN_LABEL_WORDS,
  PLAN_SKIP_SCREEN_KINDS,
  readTimeMs,
  totalRuntimeMs,
} from "../plan-format";
import { generateObject } from "../providers/anthropic";
import { renderPrompt } from "../prompts";
import { questionnaireSchema, requireQuestionnaire, type Questionnaire } from "./businesses";
import {
  ANALYSIS_ACTION_TYPES,
  analysisTimelineSchema,
  subsampleClusters,
  type AnalysisState,
} from "./demo-analysis";

// These live in ../plan-format so the wizard's picker and plan surface can
// import them without dragging this module's db/fs/provider imports into a
// browser bundle. Kept re-exported here because every server caller already
// imports them from here.
export { MAX_LABEL_CHARS, PLAN_SKIP_SCREEN_KINDS, readTimeMs, totalRuntimeMs };

function isSkippedKind(state: AnalysisState): boolean {
  return state.screenKind !== undefined && PLAN_SKIP_SCREEN_KINDS.has(state.screenKind);
}

/**
 * Pass 2 of the step-plan format: the SELECTION. Text-only on purpose — the
 * input is the analysed timeline + questionnaire, never images — which is what
 * makes replanning cost about a cent and makes the fixtures/timelines/
 * regression harness possible. A separate job from analysis by design:
 * re-planning must never re-analyse.
 */

export const planStepSchema = z.object({
  timestampMs: z.number(),
  actionType: z.enum(ANALYSIS_ACTION_TYPES),
  label: z.string(),
  sourceIndex: z.number(),
  durationMs: z.number(),
});
export type PlanStep = z.infer<typeof planStepSchema>;

export const unexplainedMomentSchema = z.object({
  timestampMs: z.number(),
  whatISaw: z.string(),
  whyItMightMatter: z.string(),
});
export type UnexplainedMoment = z.infer<typeof unexplainedMomentSchema>;

export const planStepsSchema = z.array(planStepSchema);
export const unexplainedMomentsSchema = z.array(unexplainedMomentSchema);

/** What the model returns — everything else derives from sourceIndex in code
 *  (timestamp/actionType from the timeline, durationMs from config), so the
 *  model cannot contradict the timeline it selected from. */
const planOutputSchema = z.object({
  steps: z.array(z.object({ sourceIndex: z.number(), label: z.string() })),
  unexplainedMoments: z.array(
    z.object({
      timestampMs: z.number(),
      whatISaw: z.string(),
      whyItMightMatter: z.string(),
    }),
  ),
  notes: z.string().nullable(),
});
type PlanOutput = z.infer<typeof planOutputSchema>;

/** Per-step clip length by what the state shows. The band this feeds is
 *  MIN/MAX_RUNTIME_MS below — an executable check, not this comment's
 *  arithmetic. Config `a_step_ms_by_action` overrides per key. */
const DEFAULT_STEP_MS: Record<AnalysisState["actionType"], number> = {
  navigate: 1800,
  tap: 1600,
  type: 2200,
  select: 1800,
  scroll: 2200,
  result: 2800,
  idle: 1600,
};

/** Floor and ceiling on one step's clip, whatever the arithmetic asks for.
 *  Config `a_step_ms_min` / `a_step_ms_max` override (no seeded row: a missing
 *  key IS the default). The floor is a pacing limit — founder testing found 2s
 *  steps go by too fast to land; the ceiling stops one step eating the ad.
 *  Note the 3s floor sits ABOVE every DEFAULT_STEP_MS entry and above a
 *  6-word caption's read time (2800ms), so an unsqueezed step runs exactly
 *  the floor; the per-kind table only matters again if the floor drops or a
 *  config row raises a kind past it. Hand-picked states closer than the floor
 *  still render the gap (the ceiling beats the floor — see assembleSteps). */
const MIN_STEP_MS = 3000;
const MAX_STEP_MS = 4000;

/** The steps' own on-screen length — the hook clip is NOT counted, it sits on
 *  top. With the bank's ~4s hook this lands the finished ad at ~19-25s.
 *  The floor is minSteps × the step floor ON PURPOSE (founder decision
 *  2026-08-25, docs/vault/decisions/0002-runtime-band-floor-is-15s.md): every
 *  unsqueezed step renders exactly the 3s floor, so a 16s floor made the
 *  5-step minimum arithmetically unsatisfiable — every 5-step plan violated
 *  the band, and the prompt was licensing exactly that shape. At 15s every
 *  minSteps..maxSteps shape fits the band by construction; sparser recordings
 *  still pass through the reachability escape below.
 *  Config `a_steps_runtime_min_ms` / `a_steps_runtime_max_ms` override
 *  (no seeded row: a missing key IS the default). */
const MIN_RUNTIME_MS = 15_000;
const MAX_RUNTIME_MS = 21_000;

// MAX_LABEL_WORDS / MIN_LABEL_WORDS live in ../plan-format (imported above):
// the wizard's soft word warning needs the ceiling, and this module's db/fs/
// provider imports can't reach a browser bundle.

/** readTimeMs by word count. The prompt's timing block and the runtime check
 *  read the same function — which is the whole point of generating the block. */
function readTimeMsForWords(words: number): number {
  return readTimeMs("x ".repeat(words));
}

/**
 * Every number in the prompt's timing section, GENERATED from readTimeMs and
 * the duration config instead of restated by hand in the markdown.
 *
 * v10 hand-wrote the same table and its first row drifted: it licensed a
 * 3-word caption at a 1.4s gap when readTimeMs asks 1.6s, so the prompt
 * authorised plans findPlanViolations then rejected — two of the campaign-app
 * regression failures came from that one row. A table that can disagree with
 * the function is the bug, so the table comes from the function.
 *
 * Arithmetic only, no prose: the argument for WHY a gap is a ceiling lives in
 * the versioned prompt file, where a change to it bumps the prompt version.
 */
export function planTimingMarkdown(opts: {
  durations: StepDurationConfig;
  runtime: { minMs: number; maxMs: number };
  minSteps: number;
  maxSteps: number;
}): string {
  const { durations, runtime, minSteps, maxSteps } = opts;
  const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  // The clamp assembleSteps applies to every step, minus the gap ceiling: this
  // block states what a step is worth when nothing cuts it short.
  const clamp = (ms: number) => Math.min(Math.max(ms, durations.minMs), durations.maxMs);
  const range = (from: number, to: number): number[] =>
    Array.from({ length: to - from + 1 }, (_, i) => from + i);

  // Rows the clamp could never grant are not offers. A configured
  // a_step_ms_max below a row's read time caps every step under it, so the row
  // would promise a window the code never hands out — and the totals below it,
  // same function same config, would contradict it. Never empty: a ceiling
  // under the shortest read time is a broken config, not a shorter table.
  const grantable = range(MIN_LABEL_WORDS, MAX_LABEL_WORDS).filter(
    (w) => readTimeMsForWords(w) <= durations.maxMs,
  );
  const lengths = grantable.length > 0 ? grantable : [MIN_LABEL_WORDS];
  const readRows = lengths.map((w) => `| ${w} words | ${secs(readTimeMsForWords(w))} |`);

  const kindFloors = Object.entries(durations.byActionType)
    .map(([kind, ms]) => `${kind} ${secs(clamp(ms))}`)
    .join(", ");

  // Two rules meet at this gap and the larger one wins: below one step's own
  // length the pair is the same moment on screen (the min-gap violation), and
  // below the shortest caption's read time no caption fits. Reading only the
  // second understates it whenever a_step_ms_min is raised past it.
  const noPairBelowMs = Math.max(readTimeMsForWords(lengths[0]!), durations.minMs);

  // The ending has no neighbour, so it keeps the longer of its own kind and
  // its caption; every other step is worth at least its caption's read time.
  const endingMs = (w: number) =>
    clamp(Math.max(durations.byActionType.result ?? DEFAULT_STEP_MS.result, readTimeMsForWords(w)));
  // The LEAST a shape can run, never a prediction. A step is worth the longer
  // of its caption and its own kind, so the kinds the model picks can only
  // push the total UP: a floor of 9.2s reaches 11.6s on `scroll` states. The
  // grid used to print a pass/fail verdict per cell, which was true only for
  // the one action type whose default happens to equal a floor-length
  // caption's read time — the same restated-arithmetic bug one level up.
  const floorMs = (steps: number, w: number) =>
    (steps - 1) * clamp(readTimeMsForWords(w)) + endingMs(w);
  const totalRows = range(minSteps, maxSteps).map(
    (n) => `| ${n} | ${lengths.map((w) => secs(floorMs(n, w))).join(" | ")} |`,
  );

  return [
    "| caption | seconds it needs |",
    "| ------- | ---------------- |",
    ...readRows,
    "",
    `Under a ${secs(noPairBelowMs)} gap you may not select both states at all.`,
    "",
    `A state's own kind sets a second floor: ${kindFloors}. A step runs the LONGER of its kind and its caption, and never longer than the gap to your next selected state.`,
    "",
    `The steps must total ${(runtime.minMs / 1000).toFixed(1)}-${secs(runtime.maxMs)}; aim near ${secs(
      Math.round((runtime.minMs + runtime.maxMs) / 2),
    )}. Ending on a ${secs(endingMs(lengths[0]!))} success state, this is the LEAST each shape can run — the kinds you select can only push it up, never down:`,
    "",
    `| steps | ${lengths.map((w) => `${w}-word captions`).join(" | ")} |`,
    `| ----- | ${lengths.map(() => "---------------").join(" | ")} |`,
    ...totalRows,
    "",
    `A shape whose floor is already over ${secs(runtime.maxMs)} cannot be rescued — drop a step or shorten the captions. A shape whose floor is under ${(runtime.minMs / 1000).toFixed(1)}s only reaches the band if the states you picked run longer than their captions, so add up the kinds you actually selected before you settle.`,
  ].join("\n");
}

/** Rough cost bookkeeping — same math as pipelines/copy.ts (3rd use is Phase 6's problem). */
function llmCostAgorot(inputTokens: number, outputTokens: number): number {
  return Math.ceil(((inputTokens * 3 + outputTokens * 15) / 1_000_000) * 370);
}

// ---------------------------------------------------------------------------
// Deterministic label-word enforcement (the anti-fabrication rule)
// ---------------------------------------------------------------------------

/** Single-letter prefixes Hebrew glues onto content words (ו/ה/ב/ל/מ/ש/כ). */
const HEBREW_PREFIXES = new Set(["ו", "ה", "ב", "ל", "מ", "ש", "כ"]);

/**
 * Function words that carry no content and are always allowed. Deliberately
 * conservative: every addition weakens the anti-fabrication rule.
 */
const FUNCTION_WORDS = new Set([
  "של", "את", "עם", "על", "אל", "זה", "זו", "זאת", "זהו", "אז", "גם", "רק",
  "כל", "לא", "יש", "אין", "עוד", "כבר", "או", "אם", "כי", "מה", "מי", "איך",
  "כאן", "שם", "אחרי", "לפני", "בתוך", "עד", "ואז", "הנה", "ככה", "פשוט", "במקום",
  // Pronouns and possessives. A caption addressed to the viewer needs them and
  // none of them can carry a product claim. The two-letter members are
  // reachable by prefix-stripping — "כלי" strips כ down to "לי" and passes —
  // which is the same 1-2 char slack window wordVariants already documents.
  "הוא", "היא", "הם", "הן", "אתם", "שלי", "שלך", "שלכם", "לי", "לך", "לכם",
  "אותו", "אותה", "אותם",
  // שלו/שלה close the half-added set: they strip to "לו"/"לה", which are not
  // members, so the singular third person false-rejected while the plural
  // "שלהם" passed by double-stripping down to "הם". An asymmetry nobody chose.
  "שלו", "שלה",
]);

/**
 * Instruction verbs: the words that make a caption an INSTRUCTION ("go here",
 * "upload it") rather than a transcription of the screen. They are never on
 * screen by nature — a button reads "שמירה", the caption that tells you to
 * press it reads "שמרו" — and they carry no product claim, which is why they
 * are safe to allow while the anti-fabrication rule stays otherwise intact.
 *
 * SURFACE FORMS, not roots. Hebrew imperative morphology defeats the
 * prefix-stripping in wordVariants (היכנסו strips ה and then halts at י), so
 * the plene and defective spellings are listed separately, plural imperative
 * only. Deliberately conservative, exactly like FUNCTION_WORDS: every addition
 * weakens the rule, and a verb that could be read as a claim about the product
 * does not belong in here.
 */
const INSTRUCTIONAL_VERBS = new Set([
  "כנסו", "היכנסו", "הכנסו", // enter
  "לחצו", // click
  "בחרו", // choose
  "העלו", // upload
  "פתחו", // open
  "הקלידו", "כתבו", // type
  "גררו", // drag
  "סמנו", // mark
  "מלאו", // fill
  "שלחו", // send
  "חפשו", // search
  "שמרו", // save
  "גללו", // scroll
  // approve/confirm. Its absence is what forced the transcription at the
  // confirm step: every instruction form ("אשרו את הניתוב", "לאשר ניתוב") was
  // rejected and reading the button label back was the only caption that
  // passed. The ה-prefixed spellings need no entries of their own — unlike
  // "היכנסו", which halts prefix-stripping at the yod, "האשרו" strips its ה
  // straight down to "אשרו" and matches.
  "אשרו", "אישרו",
  // start/begin. Listed as the ה-initial surface form for the same reason
  // "היכנסו" is: stripping ה leaves "תחילו", which is not the base.
  "התחילו", "התחלו",
]);

/**
 * Edge punctuation stripped before matching; case folded for Latin. Both sides
 * of every comparison go through here: NFC first, Hebrew geresh/gershayim
 * unified with their ASCII lookalikes (לו״ז vs לו"ז), combining marks (niqqud)
 * dropped — screen OCR and model labels disagree on all three.
 */
function normalizeWord(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/׳/g, "'")
    .replace(/״/g, '"')
    .replace(/\p{M}+/gu, "")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .toLowerCase();
}

/**
 * Split into comparable word tokens: on anything that is not a letter, digit
 * or an in-word quote mark (kept so acronyms like לו"ז survive as one token).
 * Whitespace-only splitting left ·/־/– glued to neighbouring words whenever
 * the OCR dropped a space.
 */
function tokenizeWords(text: string): string[] {
  // \p{M} keeps combining niqqud attached to its letter; normalizeWord then
  // strips it from the finished token.
  return text
    .normalize("NFC")
    .split(/[^\p{L}\p{M}\p{N}'"׳״]+/u)
    .map(normalizeWord)
    .filter(Boolean);
}

/**
 * A word plus its forms with up to two leading single-letter prefixes removed
 * ("ולפרויקט" -> "לפרויקט" -> "פרויקט"). Exact matching is brittle under
 * Hebrew morphology; prefix-stripping both sides absorbs the common cases.
 * Stripping the ALLOWED side too gives a deliberate 1-2 char slack window (a
 * label "מירה" passes against a screen showing "שמירה") — accepted: the
 * alternative false-rejects the far more common case of a label using a screen
 * word's base form, and the slack cannot admit a claim absent from the screen.
 */
function wordVariants(word: string): string[] {
  const variants = [word];
  let current = word;
  for (let i = 0; i < 2; i++) {
    if (current.length > 2 && HEBREW_PREFIXES.has(current[0]!)) {
      current = current.slice(1);
      variants.push(current);
    } else {
      break;
    }
  }
  return variants;
}

function questionnaireWords(questionnaire: Questionnaire): string[] {
  const out: string[] = [];
  for (const value of Object.values(questionnaire)) {
    if (typeof value === "string") out.push(...tokenizeWords(value));
    else if (Array.isArray(value)) {
      for (const item of value) if (typeof item === "string") out.push(...tokenizeWords(item));
    }
  }
  return out;
}

/** Input tokens must already be normalized (tokenizeWords output). */
function expandToVariantSet(tokens: string[]): Set<string> {
  const set = new Set<string>();
  for (const token of tokens) {
    for (const variant of wordVariants(token)) set.add(variant);
  }
  return set;
}

/**
 * The maximal run of states around `index` linked by `sameStateAsPrevious` —
 * ONE physical screen that handheld drift split into several states. OCR
 * quality varies frame to frame across the run (the real BotTeacher recording
 * clipped "נשלים" to "נשלי" on the run's anchor while a dup frame read it
 * fully), so a state's allowed label words pool the whole run's visibleText.
 */
function dupRunIndexes(timeline: AnalysisState[], index: number): number[] {
  let start = index;
  while (start > 0 && timeline[start]!.sameStateAsPrevious) start--;
  let end = index;
  while (end + 1 < timeline.length && timeline[end + 1]!.sameStateAsPrevious) end++;
  const indexes: number[] = [];
  for (let i = start; i <= end; i++) indexes.push(i);
  return indexes;
}

/**
 * Every violation in a model-proposed plan, as model-facing English strings.
 * Empty array = valid. Deterministic on purpose: the anti-fabrication rule is
 * enforced here, not just requested in the prompt. This constrains the MODEL —
 * user-edited labels never pass through it. `shape` adds the plan-shape rules
 * the generation path enforces on top of the per-step rules: the video must
 * end on the success state (when the timeline offers a selectable one and
 * `notes` does not explain why it cannot); a below-minimum plan is a violation
 * unless the timeline itself cannot offer that many selectable states; no two
 * selected states may sit closer together than one step is long; and, when
 * `shape.runtime` is supplied, the assembled steps must total inside the
 * format's band. Human edits deliberately skip all four — deleting steps just
 * makes the video shorter.
 */
export function findPlanViolations(
  steps: { sourceIndex: number; label: string }[],
  timeline: AnalysisState[],
  questionnaire: Questionnaire,
  maxSteps: number,
  shape?: {
    minSteps: number;
    notes: string | null;
    minStepMs: number;
    /** Absent = do not check the total. Present, it carries the duration
     *  config because the check measures ASSEMBLED windows: a sum of nominal
     *  DEFAULT_STEP_MS is a number the video never shows. */
    runtime?: { durations: StepDurationConfig; minMs: number; maxMs: number };
  },
): string[] {
  const violations: string[] = [];
  if (steps.length === 0) {
    violations.push("the plan has zero steps");
    return violations;
  }
  if (steps.length > maxSteps) {
    violations.push(`the plan has ${steps.length} steps — the maximum is ${maxSteps}`);
  }
  const seen = new Set<number>();
  const allowedQuestionnaire = expandToVariantSet(questionnaireWords(questionnaire));

  steps.forEach((step, i) => {
    if (!Number.isInteger(step.sourceIndex) || !timeline[step.sourceIndex]) {
      violations.push(`step ${i}: sourceIndex ${step.sourceIndex} is not in the timeline`);
      return;
    }
    if (seen.has(step.sourceIndex)) {
      violations.push(`step ${i}: sourceIndex ${step.sourceIndex} is selected twice`);
      return;
    }
    seen.add(step.sourceIndex);
    const state = timeline[step.sourceIndex]!;
    if (state.legibility === "unreadable") {
      violations.push(`step ${i}: state ${step.sourceIndex} is legibility "unreadable"`);
    }
    if (isSkippedKind(state)) {
      violations.push(
        `step ${i}: state ${step.sourceIndex} is a "${state.screenKind}" screen — login, loading, onboarding, error, tour and system screens are never steps; select the customer using the product itself`,
      );
    }
    if (step.label.length > MAX_LABEL_CHARS) {
      violations.push(`step ${i}: label is over ${MAX_LABEL_CHARS} characters`);
    }
    // The word cap counts what the viewer sees (whitespace words); the content
    // check below works on normalized tokens instead.
    const words = step.label.split(/\s+/).map(normalizeWord).filter(Boolean);
    if (words.length === 0) {
      violations.push(`step ${i}: label is empty`);
      return;
    }
    if (words.length > MAX_LABEL_WORDS) {
      violations.push(`step ${i}: label "${step.label}" is over ${MAX_LABEL_WORDS} words`);
    }
    const allowedState = expandToVariantSet(
      dupRunIndexes(timeline, step.sourceIndex).flatMap((j) =>
        timeline[j]!.visibleText.flatMap(tokenizeWords),
      ),
    );
    for (const word of tokenizeWords(step.label)) {
      // Variants, not the exact word: Hebrew glues ו/ש/כ onto function words
      // constantly ("וגם", "שכבר") and a false reject here costs a paid
      // corrective re-request — or the whole plan on the second offence.
      if (wordVariants(word).some((v) => FUNCTION_WORDS.has(v))) continue;
      // Same variant matching, same reason: "ולחצו" must not cost a paid
      // corrective re-request over a glued ו.
      if (wordVariants(word).some((v) => INSTRUCTIONAL_VERBS.has(v))) continue;
      // A prefix letter left standalone by punctuation ("ל־BotTeacher" splits
      // into ל + botteacher) carries no content — it cannot fabricate a claim.
      if (word.length === 1 && HEBREW_PREFIXES.has(word)) continue;
      const matches = wordVariants(word).some(
        (v) => allowedState.has(v) || allowedQuestionnaire.has(v),
      );
      if (!matches) {
        violations.push(
          `step ${i}: label word "${word}" appears neither in state ${step.sourceIndex}'s visibleText nor in the questionnaire`,
        );
      }
    }
  });

  if (shape) {
    // The format invariant: the video ends on the success state. Enforceable
    // only when the timeline offers a selectable result state — the analysis
    // may have mistyped the success screen, and a plan cannot end on a state
    // that does not exist. A skip-kind "result" (a validation error the
    // analysis mistyped) is not selectable either, so it cannot force the rule.
    const successCandidates = timeline
      .map((s, i) => ({ s, i }))
      .filter(
        ({ s }) => s.actionType === "result" && s.legibility !== "unreadable" && !isSkippedKind(s),
      );
    const valid = steps.filter(
      (s) => Number.isInteger(s.sourceIndex) && timeline[s.sourceIndex],
    );
    // `notes` waives the rule: the analysis may have typed error screens as
    // "result" (the timeline then OFFERS a result state that is not a genuine
    // success), and a plan cannot be forced to end on one. The model may end
    // elsewhere only by explaining why in `notes` — never silently.
    if (successCandidates.length > 0 && valid.length > 0 && !shape.notes?.trim()) {
      const last = valid.reduce((a, b) =>
        timeline[a.sourceIndex]!.timestampMs >= timeline[b.sourceIndex]!.timestampMs ? a : b,
      );
      if (timeline[last.sourceIndex]!.actionType !== "result") {
        // Real recordings keep going after the success moment (a179f069: the
        // success sits at 45s of an 80s recording), so "end on the result
        // state" is not enough — the retry needs the candidate indexes and an
        // explicit licence to drop the trailing steps, or it reshapes blind.
        // The shortfall path used to be notes; it is not any more (the
        // minimum-step rule below no longer reads notes). So the message has
        // to name what may be added AND what may not: told plainly to "select
        // additional states" a live retry padded with a loading screen — a
        // fresh violation with no third call to fix it.
        violations.push(
          `the last step must be the result/success state — the video ends there. This timeline's success candidates are at sourceIndex ${successCandidates
            .map(({ i }) => i)
            .join(
              ", ",
            )}: end the plan on one of them and drop every step after it; if the drop leaves fewer than ${shape.minSteps} steps, select additional distinct product states from BEFORE that ending — never pad with loading, duplicate or otherwise skipped states. If none of the candidates is a genuine success (an error, warning or validation message is never success), keep your best journey and explain that in \`notes\` (Hebrew) instead`,
        );
      }
    }
    // `notes` does NOT waive this one. It was written for the last-step rule
    // above and waived both, which is how a 5-step plan with a 26-second hole
    // in the middle passed. The waiver is deterministic instead: a timeline
    // that cannot offer minSteps selectable states has no longer plan to give,
    // and "selectable" is exactly what the per-step rules above accept.
    if (steps.length < shape.minSteps) {
      // Spacing counts as well as legality: two legal states 400ms apart can
      // never both be steps (the min-gap rule below), so a timeline whose
      // legal states are bunched inside one step's length cannot reach
      // minSteps however it is read. Walking chronologically and taking every
      // state that clears the gap yields the largest legal selection there is.
      //
      // Bounded by the ENDING. A state after the success screen can never be a
      // step — the rule above forbids it — so counting one here demands a plan
      // the other rule rejects. That is not hypothetical: it is what kept
      // dryRunPlan's shortfall alive, because the canned plan stops at the
      // ending and this walk did not.
      //
      // Deliberately NOT conditioned on `notes`. Reading notes here is what 2e
      // removed, and it bites immediately: dryRunPlan still sets notes to
      // explain a shortfall, which would switch this bound back off in exactly
      // the case it exists for. When notes does waive the last-step rule the
      // model may end later than this, so the bound under-counts and forgives
      // a little more — the mild direction for a rule that only ever ADDS a
      // violation.
      const endsAtMs =
        successCandidates.length > 0
          ? successCandidates[successCandidates.length - 1]!.s.timestampMs
          : Number.POSITIVE_INFINITY;
      let selectable = 0;
      let lastMs = Number.NEGATIVE_INFINITY;
      for (const s of timeline) {
        if (s.legibility === "unreadable" || isSkippedKind(s) || s.sameStateAsPrevious) continue;
        if (s.timestampMs > endsAtMs) break;
        if (s.timestampMs - lastMs < shape.minStepMs) continue;
        selectable++;
        lastMs = s.timestampMs;
      }
      if (selectable >= shape.minSteps) {
        violations.push(
          `the plan has ${steps.length} steps, fewer than the minimum ${shape.minSteps} — this timeline offers ${selectable} selectable states, so select more genuinely distinct ones; \`notes\` does not waive this, and never pad with loading, duplicate or otherwise skipped states`,
        );
      }
    }
    // Two selections inside one step's length are the same moment on screen:
    // the second clip would have to open before the first one closed. Real
    // timelines put states 400ms apart, so this is reachable, and it is
    // arithmetic rather than taste — assembleSteps cannot honour both, and
    // silently shortening one is what put 200ms of source on screen twice.
    // Named here so the ONE corrective retry can drop one of the pair; the
    // `notes` escape hatch does not apply, nothing explains a 400ms clip.
    const chronological = [...seen].sort(
      (a, b) => timeline[a]!.timestampMs - timeline[b]!.timestampMs,
    );
    for (let i = 1; i < chronological.length; i++) {
      const before = chronological[i - 1]!;
      const after = chronological[i]!;
      const gap = timeline[after]!.timestampMs - timeline[before]!.timestampMs;
      if (gap < shape.minStepMs) {
        violations.push(
          `states ${before} and ${after} are only ${gap}ms apart — a step is at least ${shape.minStepMs}ms long, so these two are the same moment on screen; keep whichever reads better and select a genuinely different state instead of the other`,
        );
      }
    }
    if (shape.runtime) {
      // ASSEMBLED, never nominal: readTimeMs lifts a long label above its
      // per-action default and the gap cap pulls a tight pair below it, so a
      // sum of DEFAULT_STEP_MS is a number the video never shows. The message
      // carries the current total and the direction to move — the ONE
      // corrective retry has no other way to know which way that is.
      const assembled = assembleSteps(valid, timeline, shape.runtime.durations);
      const total = totalRuntimeMs(assembled);
      // A caption the eye cannot finish is not a caption. readTimeMs is
      // already the floor assembleSteps ASKS for, but the gap cap overrides it
      // — so the assembled window is the only place this is visible, and
      // nothing looked. The shipped a179f069 plan burned two of six captions
      // under their own read time, including a two-line one on screen 1600ms.
      //
      // Both exits have to be named. The squeeze comes from the NEXT selected
      // state, so rewriting the label in place often cannot fix it; merging
      // the pair into one caption is the other half of the remedy, and it is
      // exactly what the ONE-CAPTION-PER-BEAT rule asks for anyway.
      for (const step of assembled) {
        const needed = readTimeMs(step.label);
        if (step.durationMs >= needed) continue;
        const fits = Math.floor(
          ((step.durationMs - LABEL_LEAD_MS) / 1000) * LABEL_WORDS_PER_SECOND,
        );
        violations.push(
          `the caption on state ${step.sourceIndex} ("${step.label}") is on screen for ${step.durationMs}ms but needs ${needed}ms to be read — its window is capped by the gap to the next selected state, so ${
            fits >= 1
              ? `either cut it to ${fits} word${fits === 1 ? "" : "s"} or fewer`
              : "there is no label short enough to fit"
          }, or drop one of the two states and let a single caption cover the whole beat`,
        );
      }
      // The FLOOR needs the same unreachability escape as the minimum count.
      // demos.ts accepts an 8-second recording, and 8 seconds of source cannot
      // make 11 seconds of steps however it is cut — telling the model to add
      // states it does not have burns the one retry and fails the plan
      // permanently, with a customer-facing "try again" that never works.
      // Sound upper bound: every non-last step is capped at the gap to the
      // next one, so their sum cannot exceed the span of the selectable
      // states, and no single step can outlast one step's ceiling. The CEILING
      // gets no such escape — a long plan can always drop steps.
      const stepCeilingMs = Math.min(
        shape.runtime.durations.maxMs,
        Math.max(
          shape.runtime.durations.minMs,
          readTimeMsForWords(MAX_LABEL_WORDS),
          ...Object.values(shape.runtime.durations.byActionType),
        ),
      );
      // How much video the best legal selection could possibly assemble. Both
      // cheap approximations of this are wrong, in opposite directions:
      //
      //   wall-clock span  — counts dead air between states as claimable, so
      //     it over-estimates and orders the model to add states that do not
      //     exist, burning the one retry on a permanent failure;
      //   leftmost greedy  — takes every state at the earliest legal moment,
      //     which is maximum CARDINALITY but not maximum COVERAGE. It can
      //     spend its last pick just under minStepMs before the final state
      //     and then be barred from it, stranding the very success screen the
      //     plan is required to end on. That under-estimates, and an
      //     under-estimate switches the floor check OFF — a genuinely short
      //     ad then ships with no violation and no retry at all.
      //
      // So compute it exactly. maxSteps is single-digit and a timeline is tens of states,
      // so the obvious O(n^2 * maxSteps) walk is free: best[i][k] is the most
      // capped-gap coverage a k+1-state selection ending at state i can have.
      // Bounded by the ENDING, same argument as the minimum-step walk above:
      // a state after the last success candidate can never be a step, so
      // counting its coverage certifies a floor no ending-compliant plan can
      // reach — the retry is then ordered to add pre-ending states that do
      // not exist and the plan fails permanently. (Real recordings keep
      // rolling after the success moment, so post-ending states are the
      // normal case, not an edge.) When `notes` waives the ending rule the
      // bound under-counts and this escape forgives a little more — the mild
      // direction, exactly as the walk's comment argues.
      const reachEndsAtMs =
        successCandidates.length > 0
          ? successCandidates[successCandidates.length - 1]!.s.timestampMs
          : Number.POSITIVE_INFINITY;
      const sel = timeline.filter(
        (s) =>
          s.legibility !== "unreadable" &&
          !isSkippedKind(s) &&
          !s.sameStateAsPrevious &&
          s.timestampMs <= reachEndsAtMs,
      );
      let reachableMs = sel.length > 0 ? stepCeilingMs : 0;
      const best = sel.map(() => new Array<number>(maxSteps).fill(-1));
      for (let i = 0; i < sel.length; i++) {
        best[i]![0] = 0; // a selection of one state: no gaps yet
        for (let j = 0; j < i; j++) {
          const gap = sel[i]!.timestampMs - sel[j]!.timestampMs;
          if (gap < shape.minStepMs) continue;
          for (let k = 1; k < maxSteps; k++) {
            const prev = best[j]![k - 1]!;
            if (prev < 0) continue;
            best[i]![k] = Math.max(best[i]![k]!, prev + Math.min(gap, stepCeilingMs));
          }
        }
        // Whatever the selection, its LAST step has no neighbour to run into
        // and so earns a full ceiling on top of the gaps.
        for (const coverage of best[i]!) {
          if (coverage >= 0) reachableMs = Math.max(reachableMs, coverage + stepCeilingMs);
        }
      }
      if (total < shape.runtime.minMs && reachableMs >= shape.runtime.minMs) {
        violations.push(
          `the steps total ${total}ms of video, under the ${shape.runtime.minMs}-${shape.runtime.maxMs}ms this format needs — it is too SHORT: ADD one or two more distinct product states from BEFORE the ending (adding a step IS the minimal edit this violation asks for), and never add a loading, duplicate or otherwise skipped state`,
        );
      } else if (total > shape.runtime.maxMs) {
        violations.push(
          `the steps total ${total}ms of video, over the ${shape.runtime.minMs}-${shape.runtime.maxMs}ms this format needs — it is too LONG: drop the least essential steps`,
        );
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export interface StepPlanDraft {
  steps: PlanStep[];
  unexplainedMoments: UnexplainedMoment[];
  notes: string | null;
  promptVersion: string;
}

export interface StepDurationConfig {
  byActionType: Record<string, number>;
  minMs: number;
  maxMs: number;
}

/** Exported for the test that pins the defaults: with no app_config rows the
 *  code constants ARE the configuration, and nothing else observes them. */
export async function stepDurations(db: Db): Promise<StepDurationConfig> {
  const configured = await getConfigValueOr(
    db,
    "a_step_ms_by_action",
    z.record(z.string(), z.number()),
    {},
  );
  const minMs = await getConfigValueOr(db, "a_step_ms_min", z.number(), MIN_STEP_MS);
  return {
    byActionType: { ...DEFAULT_STEP_MS, ...configured },
    minMs,
    // Same guard as a_steps_max: a config pair the wrong way round must not
    // make the clamp incoherent.
    maxMs: Math.max(minMs, await getConfigValueOr(db, "a_step_ms_max", z.number(), MAX_STEP_MS)),
  };
}

/** The format's total-runtime band, read the same way stepDurations reads its
 *  pair: a missing app_config row IS the default, so these constants are what
 *  production actually runs on. Exported for the same reason stepDurations is
 *  — the suite pins the shipped band here; every band passed to
 *  findPlanViolations in a test is a literal, so nothing else does. */
export async function stepRuntimeBand(db: Db): Promise<{ minMs: number; maxMs: number }> {
  const minMs = await getConfigValueOr(db, "a_steps_runtime_min_ms", z.number(), MIN_RUNTIME_MS);
  return {
    minMs,
    // Same guard as a_steps_max/a_step_ms_max: a config pair the wrong way
    // round must not make the band unsatisfiable.
    maxMs: Math.max(
      minMs,
      await getConfigValueOr(db, "a_steps_runtime_max_ms", z.number(), MAX_RUNTIME_MS),
    ),
  };
}

/**
 * sourceIndex is the source of truth: timestamp and actionType come from the
 * selected state — chronological by construction.
 *
 * Duration is derived from the state AND its neighbour. A flat per-actionType
 * lookup has no idea where the next step begins, so a 1800ms `type` step in
 * front of a state 1600ms later rendered 200ms of source twice, back to back
 * (real: fixtures/timelines/real-botteacher-file-routing.json, proven in
 * pixels). The last step has no neighbour, so it gets what it asked for.
 *
 * The gap to the next step is a HARD ceiling — the floor yields to it, not the
 * other way round. Two selections closer together than minMs are a violation
 * on the model path (findPlanViolations, which has a retry channel to fix
 * them) but a legitimate edit on the human path: updatePlanSteps has no
 * violation channel, and the founder's call is that the customer's pick is
 * honoured. A short clip is an honest render of what they selected; silently
 * rewinding the video 1000ms into the previous step never is. So a 400ms gap
 * renders a 400ms clip.
 */
export function assembleSteps(
  selected: { sourceIndex: number; label: string }[],
  timeline: AnalysisState[],
  durations: StepDurationConfig,
): PlanStep[] {
  const ordered = selected
    .map(({ sourceIndex, label }) => ({
      timestampMs: timeline[sourceIndex]!.timestampMs,
      actionType: timeline[sourceIndex]!.actionType,
      label: label.trim(),
      sourceIndex,
    }))
    .sort((a, b) => a.timestampMs - b.timestampMs);

  return ordered.map((step, i) => {
    const desired = Math.max(
      durations.byActionType[step.actionType] ?? DEFAULT_STEP_MS[step.actionType],
      readTimeMs(step.label),
    );
    const next = ordered[i + 1];
    // The last step has no neighbour to run into, so it gets all the room it
    // asks for; every other step gets at most the gap. The trailing `room`
    // is what makes the ceiling beat the floor.
    const room = next ? next.timestampMs - step.timestampMs : Number.POSITIVE_INFINITY;
    return {
      ...step,
      durationMs: Math.min(
        Math.max(Math.min(desired, room), durations.minMs),
        durations.maxMs,
        room,
      ),
    };
  });
}

/**
 * The deterministic DRY_RUN plan, derived from the timeline (not hardcoded) so
 * fixtures with other timelines still produce sensible keyless plans: skip
 * idle/dup/low/unreadable states, thin to the cap keeping the ending, label
 * each step with words lifted off its own screen.
 */
function dryRunPlan(
  timeline: AnalysisState[],
  questionnaire: Questionnaire,
  minSteps: number,
  maxSteps: number,
  minStepMs: number,
): PlanOutput {
  const indexed = timeline.map((state, index) => ({ state, index }));
  // The quality pool the canned plan prefers, and the wider pool the validator
  // will actually accept. They are NOT the same set — "low" and idle states
  // are legal steps, they are just poor ones — so a timeline that is mostly
  // dim leaves the quality pool short of minSteps while the minimum-step
  // waiver, which counts the wider pool, does not forgive it. The keyless path
  // then throws. Prefer quality, fall back to legal.
  const quality = indexed.filter(
    ({ state }) =>
      state.legibility === "high" &&
      !state.sameStateAsPrevious &&
      state.actionType !== "idle" &&
      !isSkippedKind(state),
  );
  const legal = indexed.filter(
    ({ state }) =>
      state.legibility !== "unreadable" && !isSkippedKind(state) && !state.sameStateAsPrevious,
  );
  if (quality.length === 0 && legal.length === 0) {
    throw new Error("dry-run plan: timeline has no usable states");
  }

  // End on the LAST selectable result state when one exists — the same shape
  // rule findPlanViolations enforces, so the keyless plan always passes its
  // own validation (even when the success screen is legibility "low" and the
  // quality filter above dropped it).
  const results = timeline
    .map((state, index) => ({ state, index }))
    .filter(
      ({ state }) =>
        state.actionType === "result" && state.legibility !== "unreadable" && !isSkippedKind(state),
    );
  const lastResult = results[results.length - 1];

  // Thin to the cap keeping the ending, then respect the min-gap rule.
  // subsampleClusters always keeps its last element and lastResult is appended
  // straight after it, so (final candidate, success screen) is exactly the pair
  // a real recording is most likely to have under one step apart — leaving it
  // in would make the canned plan fail its own validation and throw. Walk
  // backwards dropping the EARLIER of any too-close pair: the ending is the one
  // state the format cannot lose.
  const pick = (pool: typeof indexed): typeof indexed => {
    let kept = subsampleClusters(pool, maxSteps);
    if (lastResult) {
      kept = subsampleClusters(
        kept.filter(({ state }) => state.timestampMs < lastResult.state.timestampMs),
        maxSteps - 1,
      );
      kept.push(lastResult);
    }
    const spaced: typeof kept = [];
    for (let i = kept.length - 1; i >= 0; i--) {
      const next = spaced[spaced.length - 1];
      if (!next || next.state.timestampMs - kept[i]!.state.timestampMs >= minStepMs) {
        spaced.push(kept[i]!);
      }
    }
    return spaced.reverse();
  };

  // Quality first; top up from the legal pool only when quality alone lands
  // under the minimum, because that is precisely the shortfall the
  // minimum-step waiver will NOT forgive (it counts the legal pool). When even
  // the legal pool is short the waiver does forgive it, so a short plan there
  // is correct rather than a throw.
  // Maximum-cardinality selection that still ends on the success screen: walk
  // BACKWARDS from the ending taking every state that clears one step's
  // length. On a line that greedy is optimal, and it is the same walk the
  // minimum-step waiver counts — which is the whole point. `pick` thins with
  // subsampleClusters, which is index-even, so a burst of near-duplicate
  // frames can spend most of the cap before the min-gap walk even runs; the
  // waiver then sees states the canned plan threw away and refuses to forgive
  // the shortfall, and the keyless path throws. Widening the POOL cannot help
  // when the loss is in the THINNING, which is what the earlier fix missed.
  const dense = (pool: typeof indexed): typeof indexed => {
    const end = lastResult ?? pool[pool.length - 1];
    if (!end) return [];
    const out = [end];
    for (let i = pool.length - 1; i >= 0; i--) {
      const c = pool[i]!;
      if (c.index === end.index || c.state.timestampMs > end.state.timestampMs) continue;
      if (out[out.length - 1]!.state.timestampMs - c.state.timestampMs >= minStepMs) out.push(c);
    }
    // Newest-first while building; chronological out, trimmed off the FRONT so
    // the ending always survives the cap.
    return out.reverse().slice(-maxSteps);
  };

  let kept = pick(quality);
  if (kept.length < minSteps) {
    const wider = pick(legal);
    if (wider.length > kept.length) kept = wider;
  }
  if (kept.length < minSteps) {
    const densest = dense(legal);
    if (densest.length > kept.length) kept = densest;
  }

  const steps = kept.map(({ state, index }) => ({
    sourceIndex: index,
    // First non-empty screen text; no exclamation marks even when the screen
    // shouts — the voice rule holds.
    label: (state.visibleText.map((t) => t.replace(/!/g, "").trim()).find(Boolean) ??
      questionnaire.product_name)
      .split(/\s+/)
      .slice(0, 4)
      .join(" "),
  }));
  const unexplainedMoments = timeline
    .filter((s) => s.salienceNote !== null)
    .slice(0, 3)
    .map((s) => ({
      timestampMs: s.timestampMs,
      whatISaw: s.salienceNote!,
      whyItMightMatter: "המסך הזה לא מוזכר בשאלון",
    }));
  return {
    steps,
    unexplainedMoments,
    notes: steps.length < minSteps ? "בסרטון יש פחות צעדים מובחנים מהמינימום המבוקש" : null,
  };
}

/**
 * Run pass 2 over one timeline: prompt -> zod-validated selection ->
 * deterministic violation check -> ONE corrective re-request naming the
 * violations -> fail. Used by the job handler and by `aiugc plan regress`
 * (which is why it takes data, not row ids).
 */
export async function generateStepPlan(
  db: Db,
  opts: {
    timeline: AnalysisState[];
    questionnaire: Questionnaire;
    businessId?: string;
    jobId?: string;
  },
): Promise<StepPlanDraft> {
  const minSteps = Math.max(
    1,
    await getConfigValueOr(db, "a_steps_min", z.number(), A_STEPS_MIN_DEFAULT),
  );
  const maxSteps = Math.max(
    minSteps,
    await getConfigValueOr(db, "a_steps_max", z.number(), A_STEPS_MAX_DEFAULT),
  );
  const durations = await stepDurations(db);
  const runtime = { durations, ...(await stepRuntimeBand(db)) };

  if (getEnv().DRY_RUN) {
    const canned = dryRunPlan(
      opts.timeline,
      opts.questionnaire,
      minSteps,
      maxSteps,
      durations.minMs,
    );
    // The canned plan goes through the same enforcement as a real one, so the
    // whole validation path runs keyless; a violation here is a code bug.
    //
    // Minus the runtime band, deliberately. The canned labels are the first
    // line of OCR off each screen, so their read-time — and therefore the
    // assembled total — measures the recording's own text, not anything a
    // writer chose. Holding a mechanical stub to a band that exists to size
    // AUTHORED Hebrew would mean tuning the stub, not the format. The band is
    // unit-tested directly and enforced on every model plan.
    const violations = findPlanViolations(canned.steps, opts.timeline, opts.questionnaire, maxSteps, {
      minSteps,
      notes: canned.notes,
      minStepMs: durations.minMs,
    });
    if (violations.length > 0) {
      throw new Error(`dry-run plan violates its own rules: ${violations.join("; ")}`);
    }
    return {
      steps: assembleSteps(canned.steps, opts.timeline, durations),
      unexplainedMoments: canned.unexplainedMoments,
      notes: canned.notes,
      promptVersion: "plan_demo_steps@dry-run",
    };
  }

  const promptTimeline = opts.timeline.map((s, index) => ({
    index,
    timestampMs: s.timestampMs,
    screenName: s.screenName,
    visibleText: s.visibleText,
    action: s.action,
    actionType: s.actionType,
    // undefined (v2-era analyses) drops out of the JSON entirely.
    screenKind: s.screenKind,
    sameStateAsPrevious: s.sameStateAsPrevious,
    legibility: s.legibility,
    salienceNote: s.salienceNote,
  }));
  const { text, promptVersion } = renderPrompt("plan_demo_steps", {
    questionnaire: JSON.stringify(opts.questionnaire, null, 2),
    timeline: JSON.stringify(promptTimeline, null, 2),
    min: minSteps,
    max: maxSteps,
    // v11+. Older prompt files never reference {{timing}} and are unaffected —
    // renderPrompt only substitutes what the template asks for.
    timing: planTimingMarkdown({ durations, runtime, minSteps, maxSteps }),
  });

  // A BudgetError from the second call parks the JOB, and the resume re-runs
  // the first call. That re-pay is self-limiting — it only occurs when the
  // rolling window freed enough for call 1 but not call 2, and every cycle
  // spends toward the same cap that parks it — a bounded cost, not a loop.
  const callOnce = async (prompt: string): Promise<PlanOutput> => {
    await assertBudget(db, "llm_tokens");
    const { object, usage } = await generateObject({ prompt, schema: planOutputSchema });
    await recordUsage(db, {
      provider: "anthropic",
      kind: "llm_tokens",
      quantity: usage.inputTokens + usage.outputTokens,
      costEstimateAgorot: llmCostAgorot(usage.inputTokens, usage.outputTokens),
      jobId: opts.jobId,
      businessId: opts.businessId,
    });
    return object;
  };

  let output = await callOnce(text);
  let violations = findPlanViolations(output.steps, opts.timeline, opts.questionnaire, maxSteps, {
    minSteps,
    notes: output.notes,
    minStepMs: durations.minMs,
    runtime,
  });
  if (violations.length > 0) {
    // "Minimal edits" matters: a from-scratch replan routinely fixes the named
    // violations while introducing brand-new ones (seen live: the retry swapped
    // in a fresh 5-word label), and there is no third call. The previous plan
    // is echoed back because each call is stateless — without it the model
    // cannot see the plan it is told to minimally edit and reinvents it
    // (seen live on a179f069: the retry dropped the success state the first
    // call had correctly selected).
    output = await callOnce(
      `${text}\n\nYour previous plan was:\n${JSON.stringify(output, null, 2)}\n\nIt violated these rules:\n${violations
        .map((v) => `- ${v}`)
        .join("\n")}\n\nReturn the same plan with the minimal edits that fix every violation named above. For each flagged label word, replace it with words copied from that state's \`visibleText\` (or the questionnaire) — do not paraphrase around it. Keep every step and label the violations above do not implicate unchanged, and keep every label at 6 words maximum.`,
    );
    violations = findPlanViolations(output.steps, opts.timeline, opts.questionnaire, maxSteps, {
      minSteps,
      notes: output.notes,
      minStepMs: durations.minMs,
      runtime,
    });
    if (violations.length > 0) {
      throw new PermanentError(`plan violates label rules after retry: ${violations.join("; ")}`, {
        customerMessage: "יצירת תוכנית הצעדים נכשלה — נסו שוב",
      });
    }
  }

  return {
    steps: assembleSteps(output.steps, opts.timeline, durations),
    unexplainedMoments: output.unexplainedMoments,
    notes: output.notes,
    promptVersion,
  };
}

// ---------------------------------------------------------------------------
// Plan rows: request / job handler / lifecycle
// ---------------------------------------------------------------------------

type StepPlan = typeof demoStepPlans.$inferSelect;

export async function getStepPlan(db: Db, planId: string): Promise<StepPlan | undefined> {
  const rows = await db.select().from(demoStepPlans).where(eq(demoStepPlans.id, planId)).limit(1);
  return rows[0];
}

/** The newest plan for a demo (any status) — what the wizard re-attaches to. */
export async function getLatestStepPlan(db: Db, demoId: string): Promise<StepPlan | undefined> {
  const rows = await db
    .select()
    .from(demoStepPlans)
    .where(eq(demoStepPlans.demoId, demoId))
    .orderBy(desc(demoStepPlans.createdAt))
    .limit(1);
  return rows[0];
}

/**
 * Create a plan row against the demo's ready analysis and queue its
 * generation. Every request is a NEW row (plans are cheap and regenerable);
 * approved plans that renders reference are never mutated by a regenerate.
 *
 * No spend guard here: CLI callers are the admin-bypassed founder. The Phase 7
 * web route MUST gate this behind assertAccountBudget — each request is 1-2
 * paid calls (same split as the hook-lines cap noted in docs/04).
 */
export async function requestDemoPlan(
  db: Db,
  demoId: string,
): Promise<{ planId: string; jobId: string }> {
  const analyses = await db
    .select()
    .from(demoAnalyses)
    .where(eq(demoAnalyses.demoId, demoId))
    .orderBy(desc(demoAnalyses.createdAt));
  const ready = analyses.find((a) => a.status === "ready");
  if (!ready) {
    throw new Error(
      `demo ${demoId} has no ready analysis — run \`aiugc demo analyze\` and \`aiugc work\` first`,
    );
  }

  // A regenerate while one is still generating collapses onto the in-flight
  // job (mirrors requestDemoAnalysis's live-JOB check — a row stuck after a
  // worker death must not lock requests out). Without this, every press is a
  // cheap enqueue that outruns the route's usage-based budget gate, and the
  // queued backlog spends past the cap after the route starts refusing.
  const latest = await getLatestStepPlan(db, demoId);
  if (latest && (latest.status === "pending" || latest.status === "planning")) {
    const jobRows = await db
      .select()
      .from(jobs)
      .where(eq(jobs.idempotencyKey, `plan:${latest.id}`))
      .limit(1);
    const live = jobRows[0];
    if (live && (live.status === "queued" || live.status === "running")) {
      return { planId: latest.id, jobId: live.id };
    }
  }

  const inserted = await db
    .insert(demoStepPlans)
    .values({ demoId, analysisId: ready.id, status: "pending" })
    .returning();
  const plan = inserted[0]!;
  const { job } = await enqueue(db, {
    type: "plan_demo_steps",
    idempotencyKey: `plan:${plan.id}`,
    payload: { planId: plan.id },
  });
  return { planId: plan.id, jobId: job.id };
}

/** Job handler (light lane — text-only, fast). */
export async function handlePlanDemoSteps(job: Job, ctx: JobContext): Promise<JobResult> {
  const { planId } = job.payload as { planId: string };
  const plan = await getStepPlan(ctx.db, planId);
  if (!plan) throw new PermanentError(`step plan ${planId} not found`);
  if (plan.status === "ready") return { kind: "done" }; // retry after success

  const setPlan = async (fields: Partial<typeof demoStepPlans.$inferInsert>) => {
    await ctx.db
      .update(demoStepPlans)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(demoStepPlans.id, planId));
  };

  try {
    const analysisRows = await ctx.db
      .select()
      .from(demoAnalyses)
      .where(eq(demoAnalyses.id, plan.analysisId))
      .limit(1);
    const analysis = analysisRows[0];
    if (analysis?.status !== "ready" || !analysis.timeline) {
      throw new PermanentError(`analysis ${plan.analysisId} is not ready`, {
        customerMessage: "ניתוח הסרטון עדיין לא מוכן — נסו שוב עוד רגע",
      });
    }
    const demoRows = await ctx.db.select().from(demos).where(eq(demos.id, plan.demoId)).limit(1);
    const demo = demoRows[0];
    if (!demo) throw new PermanentError(`demo ${plan.demoId} not found`);
    const questionnaire = await requireQuestionnaire(ctx.db, demo.businessId).catch((err) => {
      throw new PermanentError(err instanceof Error ? err.message : String(err), {
        customerMessage: "מלאו את שאלון העסק לפני יצירת התוכנית",
      });
    });

    // The confirm-to-execution window (renders.ts precedent): the route's
    // budget gate reads usage that lags the queue, so a queued backlog would
    // outrun it. Re-check here and fail fast — never park on an account cap.
    await assertAccountBudget(ctx.db, "llm_tokens", demo.businessId).catch((err) => {
      if (err instanceof AccountBudgetError) {
        throw new PermanentError(err.message, {
          customerMessage: "הגעתם למכסת יצירת התוכן היומית של החשבון — נסו שוב מחר.",
        });
      }
      throw err;
    });

    await setPlan({ status: "planning" });

    const timeline = analysisTimelineSchema.parse(analysis.timeline);
    const draft = await generateStepPlan(ctx.db, {
      timeline,
      questionnaire,
      businessId: demo.businessId,
      jobId: job.id,
    });

    await setPlan({
      status: "ready",
      steps: draft.steps,
      unexplainedMoments: draft.unexplainedMoments,
      notes: draft.notes,
      promptVersion: draft.promptVersion,
      failReason: null,
    });
    return { kind: "done" };
  } catch (err) {
    if (err instanceof PermanentError) {
      await setPlan({ status: "failed", failReason: err.customerMessage ?? err.message });
    } else if (!(err instanceof BudgetError) && isLastAttempt(job)) {
      await setPlan({ status: "failed", failReason: "יצירת התוכנית נכשלה — נסו שוב" });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Edits + approval (the gate)
// ---------------------------------------------------------------------------

/**
 * Replace a plan's steps with the user's selection. The client sends only
 * {sourceIndex, label} — timestamp, actionType and duration are re-derived
 * server-side and the result re-sorted by timestamp: chronology is a property
 * of the format, not a client convention. Labels are NOT checked against
 * visibleText — the anti-fabrication rule constrains the model, not the human.
 *
 * Before approval the row mutates in place. Any edit to an APPROVED plan forks
 * a new row (renders reference plans by id, like audio pins its script), and
 * any edit leaves approvedAt clear.
 */
export async function updatePlanSteps(
  db: Db,
  opts: { planId: string; steps: { sourceIndex: number; label: string }[] },
): Promise<StepPlan> {
  const plan = await getStepPlan(db, opts.planId);
  if (!plan) throw new Error(`step plan ${opts.planId} not found`);
  if (plan.status !== "ready") {
    throw new Error(`step plan ${opts.planId} is "${plan.status}" — only ready plans are editable`);
  }
  if (opts.steps.length === 0) throw new Error("a plan needs at least one step");

  const analysisRows = await db
    .select()
    .from(demoAnalyses)
    .where(eq(demoAnalyses.id, plan.analysisId))
    .limit(1);
  const timeline = analysisTimelineSchema.parse(analysisRows[0]?.timeline ?? []);

  const seen = new Set<number>();
  for (const step of opts.steps) {
    if (!Number.isInteger(step.sourceIndex) || !timeline[step.sourceIndex]) {
      throw new Error(`sourceIndex ${step.sourceIndex} is not in the analysis timeline`);
    }
    if (seen.has(step.sourceIndex)) {
      throw new Error(`sourceIndex ${step.sourceIndex} appears twice`);
    }
    seen.add(step.sourceIndex);
    // The picker filters unreadable states out of the UI; the server mirrors
    // it — an unreadable frame can never be shown, whoever selected it.
    if (timeline[step.sourceIndex]!.legibility === "unreadable") {
      throw new Error(`sourceIndex ${step.sourceIndex} is an unreadable state — it cannot be shown`);
    }
    if (!step.label.trim()) throw new Error(`step ${step.sourceIndex} has an empty label`);
    if (step.label.length > MAX_LABEL_CHARS) {
      throw new Error(`step ${step.sourceIndex} label is over ${MAX_LABEL_CHARS} characters`);
    }
  }

  const steps = assembleSteps(opts.steps, timeline, await stepDurations(db));

  const fork = async (): Promise<StepPlan> => {
    const inserted = await db
      .insert(demoStepPlans)
      .values({
        demoId: plan.demoId,
        analysisId: plan.analysisId,
        status: "ready",
        steps,
        unexplainedMoments: plan.unexplainedMoments,
        notes: plan.notes,
        promptVersion: plan.promptVersion,
      })
      .returning();
    return inserted[0]!;
  };

  if (plan.approvedAt) return fork();

  const updated = await db
    .update(demoStepPlans)
    .set({ steps, updatedAt: new Date() })
    .where(and(eq(demoStepPlans.id, plan.id), isNull(demoStepPlans.approvedAt)))
    .returning();
  // approvePlan may have won the race after our read — never overwrite what
  // the customer approved; fork exactly as if the approval had been seen.
  if (!updated[0]) return fork();
  return updated[0];
}

/** The gate: renders against a steps-format plan require approvedAt. */
export async function approvePlan(db: Db, planId: string): Promise<StepPlan> {
  const plan = await getStepPlan(db, planId);
  if (!plan) throw new Error(`step plan ${planId} not found`);
  if (plan.status !== "ready") {
    throw new Error(`step plan ${planId} is "${plan.status}" — only ready plans can be approved`);
  }
  if (plan.approvedAt) return plan;
  const updated = await db
    .update(demoStepPlans)
    .set({ approvedAt: new Date(), updatedAt: new Date() })
    .where(eq(demoStepPlans.id, planId))
    .returning();
  return updated[0]!;
}

// ---------------------------------------------------------------------------
// Regression harness (`aiugc plan regress`)
// ---------------------------------------------------------------------------

const fixtureSchema = z.object({
  questionnaire: questionnaireSchema,
  timeline: analysisTimelineSchema,
  expected: z.object({
    // The live (real-key) selection. `dryRunSourceIndexes` overrides it under
    // DRY_RUN, where the deterministic keyless plan ignores the prompt's skip
    // rules and so can legitimately differ from what the model selects.
    sourceIndexes: z.array(z.number()),
    dryRunSourceIndexes: z.array(z.number()).optional(),
    // For timelines with no genuine success state (the real-footage fixtures):
    // a plan that explains itself in `notes` is green even when the selection
    // drifts run to run — the notes ARE the expected behaviour.
    allowNotes: z.boolean().optional(),
  }),
});

export interface PlanRegressionResult {
  fixture: string;
  pass: boolean;
  expected: number[];
  actual: number[];
  steps: { sourceIndex: number; label: string }[];
  notes: string | null;
  error?: string;
}

/**
 * Re-run pass 2 over every saved fixture and diff the selection. Green/red is
 * the sourceIndex SET (labels vary run to run and are printed for eyeballing,
 * never asserted). Runs against fixture data directly — no rows are written.
 */
export async function runPlanRegression(db: Db): Promise<PlanRegressionResult[]> {
  // A checkout without the directory is the same empty state as no fixtures.
  if (!existsSync(FIXTURES_DIR)) return [];
  const files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json"));
  const results: PlanRegressionResult[] = [];
  for (const file of files) {
    // Parse inside the loop's try — one malformed fixture must fail ITS row,
    // never kill the whole run.
    let expected: number[] = [];
    try {
      const raw = JSON.parse(readFileSync(path.join(FIXTURES_DIR, file), "utf8")) as unknown;
      const fixture = fixtureSchema.parse(raw);
      const pinned =
        getEnv().DRY_RUN && fixture.expected.dryRunSourceIndexes
          ? fixture.expected.dryRunSourceIndexes
          : fixture.expected.sourceIndexes;
      expected = [...pinned].sort((a, b) => a - b);
      const draft = await generateStepPlan(db, {
        timeline: fixture.timeline,
        questionnaire: fixture.questionnaire,
      });
      const actual = draft.steps.map((s) => s.sourceIndex).sort((a, b) => a - b);
      const setMatch = JSON.stringify(actual) === JSON.stringify(expected);
      const explained =
        (fixture.expected.allowNotes ?? false) && draft.steps.length > 0 && !!draft.notes?.trim();
      results.push({
        fixture: file,
        pass: setMatch || explained,
        expected,
        actual,
        steps: draft.steps.map((s) => ({ sourceIndex: s.sourceIndex, label: s.label })),
        notes: draft.notes,
      });
    } catch (err) {
      results.push({
        fixture: file,
        pass: false,
        expected,
        actual: [],
        steps: [],
        notes: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

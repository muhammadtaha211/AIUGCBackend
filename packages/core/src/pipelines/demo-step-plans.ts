import { and, desc, eq, isNull } from "drizzle-orm";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getConfigValueOr } from "../appConfig";
import { assertBudget, recordUsage } from "../budget";
import { getEnv } from "../config";
import type { Db } from "../db";
import { demoAnalyses, demoStepPlans, demos } from "../db/schema";
import { BudgetError, PermanentError } from "../jobs/errors";
import { enqueue, isLastAttempt, type Job } from "../jobs/queue";
import type { JobContext, JobResult } from "../jobs/worker";
import { FIXTURES_DIR } from "../paths";
import { generateObject } from "../providers/anthropic";
import { renderPrompt } from "../prompts";
import { questionnaireSchema, requireQuestionnaire, type Questionnaire } from "./businesses";
import {
  ANALYSIS_ACTION_TYPES,
  analysisTimelineSchema,
  subsampleClusters,
  type AnalysisState,
} from "./demo-analysis";

/**
 * screenKinds the plan may never select — the deterministic form of the
 * prompt's prose skip list (login screens, tours, onboarding...), added after
 * a real run picked the login screen and two tour steps despite the prompt.
 * "product", "other" and absent (v2-era analyses without screenKind) pass;
 * missing means "no information", so those states stay prompt-governed.
 * The Phase 8 picker groups/hides by the same set.
 */
export const PLAN_SKIP_SCREEN_KINDS: ReadonlySet<
  NonNullable<AnalysisState["screenKind"]>
> = new Set(["login", "loading", "onboarding", "error", "tour", "system"] as const);

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

/** Per-step clip length by what the state shows; ~2s average keeps 6-8 steps
 *  inside the 12-17s target. Config `a_step_ms_by_action` overrides per key. */
const DEFAULT_STEP_MS: Record<AnalysisState["actionType"], number> = {
  navigate: 1800,
  tap: 1600,
  type: 2200,
  select: 1800,
  scroll: 2200,
  result: 2800,
  idle: 1600,
};

const MAX_LABEL_CHARS = 60;

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
  "כאן", "שם", "אחרי", "לפני", "בתוך", "עד", "ואז", "הנה", "ככה", "פשוט",
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
 * `notes` does not explain why it cannot), and a below-minimum plan must
 * explain itself in `notes`. Human edits deliberately
 * skip both — deleting steps just makes the video shorter.
 */
export function findPlanViolations(
  steps: { sourceIndex: number; label: string }[],
  timeline: AnalysisState[],
  questionnaire: Questionnaire,
  maxSteps: number,
  shape?: { minSteps: number; notes: string | null },
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
    // The 4-word cap counts what the viewer sees (whitespace words); the
    // content check below works on normalized tokens instead.
    const words = step.label.split(/\s+/).map(normalizeWord).filter(Boolean);
    if (words.length === 0) {
      violations.push(`step ${i}: label is empty`);
      return;
    }
    if (words.length > 4) {
      violations.push(`step ${i}: label "${step.label}" is over 4 words`);
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
    const hasSelectableResult = timeline.some(
      (s) => s.actionType === "result" && s.legibility !== "unreadable" && !isSkippedKind(s),
    );
    const valid = steps.filter(
      (s) => Number.isInteger(s.sourceIndex) && timeline[s.sourceIndex],
    );
    // `notes` waives the rule: the analysis may have typed error screens as
    // "result" (the timeline then OFFERS a result state that is not a genuine
    // success), and a plan cannot be forced to end on one. The model may end
    // elsewhere only by explaining why in `notes` — never silently.
    if (hasSelectableResult && valid.length > 0 && !shape.notes?.trim()) {
      const last = valid.reduce((a, b) =>
        timeline[a.sourceIndex]!.timestampMs >= timeline[b.sourceIndex]!.timestampMs ? a : b,
      );
      if (timeline[last.sourceIndex]!.actionType !== "result") {
        violations.push(
          "the last step must be the result/success state — the video ends there; if the timeline has no genuine success state (an error, warning or validation message is never success), keep your best journey and explain that in `notes` (Hebrew) instead",
        );
      }
    }
    if (steps.length < shape.minSteps && !shape.notes?.trim()) {
      violations.push(
        `the plan has ${steps.length} steps, fewer than the minimum ${shape.minSteps} — either select more genuinely distinct steps or explain why in \`notes\` (Hebrew); never pad`,
      );
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

async function stepDurations(db: Db): Promise<Record<string, number>> {
  const configured = await getConfigValueOr(
    db,
    "a_step_ms_by_action",
    z.record(z.string(), z.number()),
    {},
  );
  return { ...DEFAULT_STEP_MS, ...configured };
}

/** sourceIndex is the source of truth: timestamp and actionType come from the
 *  selected state, durationMs from config — chronological by construction. */
function assembleSteps(
  selected: { sourceIndex: number; label: string }[],
  timeline: AnalysisState[],
  durations: Record<string, number>,
): PlanStep[] {
  return selected
    .map(({ sourceIndex, label }) => {
      const state = timeline[sourceIndex]!;
      return {
        timestampMs: state.timestampMs,
        actionType: state.actionType,
        label: label.trim(),
        sourceIndex,
        durationMs: durations[state.actionType] ?? DEFAULT_STEP_MS[state.actionType],
      };
    })
    .sort((a, b) => a.timestampMs - b.timestampMs);
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
): PlanOutput {
  let candidates = timeline
    .map((state, index) => ({ state, index }))
    .filter(
      ({ state }) =>
        state.legibility === "high" &&
        !state.sameStateAsPrevious &&
        state.actionType !== "idle" &&
        !isSkippedKind(state),
    );
  if (candidates.length === 0) {
    candidates = timeline
      .map((state, index) => ({ state, index }))
      .filter(({ state }) => state.legibility !== "unreadable" && !isSkippedKind(state));
  }
  if (candidates.length === 0) throw new Error("dry-run plan: timeline has no usable states");

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
  let kept = subsampleClusters(candidates, maxSteps);
  if (lastResult) {
    kept = subsampleClusters(
      kept.filter(({ state }) => state.timestampMs < lastResult.state.timestampMs),
      maxSteps - 1,
    );
    kept.push(lastResult);
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
  const minSteps = Math.max(1, await getConfigValueOr(db, "a_steps_min", z.number(), 6));
  const maxSteps = Math.max(
    minSteps,
    await getConfigValueOr(db, "a_steps_max", z.number(), 8),
  );
  const durations = await stepDurations(db);

  if (getEnv().DRY_RUN) {
    const canned = dryRunPlan(opts.timeline, opts.questionnaire, minSteps, maxSteps);
    // The canned plan goes through the same enforcement as a real one, so the
    // whole validation path runs keyless; a violation here is a code bug.
    const violations = findPlanViolations(canned.steps, opts.timeline, opts.questionnaire, maxSteps, {
      minSteps,
      notes: canned.notes,
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
  });
  if (violations.length > 0) {
    // "Minimal edits" matters: a from-scratch replan routinely fixes the named
    // violations while introducing brand-new ones (seen live: the retry swapped
    // in a fresh 5-word label), and there is no third call.
    output = await callOnce(
      `${text}\n\nYour previous plan violated these rules:\n${violations
        .map((v) => `- ${v}`)
        .join("\n")}\n\nReturn the same plan with the minimal edits that fix every violation named above. For each flagged label word, replace it with words copied from that state's \`visibleText\` (or the questionnaire) — do not paraphrase around it. Keep steps and labels that were not named above unchanged, and keep every label at 4 words maximum.`,
    );
    violations = findPlanViolations(output.steps, opts.timeline, opts.questionnaire, maxSteps, {
      minSteps,
      notes: output.notes,
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

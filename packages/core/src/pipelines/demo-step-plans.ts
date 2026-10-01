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
  normalizeWord,
  PLAN_SKIP_SCREEN_KINDS,
  readTimeMs,
  splitWords,
  tokenizeWords,
  totalRuntimeMs,
} from "../plan-format";
import { generateObject } from "../providers/anthropic";
import { renderPrompt } from "../prompts";
import { questionnaireSchema, requireQuestionnaire, type Questionnaire } from "./businesses";
import {
  ANALYSIS_ACTION_TYPES,
  analysisFps,
  analysisTimelineSchema,
  subsampleClusters,
  type AnalysisState,
} from "./demo-analysis";

// These live in ../plan-format so the wizard's picker and plan surface can
// import them without dragging this module's db/fs/provider imports into a
// browser bundle. Kept re-exported here because every server caller already
// imports them from here.
export {
  MAX_LABEL_CHARS,
  normalizeWord,
  PLAN_SKIP_SCREEN_KINDS,
  readTimeMs,
  splitWords,
  tokenizeWords,
  totalRuntimeMs,
};

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
  /** The label's own tokens that came from none of the state's visibleText,
   *  the questionnaire or the demo description — findOffScreenWords, computed
   *  once on the accepted model plan and shown to the customer as unverified
   *  (decision 0049). Optional so every jsonb row written before it parses;
   *  [] on every human-edited plan. */
  offScreenWords: z.array(z.string()).optional(),
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
 *  (timestamp/actionType from the timeline, durationMs from the footage), so the
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

/** Ceiling on one step's clip, however long its screen stays up — it stops one
 *  step eating the ad. There is no floor: a step runs until the app leaves its
 *  screen, and is never padded past it to reach a minimum (decisions 0070,
 *  0072). Config `a_step_ms_max` overrides (no seeded row: a missing key IS
 *  the default). */
const MAX_STEP_MS = 4000;

/** The steps' own on-screen length — the hook clip is NOT counted, it sits on
 *  top. With the bank's ~4s hook this lands the finished ad at ~19-25s.
 *  15s since 2026-08-25 (decision 0002). Since steps follow the footage
 *  (0072) no step count fills the band by construction any more; what holds
 *  is coherence — minSteps full-length steps reach the floor without topping
 *  the ceiling, and maxSteps captionable steps fit under it (pinned by the
 *  band-coherence test). Recordings that cannot reach the floor pass through
 *  the reachability escape below; nothing is padded.
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

/** The closest two selected states may sit: the read time of the shortest
 *  caption the prompt allows. A step is cut where the next selected state
 *  starts, so under this gap the earlier one can carry no caption at all.
 *  Derived, not a knob — it replaced the 3s step floor (decision 0072). */
export const MIN_GAP_MS = readTimeMsForWords(MIN_LABEL_WORDS);

/** Whether a state's own clip (timelineClipMs) can carry the shortest caption
 *  the prompt allows. The ONE definition of a moment the model may pick
 *  (decision 0074): the timeline it is shown, the picks code strips, the
 *  validator's shape rules and the canned planner all read it. */
const captionableClip = (clipMs: number): boolean => clipMs >= MIN_GAP_MS;

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
  /** The cap on one step's clip (StepDurationConfig.maxMs). */
  maxMs: number;
  runtime: { minMs: number; maxMs: number };
  minSteps: number;
  maxSteps: number;
}): string {
  const { maxMs, runtime, minSteps, maxSteps } = opts;
  const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  const range = (from: number, to: number): number[] =>
    Array.from({ length: to - from + 1 }, (_, i) => from + i);

  // Rows the cap could never grant are not offers. A configured a_step_ms_max
  // below a row's read time caps every step under it, so the row would promise
  // a window the code never hands out. Never empty: a ceiling under the
  // shortest read time is a broken config, not a shorter table.
  const grantable = range(MIN_LABEL_WORDS, MAX_LABEL_WORDS).filter(
    (w) => readTimeMsForWords(w) <= maxMs,
  );
  const lengths = grantable.length > 0 ? grantable : [MIN_LABEL_WORDS];
  const readRows = lengths.map((w) => `| ${w} words | ${secs(readTimeMsForWords(w))} |`);

  return [
    "| caption | seconds it needs |",
    "| ------- | ---------------- |",
    ...readRows,
    "",
    `Every timeline entry carries \`clipMs\`: how long a step that starts there runs before the app leaves that screen, never more than ${secs(maxMs)}. A selected step runs its \`clipMs\` — or less, when your next selected state starts sooner.`,
    "",
    `Under a ${secs(MIN_GAP_MS)} gap you may not select both states at all.`,
    "",
    `The steps must total ${(runtime.minMs / 1000).toFixed(1)}-${secs(runtime.maxMs)}; aim near ${secs(
      Math.round((runtime.minMs + runtime.maxMs) / 2),
    )}. Add up what each step you selected actually runs — its \`clipMs\`, or the gap to your next selected state when that is shorter — before you settle. ${minSteps} full-length steps run ${secs(
      minSteps * maxMs,
    )}; a ${minSteps}–${maxSteps}-step plan over the band needs its least essential step dropped, one under it needs another genuinely different beat.`,
  ].join("\n");
}

/** Rough cost bookkeeping — same math as pipelines/copy.ts (3rd use is Phase 6's problem). */
function llmCostAgorot(inputTokens: number, outputTokens: number): number {
  return Math.ceil(((inputTokens * 3 + outputTokens * 15) / 1_000_000) * 370);
}

// ---------------------------------------------------------------------------
// Deterministic label-word provenance (the highlight — decision 0049)
// ---------------------------------------------------------------------------

/** Single-letter prefixes Hebrew glues onto content words (ו/ה/ב/ל/מ/ש/כ). */
const HEBREW_PREFIXES = new Set(["ו", "ה", "ב", "ל", "מ", "ש", "כ"]);

/**
 * Function words that carry no content and are always allowed. Deliberately
 * conservative: every addition weakens the anti-fabrication rule.
 */
const FUNCTION_WORDS = new Set([
  "של",
  "את",
  "עם",
  "על",
  "אל",
  "זה",
  "זו",
  "זאת",
  "זהו",
  "אז",
  "גם",
  "רק",
  "כל",
  "לא",
  "יש",
  "אין",
  "עוד",
  "כבר",
  "או",
  "אם",
  "כי",
  "מה",
  "מי",
  "איך",
  "כאן",
  "שם",
  "אחרי",
  "לפני",
  "בתוך",
  "עד",
  "ואז",
  "הנה",
  "ככה",
  "פשוט",
  "במקום",
  // Pronouns and possessives. A caption addressed to the viewer needs them and
  // none of them can carry a product claim. The two-letter members are
  // reachable by prefix-stripping — "כלי" strips כ down to "לי" and passes —
  // which is the same 1-2 char slack window wordVariants already documents.
  "הוא",
  "היא",
  "הם",
  "הן",
  "אתם",
  "שלי",
  "שלך",
  "שלכם",
  "לי",
  "לך",
  "לכם",
  "אותו",
  "אותה",
  "אותם",
  // שלו/שלה close the half-added set: they strip to "לו"/"לה", which are not
  // members, so the singular third person false-rejected while the plural
  // "שלהם" passed by double-stripping down to "הם". An asymmetry nobody chose.
  "שלו",
  "שלה",
  // Bare prepositions and conjunctions. Same membership test as everything
  // above — a word that carries no product claim — and none of these can:
  // "according to", "without", "in order to", "via", "opposite", "next to",
  // "at", "for", "because of", "like", "out of", "but". The list had "לפני"
  // and not "לפי", and "לפי" false-rejected a live plan three rounds running
  // on 2026-09-14/15 (docs/vault/facts/label-rule-families-2026-09-15.md) —
  // the only preposition ever flagged.
  // "בלי" already passed by stripping ב down to "לי"; listing it makes that
  // direct instead of accidental. Prefix-stripping exposure, written down
  // rather than assumed away: "הדרך"/"בדרך" strip to "דרך" and pass too —
  // the same slack window "כלי" → "לי" and "בעל" → "על" already open, and
  // how something is done is not a claim the screen would need to back.
  // "בין" ("between") was a member for one commit (a4c1339) and came back
  // off: it admits "הבין"/"מבין" by that same stripping, and a verb of
  // UNDERSTANDING is a product-capability claim — the exact class this
  // highlight exists to surface. The cost is real and accepted: the genuine
  // preposition, and its "ובין"/"לבין" forms, is now marked when the screen
  // does not carry it. An amber mark is the right price for not waving
  // through "הבין את הצורך". (Longer forms were never exempt either way —
  // "מבינים" strips to "בינים", "הבינו" to "בינו", neither of them a member.)
  "לפי",
  "בלי",
  "כדי",
  "דרך",
  "מול",
  "ליד",
  "אצל",
  "בשביל",
  "בגלל",
  "כמו",
  "מתוך",
  "אבל",
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
  "כנסו",
  "היכנסו",
  "הכנסו", // enter
  "לחצו", // click
  "בחרו", // choose
  "העלו", // upload
  "פתחו", // open
  "הקלידו",
  "כתבו", // type
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
  "אשרו",
  "אישרו",
  // start/begin. Listed as the ה-initial surface form for the same reason
  // "היכנסו" is: stripping ה leaves "תחילו", which is not the base.
  "התחילו",
  "התחלו",
  // The present-tense masculine-plural NARRATION forms of exactly the verbs
  // above — "you enter, you click, you choose" as a friend narrating the
  // screen says it — and nothing else: a verb whose imperative is not listed
  // does not get its present tense here either (the list stays a list, not a
  // morphology rule). They are as claim-free as the imperatives; v13 warned
  // the model these "are NOT on the list", which cost a corrective call every
  // time it reached for the natural form. One per imperative, in list order.
  "נכנסים", // כנסו / היכנסו / הכנסו
  "לוחצים", // לחצו
  "בוחרים", // בחרו
  "מעלים", // העלו
  "פותחים", // פתחו
  "מקלידים", // הקלידו
  "כותבים", // כתבו
  "גוררים", // גררו
  "מסמנים", // סמנו
  "ממלאים", // מלאו
  "שולחים", // שלחו
  "מחפשים", // חפשו
  "שומרים", // שמרו
  "גוללים", // גללו
  "מאשרים", // אשרו / אישרו
  "מתחילים", // התחילו / התחלו
]);

// normalizeWord / tokenizeWords / splitWords live in ../plan-format (imported
// above): the editor's marks must find the same tokens this file flags.

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
 * The provenance HIGHLIGHT (decision 0049): per step, the label's own tokens
 * that come from none of three sources — the selected state's visibleText
 * (pooled across its sameStateAsPrevious run), the questionnaire, or the
 * customer's demo description (customer-authored claims, the demo_notes
 * precedent, so the note the upload step asks for genuinely widens what a
 * caption may say) — after the same three exemptions the old gate had:
 * function words, instruction verbs, and a prefix letter left standalone by
 * punctuation ("ל־BotTeacher" splits into ל + botteacher). Variants, not the
 * exact word, on the exemptions too: Hebrew glues ו/ש/כ onto function words
 * and verbs constantly ("וגם", "ולחצו"), and a mark there would be noise.
 *
 * Computed ONCE on the accepted plan and stored on each step as
 * offScreenWords, so the editor can show the customer which words did not
 * come from their recording. It never fails a plan and never costs a
 * corrective call: every retry round ever recorded was this rule and nothing
 * else (docs/vault/facts/label-rule-families-2026-09-15.md). `words` are the
 * tokens AS WRITTEN (splitWords), so the editor marks them by exact match;
 * normalization is for matching only. Human-edited labels never pass through
 * here — updatePlanSteps writes [].
 */
export function findOffScreenWords(
  steps: { sourceIndex: number; label: string }[],
  timeline: AnalysisState[],
  questionnaire: Questionnaire,
  demoDescription?: string | null,
): { index: number; sourceIndex: number; words: string[] }[] {
  const allowedQuestionnaire = expandToVariantSet([
    ...questionnaireWords(questionnaire),
    ...tokenizeWords(demoDescription ?? ""),
  ]);
  return steps.map((step, index) => {
    // A sourceIndex outside the timeline has no screen to match against;
    // findPlanViolations rejects it before the plan can be accepted.
    const allowedState = timeline[step.sourceIndex]
      ? expandToVariantSet(
          dupRunIndexes(timeline, step.sourceIndex).flatMap((j) =>
            timeline[j]!.visibleText.flatMap(tokenizeWords),
          ),
        )
      : new Set<string>();
    const words: string[] = [];
    for (const raw of splitWords(step.label)) {
      const word = normalizeWord(raw);
      if (!word) continue;
      const variants = wordVariants(word);
      if (variants.some((v) => FUNCTION_WORDS.has(v))) continue;
      if (variants.some((v) => INSTRUCTIONAL_VERBS.has(v))) continue;
      if (word.length === 1 && HEBREW_PREFIXES.has(word)) continue;
      if (variants.some((v) => allowedState.has(v) || allowedQuestionnaire.has(v))) continue;
      words.push(raw);
    }
    return { index, sourceIndex: step.sourceIndex, words };
  });
}

/** The assembled steps with their offScreenWords attached — the one place a
 *  model plan's highlight is computed. assembleSteps re-sorts by timestamp,
 *  so the highlight runs on the assembled order and lines up by position. */
function withOffScreenWords(
  assembled: PlanStep[],
  timeline: AnalysisState[],
  questionnaire: Questionnaire,
  demoDescription?: string | null,
  pinnedIndex?: number,
): PlanStep[] {
  const flagged = findOffScreenWords(assembled, timeline, questionnaire, demoDescription);
  return assembled.map((step, i) => ({
    ...step,
    // The pinned access step's caption is fixed copy, not the model's words:
    // never marked, whatever the exemption sets say tomorrow. (Today they
    // clear it anyway — כנסו is an instruction verb, לכאן a prefixed function
    // word — so this is a guarantee, not a fix.)
    offScreenWords: step.sourceIndex === pinnedIndex ? [] : flagged[i]!.words,
  }));
}

// ---------------------------------------------------------------------------
// The access moment — the pinned "כנסו לכאן" first step (founder rule,
// 2026-09-23)
// ---------------------------------------------------------------------------

/**
 * The demo step's tip asks customers to open the recording by typing the
 * site's address. When the analysis shows that moment, the generated plan
 * ALWAYS starts there, with this exact caption, pinned by CODE. The prompt
 * has asked for a way-in step since v4 and could not get one whenever the
 * vision pass read the browser's new tab and address bar as `system` (an OS
 * surface, hence a skip kind the validator rejects): the founder hand-added
 * exactly this step on both of his 2026-09-18/20 demos. The customer edits
 * or deletes it like any other step — nothing downstream knows it is pinned.
 */
export const ACCESS_LABEL = "כנסו לכאן";

/** The access moment is looked for only this deep into the recording, and
 *  never past the first product or loading screen: a URL typed later is a
 *  search inside the product, not the way in. This bounds the SEARCH only —
 *  the drop zone below is the address-bar run, never the whole window. */
export const ACCESS_WINDOW_MS = 15_000;

const ACCESS_WINDOW_CLOSERS: ReadonlySet<string> = new Set(["product", "loading"]);
/** Kinds a candidate may never carry: a domain on a login, onboarding, error
 *  or tour screen is not the way in. `system` and `other` are what the vision
 *  pass actually calls browser chrome; absent (v2-era analyses) passes. */
const ACCESS_EXCLUDED_KINDS: ReadonlySet<string> = new Set([
  "login",
  "onboarding",
  "error",
  "tour",
]);

/** TLDs a domain-like token may end in. Short on purpose — what the corpus
 *  shows plus the Israeli set. The questionnaire's own link (registrableDomain
 *  below) is the second signal and covers everything else. */
const URL_TLDS = "com|co\\.il|org\\.il|net\\.il|ac\\.il|gov\\.il|il|net|org|io|app|ai|dev";
/** An explicit http(s) URL, or label(.label)*.tld not glued to a letter,
 *  digit, "@", "." or "-" on the left and not followed by a letter or digit
 *  (so `index.html`, `3.5`, `e.g.` and `Syllabus.txt` never match). */
const URL_TOKEN = new RegExp(
  `(?:https?://\\S+|(?:^|[^\\p{L}\\p{N}@.\\-])[\\p{L}\\p{N}\\-]+(?:\\.[\\p{L}\\p{N}\\-]+)*\\.(?:${URL_TLDS})(?![\\p{L}\\p{N}]))`,
  "iu",
);

/** Public suffixes that take two labels, so the registrable domain is the
 *  last THREE labels of the host (app.jobnet.co.il -> jobnet.co.il). */
const TWO_LABEL_SUFFIXES: ReadonlySet<string> = new Set([
  "co.il",
  "org.il",
  "net.il",
  "ac.il",
  "gov.il",
  "muni.il",
  "k12.il",
  "co.uk",
  "org.uk",
  "com.au",
]);

/** The registrable domain of the questionnaire's link — undefined when there
 *  is no link or it does not parse as a host. Compared as a lowercase
 *  substring of a visibleText entry, so an off-list TLD still detects. */
export function registrableDomain(link: string | null | undefined): string | undefined {
  const raw = link?.trim();
  if (!raw) return undefined;
  let host: string;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).hostname;
  } catch {
    return undefined;
  }
  const labels = host
    .toLowerCase()
    .replace(/^www\./, "")
    .split(".")
    .filter(Boolean);
  if (labels.length < 2) return undefined;
  const keep = TWO_LABEL_SUFFIXES.has(labels.slice(-2).join(".")) ? 3 : 2;
  return labels.slice(-keep).join(".");
}

// ---------------------------------------------------------------------------
// Screens — where a step's clip ends (decisions 0070, 0072)
// ---------------------------------------------------------------------------

/** Words for the same-screen test: lowercase NFC tokens of 2+ characters,
 *  split on anything but a letter, digit or dot (a domain stays one token),
 *  edge dots stripped. */
function screenTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text
    .normalize("NFC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}.]+/u)) {
    const token = raw.replace(/^\.+|\.+$/g, "");
    if (token.length >= 2) out.add(token);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return shared / (a.size + b.size - shared);
}

function within(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0) return false;
  for (const token of a) if (!b.has(token)) return false;
  return true;
}

/** Two screenNames for one screen. analyze_demo names every frame afresh and
 *  the names drift at batch seams ("tavnit.ai - שם המוצר", then "שם המוצר"), so
 *  equality alone would cut on every rename: equal, the same text before
 *  " - ", one name's words inside the other's, or half the words shared. */
function similarScreenNames(a: string, b: string): boolean {
  if (a === b) return true;
  const head = (name: string) =>
    name
      .split(/\s+[-–—]\s+/)[0]!
      .trim()
      .toLowerCase();
  if (head(a) === head(b)) return true;
  const ta = screenTokens(a);
  const tb = screenTokens(b);
  return within(ta, tb) || within(tb, ta) || jaccard(ta, tb) >= 0.5;
}

type ScreenFields = Pick<
  AnalysisState,
  "screenName" | "visibleText" | "actionType" | "sameStateAsPrevious"
>;

/**
 * Whether `cur` shows a different screen from `prev`, the state before it. The
 * analysis model's judgement (decision 0070), never pixel distance — a scroll
 * changes most of the frame and is still the same screen. Two of its three
 * signals must agree: it called `cur` a navigation, it named the two screens
 * differently, their transcribed text is mostly different. A popup, a typing
 * run or a scroll keeps the page's name and most of its text, so it stays one
 * screen; one mislabelled `navigate` cannot cut on its own. A frame the model
 * called a duplicate never starts a screen. Chosen against the footage of
 * every stored plan (docs/vault/facts/screen-change-signal-2026-10-01.md).
 */
export function isNewScreen(prev: ScreenFields, cur: ScreenFields): boolean {
  if (cur.sameStateAsPrevious) return false;
  const textOf = (s: ScreenFields) => screenTokens(s.visibleText.join(" "));
  const votes = [
    cur.actionType === "navigate",
    !similarScreenNames(prev.screenName, cur.screenName),
    jaccard(textOf(prev), textOf(cur)) < 0.25,
  ];
  return votes.filter(Boolean).length >= 2;
}

/** What a step's clip is bounded by besides its own state and the next one
 *  selected: the cap, the analysis sample, the recording's end. */
export interface ClipBounds extends StepDurationConfig {
  recordingEndMs: number;
}

/**
 * Where the recording ends for step purposes. demos.duration_ms is the raw
 * upload's container length, so it is floored to the analysis grid; and never
 * earlier than one sample past the last state — that state's cluster holds at
 * least two samples (MIN_CLUSTER_FRAMES), so the frame exists. No length
 * (DRY_RUN stubs, regress fixtures without one): the last state plus one
 * sample.
 */
export function recordingEndMs(
  durationMs: number | null | undefined,
  timeline: { timestampMs: number }[],
  sampleMs: number,
): number {
  const afterLast = (timeline[timeline.length - 1]?.timestampMs ?? 0) + sampleMs;
  if (durationMs === null || durationMs === undefined) return afterLast;
  return Math.max(Math.floor(durationMs / sampleMs) * sampleMs, afterLast);
}

export function clipBounds(
  durations: StepDurationConfig,
  timeline: { timestampMs: number }[],
  durationMs: number | null | undefined,
): ClipBounds {
  return { ...durations, recordingEndMs: recordingEndMs(durationMs, timeline, durations.sampleMs) };
}

/**
 * For every state, when its screen ends: one analysis sample after the last
 * state still on it, or the recording's end. A stored timestampMs is the LOWER
 * median of a cluster of at least two samples (ffmpeg.ts clusterStates), so
 * the next sample is still inside that cluster — the cut never shows a frame
 * of what follows unless isNewScreen missed the change. That is "cut early
 * when unsure" (decision 0072): measured on the footage, it cut 0 of 64 plan
 * steps late, at the price of a short clip for a state picked last on its
 * screen.
 *
 * The sample is today's a_analysis_fps; nothing stores the rate an analysis
 * ran at. Lowering that knob after the fact would push the cut past a stored
 * timeline's own next sample, so the cut never passes the next screen's first
 * state either — a bound, not the guarantee (defects/
 * screen-cut-assumes-the-current-analysis-fps.md).
 */
export function screenEnds(timeline: AnalysisState[], bounds: ClipBounds): number[] {
  const ends = new Array<number>(timeline.length);
  let end = bounds.recordingEndMs;
  for (let i = timeline.length - 1; i >= 0; i--) {
    ends[i] = end;
    if (i > 0 && isNewScreen(timeline[i - 1]!, timeline[i]!)) {
      end = Math.min(
        timeline[i - 1]!.timestampMs + bounds.sampleMs,
        timeline[i]!.timestampMs,
        bounds.recordingEndMs,
      );
    }
  }
  return ends;
}

/** Each state's own clip if a step started there: to its screen's end, never
 *  past the cap. What the model sees as `clipMs` and the inventory previews.
 *  A selected step is ALSO cut where the next selected state starts — that is
 *  assembleSteps' half. Always at least one sample (maxMs >= sampleMs). */
export function timelineClipMs(timeline: AnalysisState[], bounds: ClipBounds): number[] {
  const ends = screenEnds(timeline, bounds);
  return timeline.map((s, i) => Math.min(s.timestampMs + bounds.maxMs, ends[i]!) - s.timestampMs);
}

export interface AccessMoment {
  /** The pinned state. */
  index: number;
  /** Its assembled clip length — its screen's end or the cap, like every
   *  step. Never a literal: the model-facing band and the drop zone read it. */
  pinMs: number;
  /** The address-bar run: the candidates on the first candidate's screen. */
  run: number[];
  /** When the run's screen ends (screenEnds). */
  runEndMs: number;
  /** [runStartMs, dropUntilMs): the run plus the pin's clip, and never less
   *  than MIN_GAP_MS past the pin — a state closer than that would be a
   *  min-gap violation next to it. A step the model (or the canned planner)
   *  puts in here is dropped — it is the moment the pin already shows. NOT
   *  the search window: when the loaded site is
   *  read as `other` and no loading screen was caught (2 of 6 production
   *  analyses), the window runs to 15s and would swallow real product steps. */
  runStartMs: number;
  dropUntilMs: number;
}

/**
 * Find the access moment on an analysed timeline. Deterministic, and it reads
 * only what the vision pass already transcribed, so it costs nothing and
 * works on every analysis already on disk (re-planning never re-analyses).
 *
 * Candidate: inside the window; not unreadable, not a duplicate frame;
 * actionType type/select (every real opening in the corpus is a `type`
 * state, while a loaded page with its URL bar in frame is navigate/idle);
 * kind not excluded; and some visibleText entry with no "@" in it (an email
 * is not an address) carries a URL-like token or the link's domain.
 * Run: the candidates on the first candidate's screen (screenEnds) — one
 * moment on screen; a candidate on a later screen is a second typing, not
 * this one.
 * Pin: the EARLIEST run candidate whose clip reaches the screen's end inside
 * the cap and is long enough to read the caption, so the clip shows the
 * address being typed through to the moment the page leaves the address bar;
 * failing that, the latest candidate whose capped clip is long enough. No pin
 * at all when no candidate's clip can carry the caption: the pin is re-pinned
 * every round, so a read-time violation on it could never be fixed.
 */
export function findAccessMoment(
  timeline: AnalysisState[],
  opts: { bounds: ClipBounds; link?: string | null },
): AccessMoment | null {
  const domain = registrableDomain(opts.link);
  const carriesAddress = (entry: string): boolean =>
    !entry.includes("@") &&
    (URL_TOKEN.test(entry) || (domain !== undefined && entry.toLowerCase().includes(domain)));
  const isCandidate = (s: AnalysisState): boolean =>
    s.legibility !== "unreadable" &&
    !s.sameStateAsPrevious &&
    (s.actionType === "type" || s.actionType === "select") &&
    !(s.screenKind !== undefined && ACCESS_EXCLUDED_KINDS.has(s.screenKind)) &&
    s.visibleText.some(carriesAddress);

  const candidates: number[] = [];
  for (const [i, s] of timeline.entries()) {
    if (s.timestampMs > ACCESS_WINDOW_MS) break;
    if (s.screenKind !== undefined && ACCESS_WINDOW_CLOSERS.has(s.screenKind)) break;
    if (isCandidate(s)) candidates.push(i);
  }
  if (candidates.length === 0) return null;

  const ts = (i: number): number => timeline[i]!.timestampMs;
  const ends = screenEnds(timeline, opts.bounds);
  const runEndMs = ends[candidates[0]!]!;
  const run = candidates.filter((c) => ends[c] === runEndMs);
  const clips = timelineClipMs(timeline, opts.bounds);
  const readable = (c: number): boolean => clips[c]! >= readTimeMs(ACCESS_LABEL);
  const index =
    run.find((c) => ts(c) + opts.bounds.maxMs >= runEndMs && readable(c)) ??
    [...run].reverse().find(readable);
  if (index === undefined) return null;
  const pinMs = clips[index]!;
  return {
    index,
    pinMs,
    run,
    runEndMs,
    runStartMs: ts(run[0]!),
    dropUntilMs: Math.max(runEndMs, ts(index) + pinMs, ts(index) + MIN_GAP_MS),
  };
}

/** A selection with the access step pinned first. The selector's own pick of
 *  the same state and every step inside the drop zone go — the run and the
 *  pin's clip are one moment on screen and the pin already shows it — so the
 *  model can never duplicate or crowd it, whatever it returns. Out-of-range
 *  indexes pass through for the validator to name. */
function withPin(
  steps: { sourceIndex: number; label: string }[],
  timeline: AnalysisState[],
  access: AccessMoment | null,
): { sourceIndex: number; label: string }[] {
  if (!access) return steps;
  const kept = steps.filter((step) => {
    if (step.sourceIndex === access.index) return false;
    const state = Number.isInteger(step.sourceIndex) ? timeline[step.sourceIndex] : undefined;
    if (!state) return true;
    return state.timestampMs < access.runStartMs || state.timestampMs >= access.dropUntilMs;
  });
  return [{ sourceIndex: access.index, label: ACCESS_LABEL }, ...kept];
}

/** The model-facing notice appended under the rendered prompt when a pin
 *  exists. Appended in code, the way correctivePrompt appends, so the prompt
 *  file stays the shipped one and a recording with no access moment renders it
 *  verbatim. The numbers are the same ones findPlanViolations enforces on the
 *  combined plan, never restated by hand. */
function accessNotice(
  access: AccessMoment,
  timeline: AnalysisState[],
  modelMin: number,
  modelMax: number,
): string {
  return [
    "## The way in is already the first step",
    "",
    `Ignore rule 4 ("Open with the way in"): the system has fixed step 1 of this plan — state ${access.index} (${timeline[access.index]!.timestampMs}ms, the customer typing the address), captioned "${ACCESS_LABEL}", running ${(access.pinMs / 1000).toFixed(1)}s. It appears as index 0 in any plan echoed back to you; whether or not you repeat it, the system re-pins it — never move or recaption it. Never select state ${access.index}, any state from ${access.runStartMs}ms up to ${access.dropUntilMs}ms, or write a "go here" caption of your own. The ${modelMin}–${modelMax} steps and the runtime band above already exclude that step: select your own steps at ${access.dropUntilMs}ms or later, and end on the success state as before.`,
  ].join("\n");
}

/**
 * Every violation in a model-proposed plan, as model-facing English strings.
 * Empty array = valid. Deterministic on purpose: the plan-shape rules are
 * enforced here, not just requested in the prompt. This constrains the MODEL —
 * user-edited labels never pass through it. Label PROVENANCE is not in here
 * any more: findOffScreenWords computes it and the editor shows it (decision
 * 0049). `shape` adds the plan-shape rules the generation path enforces on
 * top of the per-step rules: the video must end on the success state (when
 * the timeline offers a selectable one and `notes` does not explain why it
 * cannot); a below-minimum plan is a violation unless the timeline itself
 * cannot offer that many selectable states; no two selected states may sit
 * closer than MIN_GAP_MS; and, when `shape.runtime` is supplied, every
 * assembled caption must be readable and the steps must total inside the
 * format's band. Human edits deliberately skip all of these — deleting steps
 * just makes the video shorter.
 *
 * A state whose own clip (timelineClipMs) is under MIN_GAP_MS can carry no
 * caption, so the shape rules treat it as unselectable: it is never the
 * required ending and never counted toward what the timeline can offer.
 * Otherwise the ending rule and the read-time rule would demand opposite
 * things of the same state and no retry could satisfy both. The generation
 * path goes further (decision 0074): the model is never shown such a state
 * and a pick of one is stripped before this function sees the plan.
 */
export function findPlanViolations(
  steps: { sourceIndex: number; label: string }[],
  timeline: AnalysisState[],
  maxSteps: number,
  shape?: {
    minSteps: number;
    notes: string | null;
    /** What bounds each clip — the shape rules read every state's clip. */
    bounds: ClipBounds;
    /** Absent = do not check captions against their clips or the total. */
    runtime?: { minMs: number; maxMs: number };
    /** The pinned access step, when the generation path pinned one. Its
     *  state may carry a skipped kind (the vision pass calls browser chrome
     *  `system`) — that one check is waived for it, nothing else is. The
     *  waiver walk and the reachability bound also skip the drop zone, which
     *  withPin makes unselectable: counting a state there would demand a
     *  plan no retry can produce. */
    pinned?: AccessMoment;
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
  const pinned = shape?.pinned;
  const inDropZone = (index: number, s: AnalysisState): boolean =>
    pinned !== undefined &&
    index !== pinned.index &&
    s.timestampMs >= pinned.runStartMs &&
    s.timestampMs < pinned.dropUntilMs;
  const clips = shape ? timelineClipMs(timeline, shape.bounds) : [];
  const captionable = (index: number): boolean => captionableClip(clips[index]!);
  /** The per-step legality the two bounds below count — the pin counts
   *  whatever its kind, exactly as the per-step check accepts it. */
  const selectable = (index: number, s: AnalysisState): boolean =>
    index === pinned?.index ||
    (s.legibility !== "unreadable" &&
      !isSkippedKind(s) &&
      !s.sameStateAsPrevious &&
      captionable(index));

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
    if (isSkippedKind(state) && step.sourceIndex !== pinned?.index) {
      violations.push(
        `step ${i}: state ${step.sourceIndex} is a "${state.screenKind}" screen — login, loading, onboarding, error, tour and system screens are never steps; select the customer using the product itself`,
      );
    }
    if (step.label.length > MAX_LABEL_CHARS) {
      violations.push(`step ${i}: label is over ${MAX_LABEL_CHARS} characters`);
    }
    // The word cap counts what the viewer sees (whitespace words);
    // findOffScreenWords works on normalized tokens instead.
    const words = step.label.split(/\s+/).map(normalizeWord).filter(Boolean);
    if (words.length === 0) {
      violations.push(`step ${i}: label is empty`);
      return;
    }
    if (words.length > MAX_LABEL_WORDS) {
      violations.push(`step ${i}: label "${step.label}" is over ${MAX_LABEL_WORDS} words`);
    }
  });

  if (shape) {
    // The format invariant: the video ends on the success state. Enforceable
    // only when the timeline offers a selectable result state — the analysis
    // may have mistyped the success screen, and a plan cannot end on a state
    // that does not exist. A skip-kind "result" (a validation error the
    // analysis mistyped) is not selectable either, so it cannot force the rule;
    // nor is a success screen too short to caption.
    const successCandidates = timeline
      .map((s, i) => ({ s, i }))
      .filter(
        ({ s, i }) =>
          s.actionType === "result" &&
          s.legibility !== "unreadable" &&
          !isSkippedKind(s) &&
          !inDropZone(i, s) &&
          captionable(i),
      );
    const valid = steps.filter((s) => Number.isInteger(s.sourceIndex) && timeline[s.sourceIndex]);
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
      let selectableCount = 0;
      let lastMs = Number.NEGATIVE_INFINITY;
      for (const [index, s] of timeline.entries()) {
        if (!selectable(index, s) || inDropZone(index, s)) continue;
        if (s.timestampMs > endsAtMs) break;
        if (s.timestampMs - lastMs < MIN_GAP_MS) continue;
        selectableCount++;
        lastMs = s.timestampMs;
      }
      if (selectableCount >= shape.minSteps) {
        violations.push(
          `the plan has ${steps.length} steps, fewer than the minimum ${shape.minSteps} — this timeline offers ${selectableCount} selectable states, so select more genuinely distinct ones; \`notes\` does not waive this, and never pad with loading, duplicate or otherwise skipped states`,
        );
      }
    }
    // A step is cut where the next selected state starts, so two selections
    // closer than the shortest caption's read time leave the first one no
    // caption at all. Real timelines put states 400ms apart, so this is
    // reachable. Named here so the corrective retry can drop one of the pair;
    // the `notes` escape hatch does not apply, nothing explains a 400ms clip.
    const chronological = [...seen].sort(
      (a, b) => timeline[a]!.timestampMs - timeline[b]!.timestampMs,
    );
    for (let i = 1; i < chronological.length; i++) {
      const before = chronological[i - 1]!;
      const after = chronological[i]!;
      const gap = timeline[after]!.timestampMs - timeline[before]!.timestampMs;
      if (gap < MIN_GAP_MS) {
        violations.push(
          `states ${before} and ${after} are only ${gap}ms apart — a step ends where the next selected state starts, and no caption can be read in under ${MIN_GAP_MS}ms, so these two are the same moment on screen; keep whichever reads better and select a genuinely different state instead of the other`,
        );
      }
    }
    if (shape.runtime) {
      // ASSEMBLED, never nominal: each clip runs to its screen's end or the
      // cap, and the next selected state cuts it shorter, so only the
      // assembled windows are what the video shows. The message carries the
      // current total and the direction to move — the corrective retry has no
      // other way to know which way that is.
      const assembled = assembleSteps(valid, timeline, shape.bounds);
      const total = totalRuntimeMs(assembled);
      // A caption the eye cannot finish is not a caption, and the window is
      // the only place that is visible. The shipped a179f069 plan burned two
      // of six captions under their own read time, including a two-line one
      // on screen 1600ms.
      //
      // The remedy depends on what cut the window. The NEXT selected state:
      // rewriting the label in place often cannot fix it, and merging the pair
      // into one caption is exactly what the ONE-CAPTION-PER-BEAT rule asks
      // for. The screen itself (or the recording's end): the state was picked
      // too late on its screen — drop the step, or an earlier moment buys time.
      //
      // A rewrite is only offered when a caption of MIN_LABEL_WORDS still
      // fits: the prompt never allows fewer, so "cut it to 2 words" is advice
      // the model cannot take (live, plan bd0913b4: it wrote 3 words, still
      // short, and the retry was spent).
      assembled.forEach((step, i) => {
        const needed = readTimeMs(step.label);
        if (step.durationMs >= needed) return;
        const fits = Math.floor(
          ((step.durationMs - LABEL_LEAD_MS) / 1000) * LABEL_WORDS_PER_SECOND,
        );
        const so =
          fits >= MIN_LABEL_WORDS
            ? `so either cut it to ${fits} words or fewer, or`
            : `and no caption of ${MIN_LABEL_WORDS} or more words fits in that, so`;
        const next = assembled[i + 1];
        const cutByNext =
          next !== undefined && step.durationMs === next.timestampMs - step.timestampMs;
        violations.push(
          cutByNext
            ? `the caption on state ${step.sourceIndex} ("${step.label}") is on screen for ${step.durationMs}ms but needs ${needed}ms to be read — its window is cut by the next selected state, ${so} drop one of the two states and let a single caption cover the whole beat`
            : `the caption on state ${step.sourceIndex} ("${step.label}") is on screen for ${step.durationMs}ms but needs ${needed}ms to be read — the app leaves that screen ${step.durationMs}ms after this state (its clipMs), ${so} drop this step, or select an earlier state on the same screen, or a different moment`,
        );
      });
      // The FLOOR needs the same unreachability escape as the minimum count.
      // demos.ts accepts an 8-second recording, and 8 seconds of source cannot
      // make 11 seconds of steps however it is cut — telling the model to add
      // states it does not have burns the retry and fails the plan
      // permanently, with a customer-facing "try again" that never works. The
      // CEILING gets no such escape — a long plan can always drop steps.
      //
      // How much video the best legal selection could possibly assemble. Both
      // cheap approximations of this are wrong, in opposite directions:
      //
      //   wall-clock span  — counts dead air between states as claimable, so
      //     it over-estimates and orders the model to add states that do not
      //     exist, burning the one retry on a permanent failure;
      //   leftmost greedy  — takes every state at the earliest legal moment,
      //     which is maximum CARDINALITY but not maximum COVERAGE. It can
      //     spend its last pick just under MIN_GAP_MS before the final state
      //     and then be barred from it, stranding the very success screen the
      //     plan is required to end on. That under-estimates, and an
      //     under-estimate switches the floor check OFF — a genuinely short
      //     ad then ships with no violation and no retry at all.
      //
      // So compute it exactly. maxSteps is single-digit and a timeline is tens of states,
      // so the obvious O(n^2 * maxSteps) walk is free: best[i][k] is the most
      // coverage a k+1-state selection ending at state i can have, each step
      // worth its own clip or the gap to the next pick, whichever is shorter.
      // Bounded by the ENDING, same argument as the minimum-step walk above:
      // a state after the last success candidate can never be a step, so
      // counting its coverage certifies a floor no ending-compliant plan can
      // reach — the retry is then ordered to add pre-ending states that do
      // not exist and the plan fails permanently. (Real recordings keep
      // rolling after the success moment, so post-ending states are the
      // normal case, not an edge.) When `notes` waives the ending rule the
      // bound under-counts and this escape forgives a little more — the mild
      // direction, exactly as the walk's comment argues.
      //
      // The ending also decides which selection may take the final whole
      // clip: a compliant plan ENDS on a success candidate whenever one
      // exists. With per-state clips, ending on a longer non-success state
      // would out-score every compliant plan and order a retry that cannot
      // succeed.
      //
      // And the pin is not optional: withPin puts it in every plan. Its clip
      // is fixed (nothing selectable sits before dropUntilMs), so the bound is
      // the pin plus the best maxSteps-1 picks after its drop zone. States
      // before the pin are left out — the mild direction again.
      const reachEndsAtMs =
        successCandidates.length > 0
          ? successCandidates[successCandidates.length - 1]!.s.timestampMs
          : Number.POSITIVE_INFINITY;
      const isSuccess = new Set(successCandidates.map(({ i }) => i));
      const canEnd = (index: number): boolean => isSuccess.size === 0 || isSuccess.has(index);
      const sel = timeline
        .map((s, index) => ({ s, index }))
        .filter(
          ({ s, index }) =>
            selectable(index, s) &&
            !inDropZone(index, s) &&
            s.timestampMs <= reachEndsAtMs &&
            (pinned === undefined ||
              (index !== pinned.index && s.timestampMs >= pinned.dropUntilMs)),
        );
      const picks = pinned ? maxSteps - 1 : maxSteps;
      const base = pinned ? pinned.pinMs : 0;
      let reachableMs = pinned ? base : 0;
      const best = sel.map(() => new Array<number>(Math.max(0, picks)).fill(-1));
      for (let i = 0; i < sel.length && picks > 0; i++) {
        best[i]![0] = 0; // a selection of one state: nothing before it yet
        for (let j = 0; j < i; j++) {
          const gap = sel[i]!.s.timestampMs - sel[j]!.s.timestampMs;
          if (gap < MIN_GAP_MS) continue;
          const runs = Math.min(gap, clips[sel[j]!.index]!);
          for (let k = 1; k < picks; k++) {
            const prev = best[j]![k - 1]!;
            if (prev < 0) continue;
            best[i]![k] = Math.max(best[i]![k]!, prev + runs);
          }
        }
        // Whatever the selection, its LAST step has no neighbour to run into
        // and so earns its own whole clip on top — when it may end the plan.
        if (!canEnd(sel[i]!.index)) continue;
        for (const coverage of best[i]!) {
          if (coverage >= 0) {
            reachableMs = Math.max(reachableMs, base + coverage + clips[sel[i]!.index]!);
          }
        }
      }
      // Each step's assembled run rides along: with per-state clips the total
      // is arithmetic the model gets wrong (live, plan bd0913b4: the last
      // retry swapped a 1.2s step for a 4.0s one and landed 600ms over).
      const runs = assembled.map((s) => `state ${s.sourceIndex} runs ${s.durationMs}ms`).join(", ");
      if (total < shape.runtime.minMs && reachableMs >= shape.runtime.minMs) {
        violations.push(
          `the steps total ${total}ms of video (${runs}), under the ${shape.runtime.minMs}-${shape.runtime.maxMs}ms this format needs — it is too SHORT by ${shape.runtime.minMs - total}ms: ADD one or two more distinct product states from BEFORE the ending (adding a step IS the minimal edit this violation asks for), and never add a loading, duplicate or otherwise skipped state`,
        );
      } else if (total > shape.runtime.maxMs) {
        violations.push(
          `the steps total ${total}ms of video (${runs}), over the ${shape.runtime.minMs}-${shape.runtime.maxMs}ms this format needs — it is too LONG by ${total - shape.runtime.maxMs}ms: drop the least essential steps`,
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
  /** Per model call, the violations found AFTER that call — last entry empty
   *  on success, [] under DRY_RUN (no calls). Non-empty last entry on a
   *  returned draft: the last-round repair stored it (decision 0074), and
   *  that entry is what the repair cleared or waived. Persisted on the plan
   *  row so the per-rule fix rate is measurable (0029). Shape rules only
   *  since 0049: label provenance never drives a round, it lands on each
   *  step's offScreenWords instead. */
  retryViolations: string[][];
}

/** The customer-facing Hebrew for a validator failure, classified from the
 *  FINAL round's violations. Deliberately the whole scope — no per-violation
 *  translation layer: the one class a customer can act on gets an actionable
 *  line, everything else keeps the generic one. (The "add a short description"
 *  line for label provenance went with the gate in 0049 — provenance can no
 *  longer be a final-round violation.) */
function violationCustomerMessage(finalRound: string[]): string {
  if (finalRound.some((v) => v.includes("screens are never steps"))) {
    return "התוכנית כללה מסכי טעינה או התחברות שלא נכנסים למודעה — נסו שוב, ואם זה חוזר צלמו קטע שמתמקד בשימוש במוצר עצמו.";
  }
  return "יצירת תוכנית הצעדים נכשלה — נסו שוב";
}

/**
 * A model plan that still violates after every corrective call and that the
 * last-round repair could not store (decision 0074). Carries what the
 * diagnostics columns need — the prompt version that failed and every
 * round's violations — because the throw is the only channel between
 * generateStepPlan and the handler that writes the row.
 */
export class PlanViolationError extends PermanentError {
  readonly promptVersion: string;
  readonly rounds: string[][];

  constructor(opts: { promptVersion: string; rounds: string[][] }) {
    const final = opts.rounds[opts.rounds.length - 1] ?? [];
    super(`plan violates label rules after retry: ${final.join("; ")}`, {
      customerMessage: violationCustomerMessage(final),
      failKind: "validator",
    });
    this.promptVersion = opts.promptVersion;
    this.rounds = opts.rounds;
  }
}

export interface StepDurationConfig {
  /** The cap on one step's clip. */
  maxMs: number;
  /** One analysis sample — where a screen's cut sits past its last state. */
  sampleMs: number;
}

/** Exported for the test that pins the defaults: with no app_config rows the
 *  code constants ARE the configuration, and nothing else observes them. The
 *  sample comes from the analysis's own fps knob, floored so the cut never
 *  passes the next sample on the round(i*1000/fps) grid. */
export async function stepDurations(db: Db): Promise<StepDurationConfig> {
  const sampleMs = Math.max(1, Math.floor(1000 / (await analysisFps(db))));
  return {
    // A cap under one sample would leave a clip with no frame.
    maxMs: Math.max(sampleMs, await getConfigValueOr(db, "a_step_ms_max", z.number(), MAX_STEP_MS)),
    sampleMs,
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
 * A step shows one screen (decision 0070): its clip starts at the picked
 * state and ends when the app leaves that screen, at the cap, or at the
 * recording's end, whichever comes first (timelineClipMs) — and never past
 * the next selected state, or 200ms of source would play twice back to back
 * (real: fixtures/timelines/real-botteacher-file-routing.json, proven in
 * pixels). Nothing pads a step: no floor, whatever its caption needs — a
 * caption longer than its screen is the validator's and the wizard's warning,
 * never a longer clip (0072).
 *
 * Two selections closer than MIN_GAP_MS are a violation on the model path
 * (findPlanViolations, which has a retry channel to fix them) but a
 * legitimate edit on the human path: updatePlanSteps has no violation
 * channel, and the founder's call is that the customer's pick is honoured. A
 * short clip is an honest render of what they selected. So a 400ms gap renders
 * a 400ms clip.
 */
export function assembleSteps(
  selected: { sourceIndex: number; label: string }[],
  timeline: AnalysisState[],
  bounds: ClipBounds,
): PlanStep[] {
  const clips = timelineClipMs(timeline, bounds);
  const ordered = selected
    .map(({ sourceIndex, label }) => ({
      timestampMs: timeline[sourceIndex]!.timestampMs,
      actionType: timeline[sourceIndex]!.actionType,
      label: label.trim(),
      sourceIndex,
    }))
    .sort((a, b) => a.timestampMs - b.timestampMs);

  return ordered.map((step, i) => {
    const next = ordered[i + 1];
    const room = next ? next.timestampMs - step.timestampMs : Number.POSITIVE_INFINITY;
    return { ...step, durationMs: Math.min(clips[step.sourceIndex]!, room) };
  });
}

/** The fewest steps the last-round repair may store, the pin counted: one or
 *  two steps is a failure shown as a ready plan (founder, decision 0074). */
const REPAIR_MIN_STEPS = 3;

/**
 * What code does to a model plan that still violates after the last
 * corrective call, instead of failing it (decision 0074): drop the steps
 * whose caption cannot be read in their clip, then bring a total over the
 * band's ceiling under it by dropping steps. Returns the kept selection in
 * chronological order — the caller decides whether it may be stored — or
 * null when the plan is not one to repair: an index is outside the timeline
 * or picked twice, which no drop rule here speaks to, or the caption that
 * cannot be read is the ending's.
 *
 * The ending is the last selected result state. Neither pass drops it: a
 * plan that loses its success screen is not a draft worth storing, whatever
 * `notes` says about the ending rule, so an unreadable ending fails the plan
 * as it always did (founder, decision 0074).
 *
 * Dropping a step never shortens another step, never lengthens the total and
 * never brings two picks closer (a clip only ever gains the room its dropped
 * neighbour held), so each pass is final:
 *
 * Read time — last step to first. A step's clip depends only on the next
 * step still kept, so by the time a step is judged its clip is settled; a
 * later drop can rescue an earlier step, never the reverse. A last step that
 * is not a result state gets no protection here: what cannot be read is
 * dropped, and the step before it becomes the last.
 *
 * Trim — while the total is over `maxMs`: when dropping one step is enough,
 * the one that leaves the longest ad goes; otherwise the one that shortens it
 * most, and look again. Ties go to the earlier step. Never the pin, the last
 * step or the ending: the way in and the way out are what the format cannot
 * lose. Every total is re-assembled, never subtracted — a dropped step's
 * time is often absorbed by the step before it on the same screen.
 */
export function repairPlanSteps(
  steps: { sourceIndex: number; label: string }[],
  timeline: AnalysisState[],
  bounds: ClipBounds,
  opts: { maxMs: number; pinnedIndex?: number },
): { sourceIndex: number; label: string }[] | null {
  const seen = new Set<number>();
  for (const { sourceIndex } of steps) {
    if (!Number.isInteger(sourceIndex) || !timeline[sourceIndex] || seen.has(sourceIndex)) {
      return null;
    }
    seen.add(sourceIndex);
  }
  let kept = [...steps].sort(
    (a, b) => timeline[a.sourceIndex]!.timestampMs - timeline[b.sourceIndex]!.timestampMs,
  );

  const ending = [...kept].reverse().find((s) => timeline[s.sourceIndex]!.actionType === "result");

  for (let i = kept.length - 1; i >= 0; i--) {
    const step = assembleSteps(kept, timeline, bounds)[i]!;
    if (step.durationMs >= readTimeMs(step.label)) continue;
    if (kept[i] === ending) return null;
    kept = kept.filter((_, k) => k !== i);
  }

  const totalOf = (plan: typeof kept): number =>
    totalRuntimeMs(assembleSteps(plan, timeline, bounds));
  while (totalOf(kept) > opts.maxMs) {
    const options = kept
      .filter((s, i) => s.sourceIndex !== opts.pinnedIndex && i !== kept.length - 1 && s !== ending)
      .map((dropped) => ({ dropped, leftMs: totalOf(kept.filter((s) => s !== dropped)) }));
    if (options.length === 0) break;
    const enough = options.filter((o) => o.leftMs <= opts.maxMs);
    // Strict comparisons over a chronological list: the earlier step wins a tie.
    const { dropped } =
      enough.length > 0
        ? enough.reduce((a, b) => (b.leftMs > a.leftMs ? b : a))
        : options.reduce((a, b) => (b.leftMs < a.leftMs ? b : a));
    kept = kept.filter((s) => s !== dropped);
  }
  return kept;
}

/**
 * The timeline as the model is shown it (decision 0074): every state whose
 * own clip can carry a caption, plus the pinned access state — its caption
 * needs less than the shortest model caption, and the access notice names
 * it. A moment that cannot carry a caption is never offered, so entries keep
 * their absolute `index` (the sourceIndex the plan speaks) and the indexes
 * skip. `clipMs` (v15+) is how long a step started there runs before its
 * screen changes.
 */
export function planPromptTimeline(
  timeline: AnalysisState[],
  clips: number[],
  pinnedIndex?: number,
) {
  return timeline
    .map((s, index) => ({
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
      clipMs: clips[index]!,
    }))
    .filter((entry) => entry.index === pinnedIndex || captionableClip(entry.clipMs));
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
  /** Every state's own clip (timelineClipMs). A state too short to caption is
   *  not selectable on the model path, so the canned plan skips it too. */
  clips: number[],
  /** States the canned plan may not select — the pinned access step and its
   *  drop zone, which withPin prepends and removes. Filtered ONCE, here, so
   *  the ending lookup below cannot reach back into the zone either. */
  exclude?: (index: number, state: AnalysisState) => boolean,
): PlanOutput {
  const indexed = timeline
    .map((state, index) => ({ state, index }))
    .filter(({ state, index }) => !exclude?.(index, state) && captionableClip(clips[index]!));
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
  const results = indexed.filter(
    ({ state }) =>
      state.actionType === "result" && state.legibility !== "unreadable" && !isSkippedKind(state),
  );
  const lastResult = results[results.length - 1];

  // Thin to the cap keeping the ending, then respect the min-gap rule.
  // subsampleClusters always keeps its last element and lastResult is appended
  // straight after it, so (final candidate, success screen) is exactly the pair
  // a real recording is most likely to have under the min gap — leaving it
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
      if (!next || next.state.timestampMs - kept[i]!.state.timestampMs >= MIN_GAP_MS) {
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
  // BACKWARDS from the ending taking every state that clears the min gap.
  // On a line that greedy is optimal, and it is the same walk the
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
      if (out[out.length - 1]!.state.timestampMs - c.state.timestampMs >= MIN_GAP_MS) out.push(c);
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
    label: (
      state.visibleText.map((t) => t.replace(/!/g, "").trim()).find(Boolean) ??
      questionnaire.product_name
    )
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

/** Corrective calls after the first: 3 model calls total, ever — the hard cap
 *  CLAUDE.md's no-uncapped-spend rule asks for. One was not enough: 15/15
 *  first calls violate (docs/vault/facts/first-call-violation-rate.md — the
 *  corrective call IS the mechanism), so a second-round miss was a permanent
 *  failure on a path that is demonstrably nondeterministic. */
const MAX_CORRECTIVE_CALLS = 2;

/**
 * Run pass 2 over one timeline: prompt -> zod-validated selection ->
 * deterministic violation check -> up to MAX_CORRECTIVE_CALLS corrective
 * re-requests naming the violations -> the last-round repair -> fail only
 * when even the repaired plan cannot be stored (decision 0074). Used by the
 * job handler and by `aiugc plan regress` (which is why it takes data, not
 * row ids).
 */
export async function generateStepPlan(
  db: Db,
  opts: {
    timeline: AnalysisState[];
    questionnaire: Questionnaire;
    /** demos.description — reaches the prompt AND the label-word vocabulary. */
    demoDescription?: string | null;
    /** demos.duration_ms — the last step's ceiling; null/absent falls back to
     *  one sample past the last state (recordingEndMs). */
    recordingMs?: number | null;
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
  const bounds = clipBounds(await stepDurations(db), opts.timeline, opts.recordingMs);
  const runtime = await stepRuntimeBand(db);
  const clips = timelineClipMs(opts.timeline, bounds);

  // The access moment, pinned as step 1 on both branches (see ACCESS_LABEL).
  // The model or the canned planner fills the plan AROUND it: one step and
  // its clip are already spoken for, so the counts and the band they see are
  // reduced by exactly what the pin takes, while findPlanViolations checks
  // the COMBINED plan against the full ones — consistent by construction.
  // The prompt file is the shipped version; the pinned rendering is marked on
  // the stored version so pinned plans are distinguishable in the row.
  const access = findAccessMoment(opts.timeline, {
    bounds,
    link: opts.questionnaire.link,
  });
  const pinned = access ?? undefined;
  const modelMin = access ? Math.max(1, minSteps - 1) : minSteps;
  const modelMax = access ? Math.max(modelMin, maxSteps - 1) : maxSteps;
  const markVersion = (version: string): string => (access ? `${version}+access-pin` : version);

  if (getEnv().DRY_RUN) {
    const canned = dryRunPlan(
      opts.timeline,
      opts.questionnaire,
      modelMin,
      modelMax,
      clips,
      access
        ? (index, state) =>
            index === access.index ||
            (state.timestampMs >= access.runStartMs && state.timestampMs < access.dropUntilMs)
        : undefined,
    );
    const steps = withPin(canned.steps, opts.timeline, access);
    // The canned plan goes through the same enforcement as a real one, so the
    // whole validation path runs keyless; a violation here is a code bug.
    //
    // Minus the runtime band, deliberately. The canned labels are the first
    // line of OCR off each screen, so their read-time — and therefore the
    // assembled total — measures the recording's own text, not anything a
    // writer chose. Holding a mechanical stub to a band that exists to size
    // AUTHORED Hebrew would mean tuning the stub, not the format. The band is
    // unit-tested directly and enforced on every model plan.
    const violations = findPlanViolations(steps, opts.timeline, maxSteps, {
      minSteps,
      notes: canned.notes,
      bounds,
      pinned,
    });
    if (violations.length > 0) {
      throw new Error(`dry-run plan violates its own rules: ${violations.join("; ")}`);
    }
    return {
      // The highlight rides along so the keyless shape matches live.
      steps: withOffScreenWords(
        assembleSteps(steps, opts.timeline, bounds),
        opts.timeline,
        opts.questionnaire,
        opts.demoDescription,
        access?.index,
      ),
      unexplainedMoments: canned.unexplainedMoments,
      notes: canned.notes,
      promptVersion: markVersion("plan_demo_steps@dry-run"),
      retryViolations: [],
    };
  }

  // The band the model is asked to fill on its own — the full band minus the
  // pin's clip, which the combined plan then has to total inside.
  const modelRuntime = access
    ? {
        minMs: Math.max(0, runtime.minMs - access.pinMs),
        maxMs: Math.max(0, runtime.maxMs - access.pinMs),
      }
    : runtime;

  const rendered = renderPrompt("plan_demo_steps", {
    questionnaire: JSON.stringify(opts.questionnaire, null, 2),
    timeline: JSON.stringify(planPromptTimeline(opts.timeline, clips, access?.index), null, 2),
    min: modelMin,
    max: modelMax,
    // v11+. Older prompt files never reference {{timing}} and are unaffected —
    // renderPrompt only substitutes what the template asks for.
    timing: planTimingMarkdown({
      maxMs: bounds.maxMs,
      runtime: modelRuntime,
      minSteps: modelMin,
      maxSteps: modelMax,
    }),
    // v13+, same one-way compatibility as {{timing}}. The sentinel mirrors
    // the vo_script pattern (copy.ts): the template always has SOMETHING to
    // say where the description would go.
    demo_description: opts.demoDescription?.trim() || "(אין — התבסס על השאלון והמסכים בלבד)",
  });
  // No access moment: the prompt file verbatim. A pin: the notice under it,
  // stamped "+access-pin". Every model plan is stamped "+pickable" first: the
  // timeline it was given holds only pickable moments, and rows from before
  // that (bare "@v15") were given every state — the boundary is on the row
  // (founder, decision 0074).
  const text = access
    ? `${rendered.text}\n\n${accessNotice(access, opts.timeline, modelMin, modelMax)}`
    : rendered.text;
  const promptVersion = markVersion(`${rendered.promptVersion}+pickable`);

  // A BudgetError from a later call parks the JOB, and the resume re-runs
  // the first call. That re-pay is self-limiting — it only occurs when the
  // rolling window freed enough for the earlier calls but not the next, and
  // every cycle spends toward the same cap that parks it — a bounded cost,
  // not a loop.
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

  // A model pick of a state it was never offered — its own clip cannot carry
  // a caption (decision 0074). Stripped in every round, whatever the model
  // returns, the way withPin strips the drop zone. Indexes outside the
  // timeline pass through for the validator to name.
  const isHiddenPick = (step: { sourceIndex: number }): boolean =>
    Number.isInteger(step.sourceIndex) &&
    opts.timeline[step.sourceIndex] !== undefined &&
    step.sourceIndex !== access?.index &&
    !captionableClip(clips[step.sourceIndex]!);
  // The pin first, then the model's own steps after withPin has removed
  // anything that duplicates or crowds it.
  const pinnedPlan = (output: PlanOutput): { sourceIndex: number; label: string }[] =>
    withPin(output.steps, opts.timeline, access);
  // Every check runs on the COMBINED plan: the pinned plan minus the picks the
  // model was never offered.
  const combined = (output: PlanOutput): { sourceIndex: number; label: string }[] =>
    pinnedPlan(output).filter((step) => !isHiddenPick(step));
  const validate = (output: PlanOutput): string[] =>
    findPlanViolations(combined(output), opts.timeline, maxSteps, {
      minSteps,
      notes: output.notes,
      bounds,
      runtime,
      pinned,
    });

  // "Minimal edits" matters: a from-scratch replan routinely fixes the named
  // violations while introducing brand-new ones (seen live: the retry swapped
  // in a fresh 5-word label). The previous plan is echoed back because each
  // call is stateless — without it the model cannot see the plan it is told
  // to minimally edit and reinvents it (seen live on a179f069: the retry
  // dropped the success state the first call had correctly selected). The
  // echo is the combined plan, pin first, so "step i" in a violation string
  // points at the same row the model is looking at.
  const correctivePrompt = (previous: PlanOutput, violations: string[]): string =>
    `${text}\n\nYour previous plan was:\n${JSON.stringify({ ...previous, steps: combined(previous) }, null, 2)}\n\nIt violated these rules:\n${violations
      .map((v) => `- ${v}`)
      .join(
        "\n",
      )}\n\nReturn the same plan with the minimal edits that fix every violation named above. Keep every step and label the violations above do not implicate unchanged, and keep every label at 6 words maximum.`;

  let output = await callOnce(text);
  let violations = validate(output);
  const rounds: string[][] = [violations];
  for (
    let corrective = 0;
    violations.length > 0 && corrective < MAX_CORRECTIVE_CALLS;
    corrective++
  ) {
    output = await callOnce(correctivePrompt(output, violations));
    violations = validate(output);
    rounds.push(violations);
  }
  let steps = combined(output);
  // "+repaired" marks a stored plan that is not the model's last answer as
  // given: a pick was stripped from it, or the repair below stored it. A pick
  // inside the pin's drop zone is not one — withPin has always removed those.
  let repaired = pinnedPlan(output).some(isHiddenPick);
  if (violations.length > 0) {
    // The last call is spent. Drop what dropping fixes, then hold the plan to
    // the model's rules minus the two a short draft is forgiven — the runtime
    // floor and the minimum step count (decision 0074: a short draft the
    // customer can extend beats a failure). Anything else still violating,
    // an unreadable ending, or fewer than REPAIR_MIN_STEPS left, fails
    // exactly as it always did.
    const fixed = repairPlanSteps(steps, opts.timeline, bounds, {
      maxMs: runtime.maxMs,
      pinnedIndex: access?.index,
    });
    if (
      fixed === null ||
      fixed.length < REPAIR_MIN_STEPS ||
      findPlanViolations(fixed, opts.timeline, maxSteps, {
        minSteps: 1,
        notes: output.notes,
        bounds,
        runtime: { minMs: 0, maxMs: runtime.maxMs },
        pinned,
      }).length > 0
    ) {
      throw new PlanViolationError({ promptVersion, rounds });
    }
    steps = fixed;
    repaired = true;
  }

  return {
    // The provenance highlight, computed once on the accepted plan (0049).
    steps: withOffScreenWords(
      assembleSteps(steps, opts.timeline, bounds),
      opts.timeline,
      opts.questionnaire,
      opts.demoDescription,
      access?.index,
    ),
    unexplainedMoments: output.unexplainedMoments,
    notes: output.notes,
    promptVersion: repaired ? `${promptVersion}+repaired` : promptVersion,
    retryViolations: rounds,
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
 * web route MUST gate this behind assertAccountBudget — each request is 1-3
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
  if (!plan) throw new PermanentError(`step plan ${planId} not found`, { failKind: "internal" });
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
        failKind: "input",
      });
    }
    const demoRows = await ctx.db.select().from(demos).where(eq(demos.id, plan.demoId)).limit(1);
    const demo = demoRows[0];
    if (!demo) throw new PermanentError(`demo ${plan.demoId} not found`, { failKind: "internal" });
    const questionnaire = await requireQuestionnaire(ctx.db, demo.businessId).catch((err) => {
      throw new PermanentError(err instanceof Error ? err.message : String(err), {
        customerMessage: "מלאו את שאלון העסק לפני יצירת התוכנית",
        failKind: "input",
      });
    });

    // The confirm-to-execution window (renders.ts precedent): the route's
    // budget gate reads usage that lags the queue, so a queued backlog would
    // outrun it. Re-check here and fail fast — never park on an account cap.
    await assertAccountBudget(ctx.db, "llm_tokens", demo.businessId).catch((err) => {
      if (err instanceof AccountBudgetError) {
        throw new PermanentError(err.message, {
          customerMessage: "הגעתם למכסת יצירת התוכן היומית של החשבון — נסו שוב מחר.",
          failKind: "quota",
        });
      }
      throw err;
    });

    await setPlan({ status: "planning" });

    const timeline = analysisTimelineSchema.parse(analysis.timeline);
    const draft = await generateStepPlan(ctx.db, {
      timeline,
      questionnaire,
      demoDescription: demo.description,
      recordingMs: demo.durationMs,
      businessId: demo.businessId,
      jobId: job.id,
    });

    await setPlan({
      status: "ready",
      steps: draft.steps,
      unexplainedMoments: draft.unexplainedMoments,
      notes: draft.notes,
      promptVersion: draft.promptVersion,
      retryViolations: draft.retryViolations,
      failReason: null,
      failKind: null,
    });
    return { kind: "done" };
  } catch (err) {
    if (err instanceof PermanentError) {
      await setPlan({
        status: "failed",
        failReason: err.customerMessage ?? err.message,
        failKind: err.failKind ?? "internal",
        // The version and the per-round violations are in hand only on the
        // validator path — everything else fails before a prompt is rendered.
        ...(err instanceof PlanViolationError
          ? { promptVersion: err.promptVersion, retryViolations: err.rounds }
          : {}),
      });
    } else if (!(err instanceof BudgetError) && isLastAttempt(job)) {
      await setPlan({
        status: "failed",
        failReason: "יצירת התוכנית נכשלה — נסו שוב",
        failKind: "transient",
      });
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
 * of the format, not a client convention. Labels are NOT run through
 * findOffScreenWords — the highlight is for the model's words. A step whose
 * label the customer CHANGED stores offScreenWords: [] (the words are theirs
 * now); a step whose label is still the model's keeps the marks the stored
 * row carries, because approve is disabled while the draft is dirty, so every
 * edit — or a delete, or an added step — forces a save before approval, and a
 * save that wiped every mark would take the highlight away from the labels
 * the customer never touched. An added step has no stored marks and gets [].
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
  // The recording's length is the last step's ceiling — the same row the
  // generation path reads, so an edit can never lengthen a step past it.
  const demoRows = await db
    .select({ durationMs: demos.durationMs })
    .from(demos)
    .where(eq(demos.id, plan.demoId))
    .limit(1);

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
      throw new Error(
        `sourceIndex ${step.sourceIndex} is an unreadable state — it cannot be shown`,
      );
    }
    if (!step.label.trim()) throw new Error(`step ${step.sourceIndex} has an empty label`);
    if (step.label.length > MAX_LABEL_CHARS) {
      throw new Error(`step ${step.sourceIndex} label is over ${MAX_LABEL_CHARS} characters`);
    }
  }

  // The stored row's marks, by sourceIndex — carried only onto a step whose
  // label is unchanged (trimmed, as assembleSteps stores it). A row from
  // before 0049, or one whose steps fail to parse, carries none.
  const stored = planStepsSchema.safeParse(plan.steps);
  const storedBySource = new Map(
    (stored.success ? stored.data : []).map((step) => [step.sourceIndex, step]),
  );
  const bounds = clipBounds(await stepDurations(db), timeline, demoRows[0]?.durationMs);
  const steps = assembleSteps(opts.steps, timeline, bounds).map((step) => {
    const before = storedBySource.get(step.sourceIndex);
    const unchanged = before !== undefined && before.label.trim() === step.label;
    return { ...step, offScreenWords: unchanged ? (before.offScreenWords ?? []) : [] };
  });

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
  // demos.description as the live path would carry it — absent on every
  // pre-0029 fixture, which is exactly the no-description case.
  demoDescription: z.string().optional(),
  // demos.duration_ms of the recording, when known — the last step's
  // ceiling; absent falls back to one sample past the last state.
  recordingMs: z.number().optional(),
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
  /** Set when the plan printed is not the model's own answer — the last-round
   *  repair stored it or a hidden pick was stripped (decision 0074): the
   *  violations the model's last call left, [] for a strip alone. */
  repaired?: string[];
}

/**
 * Re-run pass 2 over every saved fixture and diff the selection. Green/red is
 * the sourceIndex SET (labels vary run to run and are printed for eyeballing,
 * never asserted). Runs against fixture data directly — no rows are written.
 * A repaired plan is never green: the regress measures the model's answer,
 * and before the repair existed such a run failed outright.
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
        demoDescription: fixture.demoDescription,
        recordingMs: fixture.recordingMs,
      });
      const actual = draft.steps.map((s) => s.sourceIndex).sort((a, b) => a - b);
      const setMatch = JSON.stringify(actual) === JSON.stringify(expected);
      const explained =
        (fixture.expected.allowNotes ?? false) && draft.steps.length > 0 && !!draft.notes?.trim();
      const repaired = draft.promptVersion.endsWith("+repaired");
      results.push({
        fixture: file,
        pass: (setMatch || explained) && !repaired,
        expected,
        actual,
        steps: draft.steps.map((s) => ({ sourceIndex: s.sourceIndex, label: s.label })),
        notes: draft.notes,
        ...(repaired
          ? { repaired: draft.retryViolations[draft.retryViolations.length - 1] ?? [] }
          : {}),
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

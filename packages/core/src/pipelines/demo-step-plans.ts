import { and, desc, eq, isNull } from "drizzle-orm";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getConfigValueOr } from "../appConfig";
import { AccountBudgetError, assertAccountBudget, assertBudget, recordUsage } from "../budget";
import { getEnv } from "../config";
import type { Db } from "../db";
import { demoAnalyses, demoAnalysisFootage, demoStepPlans, demos, jobs } from "../db/schema";
import { BudgetError, PermanentError } from "../jobs/errors";
import { enqueue, isLastAttempt, type Job } from "../jobs/queue";
import type { JobContext, JobResult } from "../jobs/worker";
import { FIXTURES_DIR } from "../paths";
import {
  A_STEPS_MAX_DEFAULT,
  A_STEPS_MIN_DEFAULT,
  clipsOverlap,
  DEMO_FPS,
  demoFrame,
  MAX_LABEL_CHARS,
  MAX_LABEL_WORDS,
  MIN_LABEL_WORDS,
  normalizeWord,
  overlappingPairs,
  PLAN_SKIP_SCREEN_KINDS,
  readTimeMs,
  splitWords,
  STEP_MS,
  stepClip,
  tokenizeWords,
  totalRuntimeMs,
  type Clip,
} from "../plan-format";
import { llmCostAgorot } from "../pricing";
import { generateObject } from "../providers/anthropic";
import { renderPrompt } from "../prompts";
import { DETECTOR_REACH_FRAMES, SCREENS_DETECTOR } from "./analysis-screens";
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
  STEP_MS,
  stepClip,
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
  /** Where the step's clip starts in the demo (decision 0084) — its moment or
   *  up to a little before it. Absent on every step stored before steps had
   *  clips: those start at timestampMs (plan-format's stepClip is the one
   *  reading of both shapes). */
  startMs: z.number().optional(),
  /** Set when the clip probably shows two different pages (placeClips); the
   *  editor then asks the customer to watch the step (decision 0085). */
  twoPages: z.boolean().optional(),
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
 *  (timestamp/actionType from the timeline, the clip from placeClips), so the
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

// STEP_MS / MAX_LABEL_WORDS / MIN_LABEL_WORDS live in ../plan-format (imported
// above): the wizard's soft word warning needs them, and this module's db/fs/
// provider imports can't reach a browser bundle.

/** readTimeMs by word count. The prompt's timing block and the word ceiling
 *  read the same function — which is the whole point of generating the block. */
function readTimeMsForWords(words: number): number {
  return readTimeMs("x ".repeat(words));
}

/**
 * Every number in the prompt's timing section, GENERATED from readTimeMs and
 * the step constants instead of restated by hand in the markdown.
 *
 * v10 hand-wrote the same table and its first row drifted: it licensed a
 * 3-word caption at a 1.4s gap when readTimeMs asks 1.6s, so the prompt
 * authorised plans findPlanViolations then rejected. A table that can disagree
 * with the function is the bug, so the table comes from the function.
 *
 * Arithmetic only, no prose: WHY the rules are what they are lives in the
 * versioned prompt file, where a change to it bumps the prompt version.
 */
export function planTimingMarkdown(opts: { minSteps: number; maxSteps: number }): string {
  const { minSteps, maxSteps } = opts;
  const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  const readRows: string[] = [];
  for (let words = MIN_LABEL_WORDS; words <= MAX_LABEL_WORDS; words++) {
    readRows.push(`| ${words} words | ${secs(readTimeMsForWords(words))} |`);
  }

  return [
    "| caption | seconds it needs |",
    "| ------- | ---------------- |",
    ...readRows,
    "",
    `Every step runs exactly ${secs(STEP_MS)}: its clip. Every timeline entry carries \`clipStartMs\`, where the clip of a step selected there starts (at the entry's own timestamp, or a little before it); \`calm\`, true when nothing in the picture changes during that clip; and \`twoPages\`, true when the clip probably shows two different pages.`,
    "",
    `Two selected states may never show the same footage: their \`clipStartMs\` values must be at least ${STEP_MS} apart.`,
    "",
    `A plan runs its step count times ${secs(STEP_MS)}: ${minSteps} steps run ${secs(minSteps * STEP_MS)}, ${maxSteps} steps run ${secs(maxSteps * STEP_MS)}.`,
  ].join("\n");
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
// Pages — the analysis's own judgement of where one page gives way to another
// (decision 0070). Since 0084 it ranks clips and bounds the access run; it no
// longer cuts a step.
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

/** One analysis sample in ms, from the analysis's own fps knob — floored so it
 *  never passes the next sample on the round(i*1000/fps) grid, and never zero. */
export async function analysisSampleMs(db: Db): Promise<number> {
  return Math.max(1, Math.floor(1000 / (await analysisFps(db))));
}

/** What a clip is placed against besides the moments themselves. */
export interface ClipContext {
  /** One analysis sample: a moment's picture is still up this long after its
   *  timestamp (a stored timestampMs is the lower median of a cluster of at
   *  least two samples). */
  sampleMs: number;
  recordingEndMs: number;
  /** Every instant the picture changes, in ms (demo_analysis_footage.instants).
   *  null = not known for this analysis. */
  instants: number[] | null;
}

/**
 * For every state, when the analysis's own screen ends: one sample after the
 * last state still on it, or the recording's end. Since every step became a
 * fixed 2 s clip (decisions 0076, 0084) no clip is cut here — only the access
 * moment's run still reads it, to tell one typing of the address from the
 * next.
 */
export function screenEnds(
  timeline: AnalysisState[],
  bounds: Pick<ClipContext, "sampleMs" | "recordingEndMs">,
): number[] {
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

// ---------------------------------------------------------------------------
// Clips — every moment's 2 s (decisions 0076, 0084)
// ---------------------------------------------------------------------------

/** Clips are placed in frames of the normalized demo, never in ms: the render
 *  lays a step out as round(end·fps) − round(start·fps) frames, which is
 *  exactly STEP_FRAMES only when the start sits on the frame grid. */
const STEP_FRAMES = (STEP_MS * DEMO_FPS) / 1000;
const toFrame = demoFrame;
const frameMs = (frame: number): number => Math.round((frame * 1000) / DEMO_FPS);

/** How far a clip keeps from an instant to count as calm: 0.2 s. Measured, the
 *  picture really flips between 4 frames before its instant and 5 after
 *  (docs/vault/facts/instant-free-windows-2026-10-02.md). An instant exactly
 *  this far outside the clip is clear of it. */
const INSTANT_CLEAR_FRAMES = 6;

/** One moment's clip: STEP_MS of the demo, starting at startMs. */
export interface PlacedClip {
  startMs: number;
  /** Nothing changes in the picture during the clip, as far as the footage
   *  detector can tell. A generated plan prefers these. */
  calm: boolean;
  /** The clip probably shows two different pages: it crosses a change the
   *  analysis itself also saw. The editor asks the customer to watch such a
   *  step before approving (decision 0085). */
  twoPages: boolean;
}

/** Lexicographic "a before b" over equal-length numeric keys. */
function keyBefore(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i]! < b[i]!;
  }
  return false;
}

/**
 * Every moment's clip (decision 0084). One function, read by the inventory,
 * the plan job, a hand-added step and — through what they store — the render,
 * so the clip previewed is the clip rendered.
 *
 * A clip is STEP_MS long, holds its moment, and starts at the moment or up to
 * STEP_MS less one analysis sample before it, never outside the recording
 * (the recording wins a conflict). Among those starts:
 *
 * 1. Calm — no instant inside the clip or within INSTANT_CLEAR_FRAMES of
 *    either end, and the clip clear of the recording's first and last
 *    DETECTOR_REACH_FRAMES, where the detector cannot place an instant. If a
 *    calm start exists, the one closest to the moment is used.
 * 2. Otherwise the best-fitting start: the fewest instants at which the
 *    analysis itself also saw a different page (isNewScreen between the two
 *    moments either side of the instant; an instant before the first moment
 *    or after the last counts as one); then the moment's own picture on
 *    screen the longest — the stretch between the instants either side of it,
 *    every instant treated as a change (decision 0079); then the least slide.
 * 3. No instants known: nothing is calm and the clip starts at the moment.
 *
 * No model is asked anything here and no clip is ever shortened. Measured on
 * the five takes: docs/vault/facts/clip-placement-replay-2026-10-02.md.
 */
export function placeClips(timeline: AnalysisState[], ctx: ClipContext): PlacedClip[] {
  const endFrame = Math.floor((ctx.recordingEndMs * DEMO_FPS) / 1000);
  const lastStart = Math.max(0, endFrame - STEP_FRAMES);
  const lead = Math.max(0, STEP_FRAMES - Math.ceil((ctx.sampleMs * DEMO_FPS) / 1000));
  // The last frame not after the moment — rounding to the nearest would start
  // a clip after its moment when the analysis fps does not divide DEMO_FPS.
  // The half millisecond absorbs the analysis's own rounding of a timestamp.
  const moments = timeline.map((state) =>
    Math.floor(((state.timestampMs + 0.5) * DEMO_FPS) / 1000),
  );
  const pageChange = timeline.map((state, i) => i > 0 && isNewScreen(timeline[i - 1]!, state));

  if (ctx.instants === null) {
    return timeline.map((_, i) => {
      const startMs = frameMs(Math.min(moments[i]!, lastStart));
      // The analysis alone: a later moment inside the clip that it put on a
      // different page.
      const twoPages = timeline.some(
        (later, k) =>
          pageChange[k]! && later.timestampMs > startMs && later.timestampMs < startMs + STEP_MS,
      );
      return { startMs, calm: false, twoPages };
    });
  }

  const instants = [...new Set(ctx.instants.map(toFrame))].sort((a, b) => a - b);
  /** Whether the analysis saw a different page across each instant: the pair
   *  of moments with moment[k-1] < instant <= moment[k]. */
  const confirmed = instants.map((instant) => {
    const k = moments.findIndex((moment) => moment >= instant);
    return k <= 0 ? true : pageChange[k]!;
  });

  return timeline.map((_, i) => {
    const at = moments[i]!;
    const latest = Math.min(at, lastStart);
    const earliest = Math.min(Math.max(0, at - lead), latest);
    let before = Number.NEGATIVE_INFINITY;
    let after = Number.POSITIVE_INFINITY;
    for (const instant of instants) {
      if (instant <= at) before = instant;
      else {
        after = instant;
        break;
      }
    }

    let best: { start: number; key: number[]; twoPages: boolean } | undefined;
    for (let start = latest; start >= earliest; start--) {
      let near = 0;
      let confirmedNear = 0;
      for (let n = 0; n < instants.length; n++) {
        const instant = instants[n]!;
        if (instant <= start - INSTANT_CLEAR_FRAMES) continue;
        if (instant >= start + STEP_FRAMES + INSTANT_CLEAR_FRAMES) break;
        near++;
        if (confirmed[n]) confirmedNear++;
      }
      if (
        near === 0 &&
        start >= DETECTOR_REACH_FRAMES &&
        start + STEP_FRAMES <= endFrame - DETECTOR_REACH_FRAMES
      ) {
        return { startMs: frameMs(start), calm: true, twoPages: false };
      }
      const own = Math.max(0, Math.min(start + STEP_FRAMES, after) - Math.max(start, before));
      const key = [confirmedNear, -own, at - start];
      if (!best || keyBefore(key, best.key)) best = { start, key, twoPages: confirmedNear > 0 };
    }
    return { startMs: frameMs(best!.start), calm: false, twoPages: best!.twoPages };
  });
}

/** A moment's clip as plan-format's Clip, for the overlap helpers. */
const clipOf = (placed: PlacedClip): Clip => ({ startMs: placed.startMs, durationMs: STEP_MS });

/**
 * An analysis's stored instants in ms, or null when they are not known: no
 * footage row (analyses from before 0050 until they are backfilled), a decode
 * that failed, a detector this code was not measured against, or a shape that
 * does not parse. Null is a normal answer, never an error — placeClips then
 * calls nothing calm. A database error throws, as any read does.
 */
export async function analysisInstants(db: Db, analysisId: string): Promise<number[] | null> {
  const rows = await db
    .select({ detector: demoAnalysisFootage.detector, instants: demoAnalysisFootage.instants })
    .from(demoAnalysisFootage)
    .where(eq(demoAnalysisFootage.analysisId, analysisId))
    .limit(1);
  const row = rows[0];
  if (!row || row.detector !== SCREENS_DETECTOR) return null;
  const parsed = z.array(z.object({ atMs: z.number() })).safeParse(row.instants);
  return parsed.success ? parsed.data.map((instant) => instant.atMs) : null;
}

/** Every moment's clip for one analysis, read the one way every caller must:
 *  today's sample knob, the demo's recorded length, the analysis's instants. */
export async function momentClips(
  db: Db,
  opts: {
    timeline: AnalysisState[];
    /** demos.duration_ms. */
    recordingMs: number | null | undefined;
    instants: number[] | null;
  },
): Promise<{ clips: PlacedClip[]; sampleMs: number; recordingEndMs: number }> {
  const sampleMs = await analysisSampleMs(db);
  const endMs = recordingEndMs(opts.recordingMs, opts.timeline, sampleMs);
  return {
    clips: placeClips(opts.timeline, { sampleMs, recordingEndMs: endMs, instants: opts.instants }),
    sampleMs,
    recordingEndMs: endMs,
  };
}

export interface AccessMoment {
  /** The pinned state. Its clip is its own placed clip, like every step's. */
  index: number;
  /** The address-bar run: the candidates on the first candidate's screen. */
  run: number[];
  runStartMs: number;
  /** When the run's screen ends (screenEnds). */
  runEndMs: number;
  /** States a plan may not select beside the pin: every state before the
   *  run's screen ends — the run is one moment on screen, which the pin
   *  already shows, and anything earlier would sit in front of the step that
   *  is fixed first — and every state whose clip shares footage with the pin's
   *  clip. A step the model (or the canned planner) puts here is dropped. NOT
   *  the search window: when the loaded site is read as `other` and no loading
   *  screen was caught (2 of 6 production analyses), the window runs to 15s
   *  and would swallow real product steps. */
  zone: ReadonlySet<number>;
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
 * Pin: the LATEST run candidate whose clip ends by the run's end — the
 * address at its most typed, the whole clip still on the address bar; failing
 * that, the candidate whose clip runs least past it (the later on a tie).
 * "כנסו לכאן" reads in well under a step, so any candidate can carry it.
 */
export function findAccessMoment(
  timeline: AnalysisState[],
  opts: Pick<ClipContext, "sampleMs" | "recordingEndMs"> & {
    /** Every state's clip (placeClips). */
    clips: PlacedClip[];
    link?: string | null;
  },
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

  const ends = screenEnds(timeline, opts);
  const runEndMs = ends[candidates[0]!]!;
  const run = candidates.filter((c) => ends[c] === runEndMs);
  const pastRunMs = (c: number): number => Math.max(0, opts.clips[c]!.startMs + STEP_MS - runEndMs);
  // Latest first, and a strict comparison: the later candidate wins a tie.
  const index = [...run].reverse().reduce((best, c) => (pastRunMs(c) < pastRunMs(best) ? c : best));

  const runStartMs = timeline[run[0]!]!.timestampMs;
  const pinClip = clipOf(opts.clips[index]!);
  const zone = new Set<number>();
  timeline.forEach((s, i) => {
    if (i === index) return;
    const beforeRunEnds = s.timestampMs < runEndMs;
    if (beforeRunEnds || clipsOverlap(clipOf(opts.clips[i]!), pinClip)) zone.add(i);
  });
  return { index, run, runStartMs, runEndMs, zone };
}

/** A selection with the access step pinned first. The selector's own pick of
 *  the same state and every step inside the pin's zone go — the run and the
 *  pin's clip are one moment on screen and the pin already shows it, and
 *  nothing earlier may open the plan — so the model can never duplicate,
 *  crowd or precede it, whatever it returns. Out-of-range
 *  indexes pass through for the validator to name. */
function withPin(
  steps: { sourceIndex: number; label: string }[],
  access: AccessMoment | null,
): { sourceIndex: number; label: string }[] {
  if (!access) return steps;
  const kept = steps.filter(
    (step) => step.sourceIndex !== access.index && !access.zone.has(step.sourceIndex),
  );
  return [{ sourceIndex: access.index, label: ACCESS_LABEL }, ...kept];
}

/** The model-facing notice appended under the rendered prompt when a pin
 *  exists. Appended in code, the way correctivePrompt appends, so the prompt
 *  file stays the shipped one and a recording with no access moment renders it
 *  verbatim. It names the rule by its heading, never by its number, so a
 *  renumbered prompt cannot make it point at the wrong rule. */
function accessNotice(
  access: AccessMoment,
  timeline: AnalysisState[],
  modelMin: number,
  modelMax: number,
): string {
  const zone = [...access.zone].sort((a, b) => a - b);
  const off =
    zone.length > 0
      ? `Never select state ${access.index} or any of states ${zone.join(", ")} — they come before the way in or show that same moment`
      : `Never select state ${access.index}`;
  return [
    "## The way in is already the first step",
    "",
    `Ignore the "Open with the way in" rule: the system has fixed step 1 of this plan — state ${access.index} (${timeline[access.index]!.timestampMs}ms, the customer typing the address), captioned "${ACCESS_LABEL}". It appears as index 0 in any plan echoed back to you; whether or not you repeat it, the system re-pins it — never move or recaption it. ${off}, and never write a "go here" caption of your own. The ${modelMin}–${modelMax} steps above already exclude that step: select your own steps from the other states, and end on the success state as before.`,
  ].join("\n");
}

/**
 * The largest set of `pool` states whose clips share no footage, in
 * chronological order. With `endings`, the set must END on one of them — the
 * format ends on the success state — with every other pick before it. Every
 * clip is STEP_MS long, so working back from the end and taking the
 * latest-starting clip that still fits is optimal. The minimum-step waiver
 * counts this set and the canned planner selects it, so the two cannot
 * disagree about what a timeline can offer.
 */
function largestSeparateSelection(
  pool: number[],
  timeline: AnalysisState[],
  clips: PlacedClip[],
  endings: number[],
): number[] {
  const backFrom = (end: number | undefined): number[] => {
    const picked: number[] = end === undefined ? [] : [end];
    let cursor = end === undefined ? Number.POSITIVE_INFINITY : clips[end]!.startMs;
    const beforeMs = end === undefined ? Number.POSITIVE_INFINITY : timeline[end]!.timestampMs;
    const latestFirst = pool
      .filter((i) => i !== end && timeline[i]!.timestampMs < beforeMs)
      .sort((a, b) => clips[b]!.startMs - clips[a]!.startMs || b - a);
    for (const i of latestFirst) {
      if (clips[i]!.startMs + STEP_MS <= cursor) {
        picked.push(i);
        cursor = clips[i]!.startMs;
      }
    }
    return picked.reverse();
  };
  if (endings.length === 0) return backFrom(undefined);
  let best: number[] = [];
  // Chronological endings and >=: the later ending wins a tie.
  for (const end of endings) {
    const selection = backFrom(end);
    if (selection.length >= best.length) best = selection;
  }
  return best;
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
 * cannot offer that many separate clips; and no two selected clips may share
 * footage (decision 0087). Human edits skip the first two — deleting steps
 * just makes the video shorter — and updatePlanSteps refuses an overlap
 * itself.
 *
 * Every step is one STEP_MS clip (decision 0076), so nothing here adds up a
 * runtime or measures a caption against its clip: a plan runs its step count
 * times STEP_MS, and a caption fits exactly when it is MAX_LABEL_WORDS words
 * or fewer.
 */
export function findPlanViolations(
  steps: { sourceIndex: number; label: string }[],
  timeline: AnalysisState[],
  maxSteps: number,
  shape?: {
    minSteps: number;
    notes: string | null;
    /** Every state's clip (placeClips). */
    clips: PlacedClip[];
    /** The pinned access step, when the generation path pinned one. Its
     *  state may carry a skipped kind (the vision pass calls browser chrome
     *  `system`) — that one check is waived for it, nothing else is. The
     *  waiver's count also leaves out its zone, which withPin makes
     *  unselectable: counting a state there would demand a plan no retry can
     *  produce. */
    pinned?: AccessMoment;
    /** The last-round re-check: a caption over the word ceiling is kept and
     *  left to the editor's warning rather than failing the plan (founder,
     *  decision 0086). */
    allowLongLabels?: boolean;
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
  const inZone = (index: number): boolean => pinned !== undefined && pinned.zone.has(index);
  /** The per-step legality the waiver counts — the pin counts whatever its
   *  kind, exactly as the per-step check accepts it. */
  const selectable = (index: number, s: AnalysisState): boolean =>
    index === pinned?.index ||
    (s.legibility !== "unreadable" && !isSkippedKind(s) && !s.sameStateAsPrevious);

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
    if (words.length > MAX_LABEL_WORDS && !shape?.allowLongLabels) {
      violations.push(
        `step ${i}: label "${step.label}" is over ${MAX_LABEL_WORDS} words — a step is on screen for ${STEP_MS}ms and nothing longer can be read in it; cut it to ${MAX_LABEL_WORDS} words or fewer`,
      );
    }
  });

  if (shape) {
    const { clips } = shape;
    // The format invariant: the video ends on the success state. Enforceable
    // only when the timeline offers a selectable result state — the analysis
    // may have mistyped the success screen, and a plan cannot end on a state
    // that does not exist. A skip-kind "result" (a validation error the
    // analysis mistyped) is not selectable either, so it cannot force the rule.
    const successCandidates = timeline
      .map((s, i) => ({ s, i }))
      .filter(
        ({ s, i }) =>
          s.actionType === "result" &&
          s.legibility !== "unreadable" &&
          !isSkippedKind(s) &&
          !inZone(i),
      );
    const valid = steps.filter((s) => Number.isInteger(s.sourceIndex) && timeline[s.sourceIndex]);
    const last =
      valid.length > 0
        ? valid.reduce((a, b) =>
            timeline[a.sourceIndex]!.timestampMs >= timeline[b.sourceIndex]!.timestampMs ? a : b,
          )
        : undefined;
    // `notes` waives the rule: the analysis may have typed error screens as
    // "result" (the timeline then OFFERS a result state that is not a genuine
    // success), and a plan cannot be forced to end on one. The model may end
    // elsewhere only by explaining why in `notes` — never silently.
    if (successCandidates.length > 0 && last && !shape.notes?.trim()) {
      if (timeline[last.sourceIndex]!.actionType !== "result") {
        // Real recordings keep going after the success moment (a179f069: the
        // success sits at 45s of an 80s recording), so "end on the result
        // state" is not enough — the retry needs the candidate indexes and an
        // explicit licence to drop the trailing steps, or it reshapes blind.
        // The message has to name what may be added AND what may not: told
        // plainly to "select additional states" a live retry padded with a
        // loading screen — a fresh violation with no third call to fix it.
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
    // that cannot offer minSteps separate clips has no longer plan to give —
    // an 8-10 s recording never can, five clips are 10 s of footage. What it
    // can offer is counted exactly (largestSeparateSelection): legal states
    // outside the pin's zone, clips sharing no footage, ending on a success
    // candidate when there is one — a state after the success screen can never
    // be a step, so counting one would demand a plan the ending rule rejects.
    //
    // Deliberately NOT conditioned on `notes`: dryRunPlan sets notes to
    // explain a shortfall, which would switch the count off in exactly the
    // case it exists for. When notes does waive the last-step rule the model
    // may end later than this, so the count under-counts and forgives a
    // little more — the mild direction for a rule that only ever ADDS a
    // violation.
    if (steps.length < shape.minSteps) {
      const pool = timeline
        .map((s, index) => ({ s, index }))
        .filter(({ s, index }) => index !== pinned?.index && selectable(index, s) && !inZone(index))
        .map(({ index }) => index);
      const offered =
        largestSeparateSelection(
          pool,
          timeline,
          clips,
          successCandidates.map(({ i }) => i),
        ).length + (pinned ? 1 : 0);
      if (offered >= shape.minSteps) {
        violations.push(
          `the plan has ${steps.length} steps, fewer than the minimum ${shape.minSteps} — this timeline offers ${offered} selectable states whose clips do not overlap, so select more genuinely distinct ones; \`notes\` does not waive this, and never pad with loading, duplicate or otherwise skipped states`,
        );
      }
    }
    // Two steps never show the same footage (decision 0087). Every pair, not
    // neighbours only: with slid clips a step can clear the one before it and
    // still overlap the one before that. The message names both clips and
    // which state to give up — told only "keep whichever reads better", a
    // retry may drop the ending and fail the ending rule instead.
    const chosen = [...seen].sort((a, b) => timeline[a]!.timestampMs - timeline[b]!.timestampMs);
    const span = (index: number): string =>
      `${clips[index]!.startMs}-${clips[index]!.startMs + STEP_MS}ms`;
    for (const [a, b] of overlappingPairs(chosen.map((index) => clipOf(clips[index]!)))) {
      const earlier = chosen[a]!;
      const later = chosen[b]!;
      const advice =
        earlier === pinned?.index
          ? `state ${earlier} is the fixed first step, so drop state ${later}`
          : later === last?.sourceIndex && timeline[later]!.actionType === "result"
            ? `state ${later} is the ending, so drop state ${earlier}, or select an earlier moment in its place`
            : `keep the one that shows the beat better (a \`calm\` one when there is one) and select a genuinely different state instead of the other`;
      violations.push(
        `states ${earlier} and ${later} show the same footage — their clips (${span(earlier)} and ${span(later)}) overlap, and two steps may never share footage; ${advice}`,
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
  /** Per model call, the violations found AFTER that call — last entry empty
   *  on success, [] under DRY_RUN (no calls). Non-empty last entry on a
   *  returned draft: the plan was stored anyway (decisions 0074, 0086), and
   *  that entry is what the repair cleared or what was left to the editor (a
   *  long caption, a short count). Persisted on the plan
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

/**
 * sourceIndex is the source of truth: timestamp and actionType come from the
 * selected state — chronological by construction — and the clip from the
 * state's placed clip (decisions 0076, 0084): every step is STEP_MS long and
 * starts at `startMs`, which may be before its own moment.
 *
 * `keep` carries the clips of steps already stored with one (updatePlanSteps):
 * a clip the customer has watched is never moved by a later save, whatever
 * changed around it or in the footage row since.
 *
 * Ordered by the moment. Two clips that share no footage, each holding its own
 * moment, are in the same order by start as by moment — and an overlap is
 * refused before anything is stored (findPlanViolations, updatePlanSteps), so
 * this is also the order the render lays them out in.
 */
export function assembleSteps(
  selected: { sourceIndex: number; label: string }[],
  timeline: AnalysisState[],
  clips: PlacedClip[],
  keep?: ReadonlyMap<number, { startMs: number; twoPages?: boolean }>,
): PlanStep[] {
  return selected
    .map(({ sourceIndex, label }) => {
      const clip = keep?.get(sourceIndex) ?? clips[sourceIndex]!;
      return {
        timestampMs: timeline[sourceIndex]!.timestampMs,
        actionType: timeline[sourceIndex]!.actionType,
        label: label.trim(),
        sourceIndex,
        startMs: clip.startMs,
        durationMs: STEP_MS,
        ...(clip.twoPages ? { twoPages: true } : {}),
      };
    })
    .sort((a, b) => a.timestampMs - b.timestampMs);
}

/** The fewest steps the last-round repair may store, the pin counted: one or
 *  two steps is a failure shown as a ready plan (founder, decision 0074) —
 *  unless the recording itself offers no more, where a first answer of that
 *  size is stored too. */
const REPAIR_MIN_STEPS = 3;

/**
 * What code does to a model plan that still violates after the last
 * corrective call, instead of failing it (decision 0074, as adapted to fixed
 * 2 s clips): drop steps until no two share footage, then until the plan is
 * within `maxSteps`. Returns the kept selection in chronological order — the
 * caller decides whether it may be stored — or null when the plan is not one
 * to repair: an index is outside the timeline or picked twice, which no drop
 * rule here speaks to.
 *
 * Captions are never touched and never a reason to drop: a caption over the
 * word ceiling is kept and left to the editor's warning (founder, decision
 * 0086 — under a fixed clip the remedy is cutting a word, not the step).
 *
 * The pin and the ending (the last selected result state) are never dropped:
 * the way in and the way out are what the format cannot lose.
 *
 * Overlaps — the largest set of steps sharing no footage that holds the pin
 * and the ending; among equally large sets, the one with more steps the
 * re-check will accept (a pick of an unreadable or skipped-kind state still
 * fails the plan, so it is the one to lose a tie), then more calm clips, then
 * fewer two-page ones, then the earlier steps. Chosen as a set, not pair by
 * pair: dropping A for overlapping B and then B for overlapping the ending
 * can leave two steps where dropping B alone leaves three.
 *
 * Over the maximum — one step at a time: a pick the re-check would reject
 * first, then a two-page clip, then a merely non-calm one, then a calm one;
 * inside a class the step whose clip sits closest to a neighbour's; the
 * earlier on a tie. Never the last step.
 */
export function repairPlanSteps(
  steps: { sourceIndex: number; label: string }[],
  timeline: AnalysisState[],
  clips: PlacedClip[],
  opts: { maxSteps: number; pinnedIndex?: number },
): { sourceIndex: number; label: string }[] | null {
  const seen = new Set<number>();
  for (const { sourceIndex } of steps) {
    if (!Number.isInteger(sourceIndex) || !timeline[sourceIndex] || seen.has(sourceIndex)) {
      return null;
    }
    seen.add(sourceIndex);
  }
  type Step = (typeof steps)[number];
  const chronological = (list: Step[]): Step[] =>
    [...list].sort(
      (a, b) => timeline[a.sourceIndex]!.timestampMs - timeline[b.sourceIndex]!.timestampMs,
    );
  let kept = chronological(steps);
  const ending = [...kept].reverse().find((s) => timeline[s.sourceIndex]!.actionType === "result");
  const isProtected = (s: Step): boolean => s.sourceIndex === opts.pinnedIndex || s === ending;
  const clip = (s: Step): Clip => clipOf(clips[s.sourceIndex]!);

  // Overlaps. The protected steps stay; everything sharing footage with one
  // goes; the rest is weighted interval scheduling over equal-length clips.
  const fixed = kept.filter(isProtected);
  if (overlappingPairs(fixed.map(clip)).length > 0) return null;
  const free = kept
    .filter((s) => !isProtected(s) && !fixed.some((f) => clipsOverlap(clip(s), clip(f))))
    .sort((a, b) => clip(a).startMs - clip(b).startMs);
  /** A pick findPlanViolations rejects whatever else happens to the plan. */
  const rejected = (s: Step): boolean => {
    const state = timeline[s.sourceIndex]!;
    return state.legibility === "unreadable" || isSkippedKind(state);
  };
  const weight = (s: Step): number[] => [
    1,
    rejected(s) ? 0 : 1,
    clips[s.sourceIndex]!.calm ? 1 : 0,
    clips[s.sourceIndex]!.twoPages ? 0 : 1,
  ];
  // best[i]: the best selection among the first i free steps.
  const best: { score: number[]; picked: Step[] }[] = [{ score: [0, 0, 0, 0], picked: [] }];
  free.forEach((step, i) => {
    // Sorted by start and equally long, so the steps this one clears are a prefix.
    let clear = 0;
    while (clear < i && clip(free[clear]!).startMs + STEP_MS <= clip(step).startMs) clear++;
    const w = weight(step);
    const take = {
      score: best[clear]!.score.map((value, k) => value + w[k]!),
      picked: [...best[clear]!.picked, step],
    };
    // Strictly better only: on a tie the earlier steps stay.
    best.push(keyBefore(best[i]!.score, take.score) ? take : best[i]!);
  });
  kept = chronological([...fixed, ...best[free.length]!.picked]);

  const tier = (s: Step): number =>
    rejected(s) ? -1 : clips[s.sourceIndex]!.twoPages ? 0 : clips[s.sourceIndex]!.calm ? 2 : 1;
  while (kept.length > opts.maxSteps) {
    const crowding = (i: number): number =>
      Math.min(
        i > 0 ? clip(kept[i]!).startMs - clip(kept[i - 1]!).startMs : Number.POSITIVE_INFINITY,
        clip(kept[i + 1]!).startMs - clip(kept[i]!).startMs,
      );
    let drop: { at: number; key: number[] } | undefined;
    // Never the last step, the pin or the ending.
    for (let i = 0; i < kept.length - 1; i++) {
      if (isProtected(kept[i]!)) continue;
      const key = [tier(kept[i]!), crowding(i)];
      if (!drop || keyBefore(key, drop.key)) drop = { at: i, key };
    }
    if (!drop) break;
    const at = drop.at;
    kept = kept.filter((_, i) => i !== at);
  }
  return kept;
}

/**
 * The timeline as the model is shown it: every state, with where its clip
 * starts and what the footage says about that clip (decision 0084). Every
 * moment has a full STEP_MS clip, so none is too short to offer — the
 * hidden-moment filter of decision 0074 has nothing left to hide. `twoPages`
 * rides along only when true.
 */
export function planPromptTimeline(timeline: AnalysisState[], clips: PlacedClip[]) {
  return timeline.map((s, index) => ({
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
    clipStartMs: clips[index]!.startMs,
    calm: clips[index]!.calm,
    twoPages: clips[index]!.twoPages || undefined,
  }));
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
  /** Every state's clip (placeClips): the canned plan obeys the no-shared-
   *  footage rule it is validated against. */
  clips: PlacedClip[],
  /** States the canned plan may not select — the pinned access step and its
   *  zone, which withPin prepends and removes. Filtered ONCE, here, so the
   *  ending lookup below cannot reach back into the zone either. */
  exclude?: (index: number) => boolean,
): PlanOutput {
  const indexed = timeline
    .map((state, index) => ({ state, index }))
    .filter(({ index }) => !exclude?.(index));
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
  const startOf = (entry: (typeof indexed)[number]): number => clips[entry.index]!.startMs;

  // Thin to the cap keeping the ending, then make the clips share no footage.
  // subsampleClusters always keeps its last element and lastResult is appended
  // straight after it, so (final candidate, success screen) is exactly the
  // pair most likely to overlap — leaving it in would make the canned plan
  // fail its own validation and throw. Walk backwards dropping the EARLIER of
  // any overlapping pair: the ending is the one state the format cannot lose.
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
      if (!next || startOf(kept[i]!) + STEP_MS <= startOf(next)) spaced.push(kept[i]!);
    }
    return spaced.reverse();
  };

  // Quality first; top up from the legal pool only when quality alone lands
  // under the minimum, because that is precisely the shortfall the
  // minimum-step waiver will NOT forgive (it counts the legal pool). When even
  // the legal pool is short the waiver does forgive it, so a short plan there
  // is correct rather than a throw.
  //
  // The last resort is the very selection the waiver counts
  // (largestSeparateSelection) — which is the whole point. `pick` thins with
  // subsampleClusters, which is index-even, so a burst of near-duplicate
  // frames can spend most of the cap before the overlap walk even runs; the
  // waiver then sees states the canned plan threw away and refuses to forgive
  // the shortfall, and the keyless path throws.
  const dense = (pool: typeof indexed): typeof indexed => {
    const selection = largestSeparateSelection(
      pool.map(({ index }) => index),
      timeline,
      clips,
      results.map(({ index }) => index),
    );
    // Chronological; trimmed off the FRONT so the ending always survives the cap.
    return selection.slice(-maxSteps).map((index) => ({ state: timeline[index]!, index }));
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
      .slice(0, MAX_LABEL_WORDS)
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
    /** demos.duration_ms — where the recording ends; null/absent falls back
     *  to one sample past the last state (recordingEndMs). */
    recordingMs?: number | null;
    /** The analysis's footage instants in ms (analysisInstants); null/absent =
     *  not known, and no clip is then called calm. */
    instants?: number[] | null;
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
  const {
    clips,
    sampleMs,
    recordingEndMs: endMs,
  } = await momentClips(db, {
    timeline: opts.timeline,
    recordingMs: opts.recordingMs,
    instants: opts.instants ?? null,
  });

  // The access moment, pinned as step 1 on both branches (see ACCESS_LABEL).
  // The model or the canned planner fills the plan AROUND it: one step is
  // already spoken for, so the counts they see are reduced by exactly that,
  // while findPlanViolations checks the COMBINED plan against the full ones —
  // consistent by construction. The prompt file is the shipped version; the
  // pinned rendering is marked on the stored version so pinned plans are
  // distinguishable in the row.
  const access = findAccessMoment(opts.timeline, {
    clips,
    sampleMs,
    recordingEndMs: endMs,
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
      access ? (index) => index === access.index || access.zone.has(index) : undefined,
    );
    const steps = withPin(canned.steps, access);
    // The canned plan goes through the same enforcement as a real one, so the
    // whole validation path runs keyless; a violation here is a code bug.
    const violations = findPlanViolations(steps, opts.timeline, maxSteps, {
      minSteps,
      notes: canned.notes,
      clips,
      pinned,
    });
    if (violations.length > 0) {
      throw new Error(`dry-run plan violates its own rules: ${violations.join("; ")}`);
    }
    return {
      // The highlight rides along so the keyless shape matches live.
      steps: withOffScreenWords(
        assembleSteps(steps, opts.timeline, clips),
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

  const rendered = renderPrompt("plan_demo_steps", {
    questionnaire: JSON.stringify(opts.questionnaire, null, 2),
    timeline: JSON.stringify(planPromptTimeline(opts.timeline, clips), null, 2),
    min: modelMin,
    max: modelMax,
    // v11+. Older prompt files never reference {{timing}} and are unaffected —
    // renderPrompt only substitutes what the template asks for.
    timing: planTimingMarkdown({ minSteps: modelMin, maxSteps: modelMax }),
    // v13+, same one-way compatibility as {{timing}}. The sentinel mirrors
    // the vo_script pattern (copy.ts): the template always has SOMETHING to
    // say where the description would go.
    demo_description: opts.demoDescription?.trim() || "(אין — התבסס על השאלון והמסכים בלבד)",
  });
  // No access moment: the prompt file verbatim. A pin: the notice under it,
  // stamped "+access-pin". (v15 rows also carry "+pickable": the model was
  // shown only moments long enough to caption, decision 0074. Since v16 every
  // moment has a full clip and the whole timeline is shown again.)
  const text = access
    ? `${rendered.text}\n\n${accessNotice(access, opts.timeline, modelMin, modelMax)}`
    : rendered.text;
  const promptVersion = markVersion(rendered.promptVersion);

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

  // Every check runs on the COMBINED plan: the pin first, then the model's
  // own steps after withPin has removed anything that duplicates or crowds it.
  const combined = (output: PlanOutput): { sourceIndex: number; label: string }[] =>
    withPin(output.steps, access);
  const validate = (output: PlanOutput): string[] =>
    findPlanViolations(combined(output), opts.timeline, maxSteps, {
      minSteps,
      notes: output.notes,
      clips,
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
      )}\n\nReturn the same plan with the minimal edits that fix every violation named above. Keep every step and label the violations above do not implicate unchanged, and keep every label at ${MAX_LABEL_WORDS} words maximum.`;

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
  // given: the repair below dropped a step from it. A plan stored with only a
  // long caption or a short count left over is the model's own answer — its
  // last retry_violations entry says what was left. A pick inside the pin's
  // zone is not a repair either — withPin has always removed those.
  let repaired = false;
  if (violations.length > 0) {
    // The last call is spent. Drop what dropping fixes — shared footage, a
    // count over the maximum — then hold the plan to the model's rules minus
    // the two a draft is forgiven: the minimum step count (decision 0074: a
    // short draft the customer can extend beats a failure) and a caption over
    // the word ceiling (decision 0086: the editor warns, the customer cuts a
    // word). Anything else still violating, or fewer than REPAIR_MIN_STEPS
    // left on a recording that offers that many, fails exactly as it always
    // did.
    const fixed = repairPlanSteps(steps, opts.timeline, clips, {
      maxSteps,
      pinnedIndex: access?.index,
    });
    if (
      fixed === null ||
      findPlanViolations(fixed, opts.timeline, maxSteps, {
        minSteps: REPAIR_MIN_STEPS,
        notes: output.notes,
        clips,
        pinned,
        allowLongLabels: true,
      }).length > 0
    ) {
      throw new PlanViolationError({ promptVersion, rounds });
    }
    repaired = fixed.length < steps.length;
    steps = fixed;
  }

  return {
    // The provenance highlight, computed once on the accepted plan (0049).
    steps: withOffScreenWords(
      assembleSteps(steps, opts.timeline, clips),
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
      instants: await analysisInstants(ctx.db, plan.analysisId),
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

/** updatePlanSteps' refusal of a selection whose clips share footage (decision
 *  0087). Exported so the web's error mapping matches the message, not a copy
 *  of it. */
export const PLAN_STEPS_OVERLAP_MESSAGE = "plan steps overlap in the footage";

/**
 * Replace a plan's steps with the user's selection. The client sends only
 * {sourceIndex, label} — timestamp, actionType and the clip are derived
 * server-side and the result ordered by timestamp: chronology is a property
 * of the format, not a client convention. Labels are NOT run through
 * findOffScreenWords — the highlight is for the model's words. A step whose
 * label the customer CHANGED stores offScreenWords: [] (the words are theirs
 * now); a step whose label is still the model's keeps the marks the stored
 * row carries, because approve is disabled while the draft is dirty, so every
 * edit — or a delete, or an added step — forces a save before approval, and a
 * save that wiped every mark would take the highlight away from the labels
 * the customer never touched. An added step has no stored marks and gets [].
 *
 * The clip (decisions 0076, 0084): a step already stored WITH a clip
 * (`startMs`) keeps it, whatever its label — a clip the customer watched
 * never moves under them. Every other step — newly added, or stored before
 * steps had clips — gets its moment's placed 2 s clip. Two steps that would
 * then share footage are refused (0087): the customer deletes one.
 *
 * Before approval the row mutates in place. Any edit to an APPROVED plan forks
 * a new row (renders reference plans by id, like audio pins its script), and
 * any edit leaves approvedAt clear. A fork that changes nothing — the
 * editor's "edit a copy" — copies the stored steps exactly as they are, so an
 * approved plan can always be opened for editing, whatever its steps would
 * look like re-placed (decision 0088).
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
  // The recording's length bounds every clip — the same row the generation
  // path reads, so an edit can never place a clip past it.
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

  // The stored row's steps, by sourceIndex. A row whose steps fail to parse
  // carries none.
  const stored = planStepsSchema.safeParse(plan.steps);
  const storedSteps = stored.success ? stored.data : [];
  const storedBySource = new Map(storedSteps.map((step) => [step.sourceIndex, step]));

  const fork = async (steps: PlanStep[]): Promise<StepPlan> => {
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

  // "Edit a copy": the same steps with the same labels. An exact copy, not a
  // re-placed one — nothing was edited yet.
  const unchanged =
    opts.steps.length === storedSteps.length &&
    opts.steps.every(
      (step) => storedBySource.get(step.sourceIndex)?.label.trim() === step.label.trim(),
    );
  if (plan.approvedAt && unchanged) return fork(storedSteps);

  const { clips } = await momentClips(db, {
    timeline,
    recordingMs: demoRows[0]?.durationMs,
    instants: await analysisInstants(db, plan.analysisId),
  });
  const keep = new Map<number, { startMs: number; twoPages?: boolean }>();
  for (const step of storedSteps) {
    if (step.startMs !== undefined) {
      keep.set(step.sourceIndex, { startMs: step.startMs, twoPages: step.twoPages });
    }
  }
  const steps = assembleSteps(opts.steps, timeline, clips, keep).map((step) => {
    const before = storedBySource.get(step.sourceIndex);
    const same = before !== undefined && before.label.trim() === step.label;
    return { ...step, offScreenWords: same ? (before.offScreenWords ?? []) : [] };
  });
  if (overlappingPairs(steps.map(stepClip)).length > 0) {
    throw new Error(PLAN_STEPS_OVERLAP_MESSAGE);
  }

  if (plan.approvedAt) return fork(steps);

  const updated = await db
    .update(demoStepPlans)
    .set({ steps, updatedAt: new Date() })
    .where(and(eq(demoStepPlans.id, plan.id), isNull(demoStepPlans.approvedAt)))
    .returning();
  // approvePlan may have won the race after our read — never overwrite what
  // the customer approved; fork exactly as if the approval had been seen.
  if (!updated[0]) return fork(steps);
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
  // demos.duration_ms of the recording, when known — where the recording
  // ends; absent falls back to one sample past the last state.
  recordingMs: z.number().optional(),
  // The analysis's footage instants in ms, when the recording's footage was
  // decoded for the fixture; absent = not known, and nothing is then calm.
  instants: z.array(z.number()).optional(),
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
  /** Set when the plan printed is not the model's clean answer — the
   *  last-round repair dropped steps from it (decision 0074), or it was stored
   *  with something left over (a long caption, a short count): the violations
   *  the model's last call left. */
  repaired?: string[];
  /** Which of the two: true when the repair dropped steps. */
  dropped?: true;
}

/**
 * Re-run pass 2 over every saved fixture and diff the selection. Green/red is
 * the sourceIndex SET (labels vary run to run and are printed for eyeballing,
 * never asserted). Runs against fixture data directly — no rows are written.
 * A plan the repair changed, or one stored with a violation left over, is
 * never green: the regress measures the model's answer, and before the
 * repair existed such a run failed outright.
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
        instants: fixture.instants,
      });
      const actual = draft.steps.map((s) => s.sourceIndex).sort((a, b) => a - b);
      const setMatch = JSON.stringify(actual) === JSON.stringify(expected);
      const explained =
        (fixture.expected.allowNotes ?? false) && draft.steps.length > 0 && !!draft.notes?.trim();
      // Stored by the last-round repair, or stored with something the model's
      // last call left behind (a long caption, a short count).
      const leftover = draft.retryViolations[draft.retryViolations.length - 1] ?? [];
      const dropped = draft.promptVersion.endsWith("+repaired");
      const repaired = dropped || leftover.length > 0;
      results.push({
        fixture: file,
        pass: (setMatch || explained) && !repaired,
        expected,
        actual,
        steps: draft.steps.map((s) => ({ sourceIndex: s.sourceIndex, label: s.label })),
        notes: draft.notes,
        ...(repaired ? { repaired: leftover } : {}),
        ...(dropped ? { dropped } : {}),
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

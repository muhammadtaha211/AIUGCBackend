import { countScriptWords, MAX_B_SCRIPT_WORDS } from "@aiugc/core/b-script-words";
import {
  CUTAWAY_ALTERNATE,
  CUTAWAY_FRAME_SLACK_MS,
  CUTAWAY_MAX_SLOTS,
  clearHookText,
  cutawayWindowStarts,
  fitCutawayAt,
  hookLeaveVoMs,
  snapCutawayStart,
} from "@aiugc/core/cutaway-structure";
import type { HookEffect } from "@aiugc/core/hook-effect";
import type { SafeRect } from "@aiugc/core/hook-geometry";
import { HOOK_TEXT_MAX_CHARS, HOOK_TEXT_MAX_WORDS, hookTextError } from "@aiugc/core/hook-text";

/**
 * Pure, client-safe helpers for the homepage and the Service B wizard.
 * No imports from @aiugc/core's main entry — this file is bundled into
 * client components, and core drags in server-only dependencies. The
 * "b-script-words", "cutaway-structure", "hook-effect", "hook-geometry" and
 * "hook-text" subpaths are the deliberate exceptions (pure constants,
 * validation and the cutaway placement rules, the same kind service-a-ui.ts
 * leans on). Keep this list exact: a stale allowlist stops reading as a rule.
 */

// ---------------------------------------------------------------------------
// Business selection (homepage header <-> wizard shell)
// ---------------------------------------------------------------------------

export const BUSINESS_COOKIE = "aiugc.business";

/** The cookie survives business deletion and device changes — fall back to the first business. */
export function pickSelectedBusiness<T extends { id: string }>(
  businesses: T[],
  cookieValue: string | undefined,
): T | undefined {
  return businesses.find((business) => business.id === cookieValue) ?? businesses[0];
}

// ---------------------------------------------------------------------------
// Status -> Hebrew labels
// ---------------------------------------------------------------------------

/** video_renders.status — rejected stays internal but gets a label just in case. */
export const RENDER_STATUS_LABELS: Record<string, string> = {
  queued: "בתור",
  rendering: "בעיבוד",
  qc_pending: "בבדיקה",
  released: "מוכן",
  rejected: "בבדיקה",
  failed: "נכשל",
};

export function renderStatusLabel(status: string): string {
  return RENDER_STATUS_LABELS[status] ?? status;
}

/** A render still moving through the pipeline — the strip keeps polling while any exists. */
export function isActiveRenderStatus(status: string): boolean {
  return status === "queued" || status === "rendering" || status === "qc_pending";
}

/** Which pipeline made it — the library labels each tile, the strip doesn't.
 *  "c" is גוש טקסט (Service C, open to every customer with credits since
 *  phase 2, decision 0099), so its tile needs a label like any other. */
export const SERVICE_LABELS: Record<"a" | "b" | "c", string> = {
  a: "הוק + דמו",
  b: "דמות AI",
  c: "גוש טקסט",
};

/** The /home/renders library pages renders 24 at a time (route + page agree). */
export const RENDER_PAGE_SIZE = 24;

/**
 * `?page=` on GET /api/businesses/[id]/renders decides the SHAPE, not just the
 * slice: a 1-based integer gets the library's { renders, total } page, and
 * everything else — absent, "0", "abc", "1.5" — gets the homepage strip's
 * newest-20-with-job-progress body, untouched. Returns the page number, or
 * null for the strip.
 *
 * SAFE integer, not merely integer: the page becomes an OFFSET, and a hand-typed
 * `?page=1e18` would multiply past what postgres accepts as a bigint and throw
 * where an empty page is the honest answer. Every safe integer's offset fits.
 */
export function rendersPageParam(raw: string | null): number | null {
  if (raw === null) return null;
  const page = Number(raw);
  return Number.isSafeInteger(page) && page >= 1 ? page : null;
}

/** Pages the pager offers. At least 1, so an empty library still says 1 of 1. */
export function rendersPageCount(total: number): number {
  return Math.max(1, Math.ceil(total / RENDER_PAGE_SIZE));
}

/** One row of GET /api/businesses/[id]/renders — strip and library alike. */
export type RenderRow = {
  id: string;
  service: "a" | "b" | "c";
  status: string;
  createdAt: string;
  /** Signed only after release — the customer never sees a render pre-QC. */
  thumbUrl?: string;
  /** Failed renders only; true when the credits were actually returned. */
  refunded?: boolean;
  /** The head in-flight row only, and only in the strip's shape — the library
   *  is a list of finished work, not a live indicator (see pickActiveHead). */
  job?: import("./service-a-ui").JobProgressWire;
  /** The tile's tag (decision 0108 §1): "scheduled" (מתוזמן) while a post of
   *  this video waits, "posted" (פורסם) once one went out and none waits, null
   *  for neither. Absent for an account the social-posting switch hides. */
  postTags?: { platform: "instagram" | "tiktok"; tag: "scheduled" | "delivered" | "posted" }[];
};

/**
 * The one in-flight render the dashboard describes — and the only row the
 * list route pays for job progress on.
 *
 * The heavy lane is strictly sequential (HEAVY_JOB_TYPES on one worker lane),
 * so at most one render is ever `rendering`: that one is the head, and the
 * only one that can have a real percent. With none rendering, the OLDEST
 * queued row is next in line and is the honest thing to describe — a CLI grid
 * can leave a dozen rows queued behind it, and "the newest" would point at
 * the one that starts last.
 *
 * Takes `createdAt` as string or Date so the route (Date rows) and the strip
 * (JSON strings) can share the rule instead of drifting apart.
 */
export function pickActiveHead<T extends { status: string; createdAt: string | Date }>(
  renders: T[],
): T | undefined {
  const active = renders.filter((render) => isActiveRenderStatus(render.status));
  const rendering = active.find((render) => render.status === "rendering");
  if (rendering) return rendering;
  return active.reduce<T | undefined>(
    (oldest, render) =>
      oldest === undefined || new Date(render.createdAt) < new Date(oldest.createdAt)
        ? render
        : oldest,
    undefined,
  );
}

/**
 * The dashboard's live chip. Counts every in-flight render, not just the head.
 *
 * `paused` is not decoration: when the head job is parked or nothing is
 * claiming it, "we're making it right now" is false, and it would contradict
 * the frozen bar and the amber line directly underneath.
 */
export function generatingLine(activeCount: number, paused: boolean): string {
  if (paused) {
    return activeCount > 1 ? `${activeCount} סרטונים ממתינים` : "יצירת הסרטון ממתינה";
  }
  return activeCount > 1 ? `${activeCount} סרטונים בתהליך` : "יוצרים סרטון עכשיו";
}

/**
 * The wizard's status timeline: which stage the render is at. failed/rejected
 * return -1 — they are handled as error states, not timeline positions.
 */
export const RENDER_STAGES = ["בתור", "בעיבוד", "בבדיקה", "מוכן"] as const;

export function renderStageIndex(status: string): number {
  switch (status) {
    case "queued":
      return 0;
    case "rendering":
      return 1;
    case "qc_pending":
      return 2;
    case "released":
      return 3;
    default:
      return -1;
  }
}

// ---------------------------------------------------------------------------
// Wizard steps
// ---------------------------------------------------------------------------

export type WizardStep = "persona" | "pointers" | "script" | "audio" | "effect" | "demo" | "render";

/**
 * One flow for every business: the persona is one look in one setting, so
 * there is no image step, and physical products are out of Service B, so
 * there is no composite step (vault 0017). The effect step is where the
 * customer picks a hook animation — or none — and edits the on-screen hook
 * text it burns (vault 0024; it offered opener clips until 2026-09-06).
 *
 * Demo cutaways (vault 0121, 0122) add one step, "demo" — the clips — right
 * after the audio card that ticks them, so the effect is set last before the
 * render (founder, 2026-10-21). The clips are laid out from the script's own
 * hook text; a longer line on the effect step moves only the clip it reaches.
 * With the option off the flow is exactly the six steps it always was.
 */
export function wizardSteps(opts: { cutaways?: boolean } = {}): WizardStep[] {
  return [
    "persona",
    "pointers",
    "script",
    "audio",
    ...(opts.cutaways ? (["demo"] as const) : []),
    "effect",
    "render",
  ];
}

// ---------------------------------------------------------------------------
// Wizard state carried across steps (owned by BWizard, edited by the steps)
// ---------------------------------------------------------------------------

export type Persona = {
  id: string;
  name: string;
  /**
   * The speaker's gender. Required (not optional) on purpose: Service A's hook
   * lines are written in this persona's first person, so a catalog query that
   * quietly stopped selecting the column would stop invalidating stale lines
   * without any type error. null = unset on the row; core treats that as female.
   */
  gender: string | null;
  imageUrl: string;
  /** Tiny base64 WebP for next/image placeholder="blur"; null on old rows. */
  blurDataUrl?: string | null;
  /**
   * Service B catalog only: the persona_images row the card shows — its
   * selfie, resolved server-side by personaSelfie — and therefore the exact
   * image the render must animate. The wizard sends this id with the render;
   * nothing on the customer path resolves a default at render time. Absent on
   * the Service A catalog, whose thumbnail is a portrait and renders nothing.
   */
  personaImageId?: string;
};

/**
 * Persona card <Image> geometry, shared by the picker and the /home preload
 * hints — the preload only hits the browser cache if both compute the same
 * optimizer URL, so these must never be duplicated. Grid: 2 cols on mobile
 * (~45vw incl. padding slack), 3 cols in the max-w-2xl card (~190px, so a
 * fixed 200px cap).
 */
export const PERSONA_CARD_SIZES = "(max-width: 640px) 45vw, 200px";
/** At card size 60 is indistinguishable from the default 75 and meaningfully smaller. */
export const PERSONA_CARD_QUALITY = 60;

// ---------------------------------------------------------------------------
// Hook effect (the effect step) — the opener bank it replaced is retired
// ---------------------------------------------------------------------------

/**
 * The hook animations, in the order the effect step offers them, in Hebrew.
 * The ids come from @aiugc/core/hook-effect (one vocabulary, shared with the
 * route and the render); the words are the customer's and live only here, so
 * the step component stays a dumb renderer and this table stays testable —
 * apps/web has no DOM test runner and adding one is locked decision #10.
 */
export const HOOK_EFFECT_OPTIONS: { id: HookEffect; label: string; hint: string }[] = [
  { id: "none", label: "ללא אפקט", hint: "הסרטון מתחיל ישר מהדמות, בלי משפט על המסך" },
  { id: "zoom", label: "זום אחורה", hint: "מתחילים צמוד לפנים, והפריים נפתח לאט" },
  { id: "focus", label: "פוקוס", hint: "התמונה נכנסת לפוקוס בדיוק כשהדמות מתחילה לדבר" },
  { id: "whip", label: "כניסה מהצד", hint: "התמונה נכנסת בתנועה מהירה עם סוויש" },
];

/** One founder-made opener clip of the persona's selfie, play-ready.
 *  RETIRED 2026-09-06 (vault 0023) with the opener bank; no wizard step reads
 *  it any more — GET /api/personas/[personaId]/openers is its last caller. */
export type OpenerClip = {
  id: string;
  effect: string;
  /** Hebrew, shown on the card. */
  label: string;
  /** Signed, short-lived. */
  previewUrl: string;
  /** Where the hard cut lands, in clip time: the first frame whose pose matches the selfie. */
  revealAtMs: number;
  /** The clip's default text safe area — seeds the placement editor. */
  textSafeArea: SafeRect;
};

/**
 * The effect step's hook-text field, in Hebrew. core's hookTextError is the
 * rule (the same one createBRender refuses on at enqueue); this only puts
 * words on it the customer can act on. Order matters: "has no words" must
 * be caught before the word-cap line, which also says "words".
 */
export function hookTextFieldError(text: string): string | undefined {
  const problem = hookTextError(text);
  if (problem === undefined) return undefined;
  if (/is empty|no words/.test(problem)) return "צריך לכתוב משפט פתיחה.";
  if (/emoji/.test(problem)) return "בלי אימוג'י, הטקסט נצרב על הסרטון.";
  if (/unrenderable/.test(problem)) return "יש כאן תו שאי אפשר להציג על הסרטון.";
  if (/words/.test(problem)) return `עד ${HOOK_TEXT_MAX_WORDS} מילים.`;
  if (/characters/.test(problem)) return `עד ${HOOK_TEXT_MAX_CHARS} תווים.`;
  if (/punctuation/.test(problem)) return "בלי נקודה או פסיק בסוף — סימן שאלה או קריאה בסדר גמור.";
  if (/niqqud/.test(problem)) return "בלי ניקוד.";
  return "המשפט לא תקין.";
}

export type AudioState = {
  id: string;
  /**
   * The script this audio speaks — a newer scriptId invalidates it. Seeded from
   * wizard state at request time, then corrected from audio_renders.script_id
   * on the first poll that disagrees.
   */
  scriptId: string;
  status: string; // queued | generating | ready | failed
  audioUrl?: string;
  /** Measured TTS duration (set when ready) — Service A's exact ending advisory. */
  durationMs?: number;
  approved: boolean;
  /**
   * The pointer moved after this audio was requested. Sticky: once the wizard
   * adopts the resolved script the server stops reporting it, but the customer
   * still needs to be told the text is not the one they wrote.
   */
  scriptChanged?: boolean;
};

/**
 * The name a finished render saves under. ASCII only and no spaces: it travels
 * in Content-Disposition, and a Hebrew filename there needs RFC 5987 encoding
 * we have not verified the storage host applies.
 *
 * The date is UTC (the render row's created_at, as the DB stored it) so the
 * name is the same wherever it is computed — the route runs in fra1, a test
 * runs on the founder's machine, and a local-time format would differ by one
 * day for a render made late at night in Israel.
 */
export function renderDownloadFilename(render: { id: string; createdAt: Date | string }): string {
  const day = new Date(render.createdAt).toISOString().slice(0, 10);
  return `tavnit-${day}-${render.id.slice(0, 8)}.mp4`;
}

export type RenderState = {
  id: string;
  status: string;
  videoUrl?: string;
  /** The same file signed as an attachment (renderDownloadFilename), minted by
   *  GET /api/renders/[id] alongside videoUrl. Absent until it arrives. */
  downloadUrl?: string;
  /** Set when status is "failed" — the render's own displayable Hebrew reason. */
  failureReason?: string;
  /** True only when the refund actually happened (refunded_at set server-side). */
  refunded?: boolean;
  /** Render job progress while queued/rendering (type lives with the other
   *  8d wire shapes; the import is type-only, so no runtime dependency). */
  job?: import("./service-a-ui").JobProgressWire;
  /** The player's "תזמון פרסום" and its pending line (social posting PR 3):
   *  sent only for a released render and an account the switch allows. */
  scheduleHref?: string;
  pendingPosts?: number;
};

/**
 * The failed-state copy for both wizards: the reason always renders; the
 * refund sentence renders only when the server says the refund really
 * happened — admin renders, pre-ledger rows, and unrefunded edge cases must
 * not claim money moved when it didn't.
 */
export function failedRenderNotice(render: Pick<RenderState, "failureReason" | "refunded">): {
  reason: string;
  showRefund: boolean;
} {
  return {
    reason: render.failureReason ?? "יצירת הסרטון נכשלה — נסו שוב.",
    showRefund: render.refunded === true,
  };
}

/** GET /api/audio/[id]: status, the signed mp3, and the script being spoken. */
export type AudioPollResult = {
  status: string;
  /** Resolved through audio_renders.script_id, server-side. */
  scriptId: string;
  text: string;
  wordBudget?: number;
  /** The resolved script's draft hook text (b_script rows only). */
  hookText?: string;
  /**
   * The pointer was rewritten after the audio was enqueued. A property of the
   * rows, not of anything the client sent, so it stays true for every later
   * poll of the same audio render.
   */
  scriptChanged: boolean;
  audioUrl?: string;
  durationMs?: number;
};

/**
 * Fold one poll into the audio state.
 *
 * Approval is dropped on the TRANSITION into `scriptChanged`, not while it is
 * set: the server reports the same true on every poll, so clearing on the flag
 * itself would revoke the customer's fresh approval every two seconds and make
 * the step impossible to leave. First sighting revokes; after that the flag
 * only keeps the notice on screen.
 */
export function applyAudioPoll(audio: AudioState, body: AudioPollResult): AudioState {
  const newlyChanged = body.scriptChanged && !audio.scriptChanged;
  return {
    ...audio,
    status: body.status,
    audioUrl: body.audioUrl,
    durationMs: body.durationMs,
    scriptId: body.scriptId,
    scriptChanged: audio.scriptChanged || body.scriptChanged,
    // Consent to one script is not consent to another.
    approved: newlyChanged ? false : audio.approved,
  };
}

/**
 * Whether the wizard shell must take the server's script. Text is compared as
 * well as id: an id match with different text would mean the row was mutated
 * under us, and the screen must still show what is on the server.
 */
export function needsScriptAdoption(
  script: ScriptState,
  body: { scriptId: string; text: string },
): boolean {
  return body.scriptId !== script.scriptId || body.text !== script.text;
}

// ---------------------------------------------------------------------------
// Script word budget + immutable-row threading
// ---------------------------------------------------------------------------

/**
 * The web's name for core's counting, not a copy of it. It used to mirror
 * the guard's implementation; now that the guard is client-safe there is one
 * definition and no way for the two to drift.
 */
export function countWords(text: string): number {
  return countScriptWords(text);
}

/**
 * The soft warning for the runaway-cost ceiling, in the shape service-a-ui's
 * labelWordWarning uses. Named to the customer on founder instruction
 * (2026-09-07): the server refuses past MAX_B_SCRIPT_WORDS, and learning that
 * from a line under the textarea beats learning it from a failed save.
 *
 * Soft on purpose — it does not disable anything. It also says nothing about
 * how long the ad may be: the ceiling is a processing limit, not a duration
 * limit, and the projected-length line beside it is the only thing that
 * speaks about seconds.
 */
export function scriptCeilingWarning(text: string): string | null {
  return countScriptWords(text) > MAX_B_SCRIPT_WORDS
    ? `תסריט מעל ${MAX_B_SCRIPT_WORDS} מילים לא ניתן לעיבוד — קצרו אותו כדי להמשיך.`
    : null;
}

/**
 * How long the current script will speak for, in seconds. Inverts core's
 * budget mapping (wordBudget = floor(durationPreset * wps)) using what the
 * wizard already holds: implied wps = wordBudget / durationPreset, so
 * seconds = words * durationPreset / wordBudget.
 *
 * Advisory only. The budget stopped being a cap — a script over it is a
 * longer ad, not a rejected one — so the customer needs the length itself
 * rather than a distance from a number that no longer bounds anything. An
 * estimate: real speech rate varies by voice and the exact figure only exists
 * once the recording does.
 *
 * Written here, not imported from service-a-ui.ts: that file goes with the
 * Service A retirement (vault 0020) and this must outlive it.
 */
export function estimateSpokenSeconds(
  words: number,
  durationPreset: number,
  wordBudget: number,
): number {
  if (wordBudget <= 0 || durationPreset <= 0) return 0;
  return (words * durationPreset) / wordBudget;
}

export type ScriptState = {
  scriptId: string;
  text: string;
  wordBudget?: number;
  /**
   * The DRAFT on-screen hook text the script call emitted (params.hookText).
   * A seed for the effect step only — the customer's edit lives in wizard
   * state and the FINAL string goes into render params, never back onto the
   * script (vault 0017).
   */
  hookText?: string;
  /**
   * The pointers this script was generated from. A script step reached with
   * different pointers is stale — see pointersChanged.
   */
  pointers?: string;
};

/** Only a real content change warrants a save (and therefore a new script row). */
export function needsTextSave(savedText: string, editedText: string): boolean {
  return editedText.trim() !== savedText.trim();
}

/**
 * The pointers step sits before the script step now, so a customer can walk
 * back and change the brief under an existing script. Changed pointers mean a
 * new script — the same rule the old "שינוי ההנחיות ויצירת תסריט חדש" link
 * enforced when both lived on one step. Whitespace-only edits don't count.
 */
export function pointersChanged(script: Pick<ScriptState, "pointers">, pointers: string): boolean {
  return (script.pointers ?? "").trim() !== pointers.trim();
}

/**
 * POST /api/scripts/[id]/text creates a NEW immutable row — every later step
 * (audio, render) must reference the returned id, never the original. A
 * b_script edit re-derives the draft hook text on the server; it rides along.
 */
export function withEditedText(
  script: ScriptState,
  response: { scriptId: string; text: string; hookText?: string },
): ScriptState {
  return {
    ...script,
    scriptId: response.scriptId,
    text: response.text,
    hookText: response.hookText ?? script.hookText,
  };
}

// ---------------------------------------------------------------------------
// Render enqueue body (wizard state -> POST /renders)
// ---------------------------------------------------------------------------

/**
 * The exact body StepRender posts. personaImageId is the selfie the persona
 * card showed — always sent, so the render animates that row and no default
 * is resolved. The hook text and rect ride along only with an opener: without
 * one there is nothing to burn them over, and a stale edit must not leak into
 * a render that has no clip (the server refuses the pair anyway).
 */
export function renderRequestBody(opts: {
  scriptId: string;
  audioId: string;
  personaId: string;
  personaImageId: string;
  hookEffect: HookEffect;
  hookText?: string;
  hookTextSafeArea?: SafeRect;
  /** The live cutaway plan, only with the option on (vault 0121); absent = the head-only ad. */
  cutawayPlanId?: string;
}): Record<string, unknown> {
  return {
    scriptId: opts.scriptId,
    audioId: opts.audioId,
    personaId: opts.personaId,
    personaImageId: opts.personaImageId,
    hookEffect: opts.hookEffect,
    ...(opts.hookEffect !== "none"
      ? {
          hookText: opts.hookText,
          ...(opts.hookTextSafeArea ? { hookTextSafeArea: opts.hookTextSafeArea } : {}),
        }
      : {}),
    ...(opts.cutawayPlanId ? { cutawayPlanId: opts.cutawayPlanId } : {}),
  };
}

// ---------------------------------------------------------------------------
// Demo cutaways (vault 0121, 0122) — the "demo" step, between the audio and the effect
// ---------------------------------------------------------------------------

/** One caption phrase as the wizard gets it (VO-time ms). */
export type CaptionChunkWire = {
  text: string;
  startMs: number;
  endMs: number;
  words: { word: string; startMs: number; endMs: number }[];
};

/** One clip as the wizard gets it (VO-time ms): its identity, when the demo
 *  covers the character, the words it covers, and where in the demo it plays from. */
export type CutawaySlotWire = {
  id: number;
  fromMs: number;
  toMs: number;
  lengthMs: number;
  wordFrom: number;
  wordTo: number;
  demoStartMs: number;
  stateIndex: number | null;
  /** The draft's pick — absent on a clip the customer added. */
  draftDemoStartMs?: number;
  draftStateIndex?: number | null;
};

/** A place a window may start — a moment of the analysed demo. */
export type CutawayAnchorWire = { startMs: number; stateIndex: number };

/** core's CutawayPlanView, mirrored (this file never imports core's main entry). */
export type CutawayPlanWire = {
  planId: string;
  audioId: string;
  demoId: string;
  structure: string;
  /** The script's hook text the plan is laid out from ('' = none). */
  hookText: string;
  /** The version an edit names; a stale one is refused. */
  updatedAt: string;
  captions: CaptionChunkWire[];
  voDurationMs: number;
  captionOffsetMs: number;
  /** Where the script first names the product (VO ms) — or, with no name heard, 40% in ("share"). */
  mentionMs: number;
  mentionMethod: "product_name" | "business_name" | "share";
  slots: CutawaySlotWire[];
  anchors: CutawayAnchorWire[];
  /** A window starts at or after minStartMs and ends (with the frame slack) by maxEndMs. */
  minStartMs: number;
  maxEndMs: number;
};

/** One clip as an edit sends it. */
export type CutawayEditWire = { id: number; fromMs: number; toMs: number; demoStartMs: number };

/** The hook text the render burns: the effect step's line, or none with "none". */
export function cutawayHookText(hookEffect: HookEffect, hookText: string): string {
  return hookEffect === "none" ? "" : hookText.trim();
}

/**
 * The plan, if it still belongs to what the wizard holds — the same approved
 * audio and the same demo. The hook text no longer makes it stale (vault
 * 0122): the clips are laid out from the script's own line, and a longer
 * final line only moves the clip it reaches (cutawaysUnderHookText).
 */
export function liveCutawayPlan(
  plan: CutawayPlanWire | null,
  audioId: string | undefined,
  demoId: string | undefined,
): CutawayPlanWire | null {
  return plan && plan.audioId === audioId && plan.demoId === demoId ? plan : null;
}

/** The plan's clips as an edit sends them. */
export function cutawayEdits(slots: CutawaySlotWire[]): CutawayEditWire[] {
  return slots.map(({ id, fromMs, toMs, demoStartMs }) => ({ id, fromMs, toMs, demoStartMs }));
}

/**
 * Where slot `index` may start, sorted: a moment whose window stays inside
 * the recording and shows none of the footage another slot shows (the others
 * at `starts`) — core's rule, so what the picker offers is what the server takes.
 */
export function cutawayStarts(plan: CutawayPlanWire, index: number, starts: number[]): number[] {
  return cutawayWindowStarts(
    plan,
    plan.slots[index]!.lengthMs,
    plan.slots.flatMap((other, j) =>
      j === index ? [] : [{ demoStartMs: starts[j]!, lengthMs: other.lengthMs }],
    ),
  );
}

/** The next valid start before (-1) or after (+1) `current`; stays put at either end. */
export function nudgeCutawayStart(valid: number[], current: number, direction: -1 | 1): number {
  const next =
    direction === 1
      ? valid.find((s) => s > current)
      : [...valid].reverse().find((s) => s < current);
  return next ?? current;
}

/** The caption words, in order — what each slot's wordFrom/wordTo index. */
export function cutawayWords(plan: CutawayPlanWire): string[] {
  return plan.captions.flatMap((c) => c.words.map((w) => w.word));
}

/** The script as runs for highlighting: consecutive words grouped by the clip
 *  (its id) they fall in — null = spoken over the character. */
export function cutawayScriptRuns(
  words: string[],
  slots: { id: number; wordFrom: number; wordTo: number }[],
): { text: string; slot: number | null }[] {
  const runs: { text: string; slot: number | null }[] = [];
  for (const [i, word] of words.entries()) {
    const slot = slots.find((s) => i >= s.wordFrom && i < s.wordTo)?.id ?? null;
    const last = runs[runs.length - 1];
    if (last && last.slot === slot) last.text += ` ${word}`;
    else runs.push({ text: word, slot });
  }
  return runs;
}

/** The state a window opens on — its thumbnail. */
export function anchorStateAt(plan: CutawayPlanWire, startMs: number): number | undefined {
  return plan.anchors.find((a) => a.startMs === startMs)?.stateIndex;
}

/** A window on the picker's track, in percent of the whole recording (LTR). */
export function cutawayTrackBox(
  plan: CutawayPlanWire,
  startMs: number,
  lengthMs: number,
): { left: number; width: number } {
  const recordingMs = plan.maxEndMs + plan.minStartMs;
  return { left: (100 * startMs) / recordingMs, width: (100 * lengthMs) / recordingMs };
}

/** `count` moments spread evenly through the recording, by time — the picker
 *  track's filmstrip. Fewer when the demo has fewer moments. */
export function filmstripStates(plan: CutawayPlanWire, count: number): number[] {
  const recordingMs = plan.maxEndMs + plan.minStartMs;
  const picked: number[] = [];
  for (let i = 0; i < count; i++) {
    const target = ((i + 0.5) * recordingMs) / count;
    let best: CutawayAnchorWire | undefined;
    for (const anchor of plan.anchors) {
      if (!best || Math.abs(anchor.startMs - target) < Math.abs(best.startMs - target))
        best = anchor;
    }
    if (best && !picked.includes(best.stateIndex)) picked.push(best.stateIndex);
  }
  return picked;
}

/** Seconds with one decimal, for a slot's length ("5.4"). */
export function cutawaySeconds(lengthMs: number): string {
  return (Math.round(lengthMs / 100) / 10).toFixed(1);
}

// --- Identity: one letter and one colour per clip, everywhere (vault 0122) ---

const CUTAWAY_LETTERS = ["א", "ב", "ג", "ד", "ה", "ו", "ז", "ח"] as const;

/**
 * A clip's colour on the script, its card, its chip and the picker's track —
 * whole class names, so Tailwind finds them in the source. Eight, one per id
 * (core caps a plan at CUTAWAY_MAX_SLOTS).
 */
const CUTAWAY_COLOURS = [
  {
    mark: "bg-lime-200",
    chip: "bg-lime-500 text-ink",
    edge: "border-s-lime-500",
    ring: "border-lime-500",
    track: "bg-lime-500/80 text-ink",
    window: "border-lime-500 bg-lime-500/20",
  },
  {
    mark: "bg-sky-200",
    chip: "bg-sky-700 text-white",
    edge: "border-s-sky-700",
    ring: "border-sky-700",
    track: "bg-sky-700/85 text-white",
    window: "border-sky-700 bg-sky-700/20",
  },
  {
    mark: "bg-amber-200",
    chip: "bg-amber-500 text-ink",
    edge: "border-s-amber-500",
    ring: "border-amber-500",
    track: "bg-amber-500/80 text-ink",
    window: "border-amber-500 bg-amber-500/20",
  },
  {
    mark: "bg-pink-200",
    chip: "bg-pink-700 text-white",
    edge: "border-s-pink-700",
    ring: "border-pink-700",
    track: "bg-pink-700/85 text-white",
    window: "border-pink-700 bg-pink-700/20",
  },
  {
    mark: "bg-violet-200",
    chip: "bg-violet-700 text-white",
    edge: "border-s-violet-700",
    ring: "border-violet-700",
    track: "bg-violet-700/85 text-white",
    window: "border-violet-700 bg-violet-700/20",
  },
  {
    mark: "bg-teal-200",
    chip: "bg-teal-700 text-white",
    edge: "border-s-teal-700",
    ring: "border-teal-700",
    track: "bg-teal-700/85 text-white",
    window: "border-teal-700 bg-teal-700/20",
  },
  {
    mark: "bg-orange-200",
    chip: "bg-orange-700 text-white",
    edge: "border-s-orange-700",
    ring: "border-orange-700",
    track: "bg-orange-700/85 text-white",
    window: "border-orange-700 bg-orange-700/20",
  },
  {
    mark: "bg-slate-300",
    chip: "bg-slate-700 text-white",
    edge: "border-s-slate-700",
    ring: "border-slate-700",
    track: "bg-slate-700/85 text-white",
    window: "border-slate-700 bg-slate-700/20",
  },
] as const;

export type CutawayColour = (typeof CUTAWAY_COLOURS)[number];

/** A clip's letter ("א") — its name on every surface; the copy adds the geresh. */
export function cutawayLetter(id: number): string {
  return CUTAWAY_LETTERS[(id - 1) % CUTAWAY_LETTERS.length]!;
}

export function cutawayColour(id: number): CutawayColour {
  return CUTAWAY_COLOURS[(id - 1) % CUTAWAY_COLOURS.length]!;
}

/** The id a new clip takes: the smallest free one, so the letters stay א, ב, ג; none past the cap. */
export function nextCutawayId(slots: { id: number }[]): number | undefined {
  for (let id = 1; id <= CUTAWAY_MAX_SLOTS; id++) {
    if (!slots.some((s) => s.id === id)) return id;
  }
  return undefined;
}

// --- Moving and adding (vault 0122): on a tapped phrase, never a model call ---

/** The script as phrases — the caption lines a tap chooses a clip's start from. */
export function cutawayPhrases(
  plan: CutawayPlanWire,
): { startMs: number; text: string; wordFrom: number; wordTo: number }[] {
  let word = 0;
  return plan.captions.map((c) => {
    const wordFrom = word;
    word += c.words.length;
    return {
      startMs: c.startMs,
      text: c.words.map((w) => w.word).join(" "),
      wordFrom,
      wordTo: word,
    };
  });
}

/** When the script's hook text leaves (VO ms): no clip is placed before it. */
export function scriptHookLeaveMs(plan: CutawayPlanWire): number {
  return hookLeaveVoMs(plan.hookText, plan.captions, plan.captionOffsetMs);
}

const footprintEnd = (startMs: number, lengthMs: number) =>
  startMs + lengthMs + CUTAWAY_FRAME_SLACK_MS;

/**
 * Where a clip lands when the customer taps the phrase starting at
 * `phraseStartMs`: `moving` is the clip being moved (null = a new one). Its
 * end is the cut point 4–6 s on nearest its own length (a new clip: the
 * structure's target), before the next clip; a moved clip keeps its window
 * when it still fits, else the nearest that does; a new one takes the next
 * unused stretch of the demo after the clip before it in the script. Null:
 * the phrase cannot hold it — under the hook text, inside another clip, too
 * close to the next one or the end, or no footage left.
 */
export function placeCutawayAt(
  plan: CutawayPlanWire,
  moving: CutawaySlotWire | null,
  phraseStartMs: number,
): CutawayEditWire | null {
  const others = plan.slots.filter((s) => s.id !== moving?.id);
  if (phraseStartMs < scriptHookLeaveMs(plan)) return null;
  if (others.some((o) => phraseStartMs >= o.fromMs && phraseStartMs < o.toMs)) return null;
  const limitMs = Math.min(
    plan.voDurationMs,
    ...others.filter((o) => o.fromMs > phraseStartMs).map((o) => o.fromMs),
  );
  const toMs = fitCutawayAt(plan.captions, phraseStartMs, {
    limitMs,
    preferMs: moving ? moving.lengthMs : CUTAWAY_ALTERNATE.cut.targetMs,
  });
  if (toMs === null) return null;
  const lengthMs = toMs - phraseStartMs;
  const valid = cutawayWindowStarts(
    plan,
    lengthMs,
    others.map((o) => ({ demoStartMs: o.demoStartMs, lengthMs: o.lengthMs })),
  );
  let demoStartMs: number | undefined;
  if (moving) {
    demoStartMs = valid.includes(moving.demoStartMs)
      ? moving.demoStartMs
      : snapCutawayStart(valid, moving.demoStartMs);
  } else {
    // The next unused stretch: after the footage of the clip before it in the script.
    const before = others.filter((o) => o.fromMs < phraseStartMs).at(-1);
    const after = before ? footprintEnd(before.demoStartMs, before.lengthMs) : plan.minStartMs;
    demoStartMs = valid.find((s) => s >= after) ?? valid[0];
  }
  if (demoStartMs === undefined) return null;
  return {
    id: moving?.id ?? nextCutawayId(plan.slots) ?? 0,
    fromMs: phraseStartMs,
    toMs,
    demoStartMs,
  };
}

/**
 * A head run past ~5 s after the product mention — the one-line note, never a
 * block (founder, 2026-10-21: "inform, never restrict"). Each stretch of the
 * character counted only from the mention on; longer than the draft's soft
 * max (5.5 s), so a draft never trips its own note. No clips at all is today's
 * head-only ad, not a long run.
 */
export function longHeadRuns(
  plan: CutawayPlanWire,
): { afterId: number | null; beforeId: number | null; ms: number }[] {
  const slots = [...plan.slots].sort((a, b) => a.fromMs - b.fromMs);
  if (slots.length === 0) return [];
  const runs: { afterId: number | null; beforeId: number | null; ms: number }[] = [];
  for (let i = 0; i <= slots.length; i++) {
    const prevEnd = i === 0 ? 0 : slots[i - 1]!.toMs;
    const startMs = Math.max(prevEnd, plan.mentionMs);
    const endMs = i === slots.length ? plan.voDurationMs : slots[i]!.fromMs;
    if (endMs - startMs > CUTAWAY_ALTERNATE.head.softMaxMs) {
      runs.push({
        // A run that began before the mention is counted, and named, from the mention.
        afterId: i === 0 || prevEnd < plan.mentionMs ? null : slots[i - 1]!.id,
        beforeId: i === slots.length ? null : slots[i]!.id,
        ms: endMs - startMs,
      });
    }
  }
  return runs;
}

/**
 * The clips the render will play under the FINAL hook text — core's
 * clearHookText, the same function enqueue runs: a clip a longer line reaches
 * moves to the next phrase after it, or drops. Derived, never saved.
 */
export function cutawaysUnderHookText(
  plan: CutawayPlanWire,
  hookText: string,
): { slots: CutawaySlotWire[]; moved: number[]; dropped: number[] } {
  return clearHookText(plan.slots, {
    captions: plan.captions,
    voDurationMs: plan.voDurationMs,
    hookLeaveVoMs: hookLeaveVoMs(hookText, plan.captions, plan.captionOffsetMs),
    footage: plan,
  });
}

/**
 * COPY PENDING FOUNDER REVIEW — every customer-facing string of the cutaway
 * option (vault 0121, 0122), in one place, so the step components stay dumb
 * renderers and the founder approves one block. A clip's name is its letter
 * with a geresh ("קטע א׳").
 */
export const CUTAWAY_COPY = {
  optIn: "לשלב קטעים מסרטון המוצר",
  optInHint:
    "באמצע הסרטון עוברים לכמה שניות לקטעים מסרטון המוצר שלכם. הקול והכתוביות ממשיכים כרגיל, בלי הסאונד של סרטון המוצר.",
  stepTitle: "קטעים מהמוצר",
  pickTitle: "מאיזה סרטון לקחת את הקטעים?",
  pickSub: "בוחרים סרטון מוצר שכבר העליתם, או מעלים חדש.",
  analysingSub: "סרטון חדש עובר ניתוח פעם אחת, ואחר כך נשבץ ממנו קטעים.",
  drafting: "משבצים קטעים מסרטון המוצר…",
  slotsTitle: "קטעים מסרטון המוצר",
  slotsSub:
    "בזמן המילים הצבועות רואים קטע מסרטון המוצר. שיבצנו קטעים לפי סדר הסרטון, ואפשר להחליף, להעביר, להוסיף ולהסיר.",
  clipName: (letter: string) => `קטע ${letter}׳`,
  slotLabel: (letter: string, seconds: string) => `קטע ${letter}׳ · ${seconds} שנ׳`,
  changeWindow: "החלפה",
  move: "העברה",
  remove: "הסרה",
  add: "הוספת קטע",
  pickMove: (letter: string) => `בוחרים את המשפט שבו קטע ${letter}׳ יתחיל.`,
  pickAdd: "בוחרים את המשפט שבו הקטע החדש יתחיל.",
  pickNone: "אין משפט פנוי שהקטע נכנס בו.",
  emptyCanAdd: "אין כרגע קטעים בסרטון. אפשר להוסיף קטע בכל משפט, או להמשיך בלי קטעים.",
  emptyNoFootage: "אין מקום לקטעים בסרטון המוצר הזה. אפשר להחליף סרטון או להמשיך בלי קטעים.",
  longRun: (
    where: { after: string | null; before: string | null; byName: boolean },
    seconds: string,
  ) => {
    // A run counted from the mention says so; with no name heard, "the middle of the recording".
    const from = where.byName ? "מהרגע שהמוצר מוזכר" : "מאמצע ההקלטה";
    const span =
      where.after === null && where.before === null
        ? `${from} ועד הסוף`
        : where.after === null
          ? `${from} ועד קטע ${where.before}׳`
          : where.before === null
            ? `מסוף קטע ${where.after}׳ ועד הסוף`
            : `בין קטע ${where.after}׳ לקטע ${where.before}׳`;
    return `רק לתשומת לב: ${span} הדמות מדברת ${seconds} שנ׳ ברצף.`;
  },
  hookMoved: (letter: string) =>
    `משפט הפתיחה מגיע עכשיו עד קטע ${letter}׳, אז הקטע זז למשפט הפנוי הבא אחריו.`,
  hookDropped: (letter: string) =>
    `משפט הפתיחה ארוך יותר עכשיו, ואין אחריו משפט שקטע ${letter}׳ נכנס בו — הוא לא ייכנס לסרטון.`,
  play: "צפייה בקטע",
  pickerTitle: (letter: string) => `קטע ${letter}׳`,
  pickerSub: "מזיזים את המסגרת לאורך סרטון המוצר. מה שבתוכה יופיע בזמן המילים הצבועות.",
  slider: "מיקום הקטע בסרטון המוצר",
  earlier: "קצת קודם",
  later: "קצת אחר כך",
  save: "שמירה",
  cancel: "ביטול",
  continue: "המשך",
  skip: "המשך בלי קטעים",
  changeDemo: "החלפת הסרטון",
  saveFailed: "לא הצלחנו לשמור את הקטע — נסו שוב.",
  analysisFailed: "ניתוח הסרטון נכשל — נסו סרטון אחר.",
} as const;

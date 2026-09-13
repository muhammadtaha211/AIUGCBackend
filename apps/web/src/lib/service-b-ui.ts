import { countScriptWords, MAX_B_SCRIPT_WORDS } from "@aiugc/core/b-script-words";
import type { HookEffect } from "@aiugc/core/hook-effect";
import type { SafeRect } from "@aiugc/core/hook-geometry";
import { HOOK_TEXT_MAX_CHARS, HOOK_TEXT_MAX_WORDS, hookTextError } from "@aiugc/core/hook-text";

/**
 * Pure, client-safe helpers for the homepage and the Service B wizard.
 * No imports from @aiugc/core's main entry — this file is bundled into
 * client components, and core drags in server-only dependencies. The
 * "b-script-words", "hook-effect", "hook-geometry" and "hook-text" subpaths
 * are the deliberate exceptions (pure constants and validation, the same
 * kind service-a-ui.ts leans on). Keep this list exact: a stale allowlist
 * stops reading as a rule.
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

/** Which pipeline made it — the library labels each tile, the strip doesn't. */
export const SERVICE_LABELS: Record<"a" | "b", string> = {
  a: "הוק + דמו",
  b: "דמות AI",
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
  service: "a" | "b";
  status: string;
  createdAt: string;
  /** Signed only after release — the customer never sees a render pre-QC. */
  thumbUrl?: string;
  /** Failed renders only; true when the credits were actually returned. */
  refunded?: boolean;
  /** The head in-flight row only, and only in the strip's shape — the library
   *  is a list of finished work, not a live indicator (see pickActiveHead). */
  job?: import("./service-a-ui").JobProgressWire;
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

export type WizardStep = "persona" | "pointers" | "script" | "audio" | "effect" | "render";

/**
 * One flow for every business: the persona is one look in one setting, so
 * there is no image step, and physical products are out of Service B, so
 * there is no composite step (vault 0017). The effect step is where the
 * customer picks a hook animation — or none — and edits the on-screen hook
 * text it burns (vault 0024; it offered opener clips until 2026-09-06).
 */
export function wizardSteps(): WizardStep[] {
  return ["persona", "pointers", "script", "audio", "effect", "render"];
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
  };
}

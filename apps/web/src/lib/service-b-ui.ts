/**
 * Pure, client-safe helpers for the homepage and the Service B wizard.
 * No imports from @aiugc/core here — this file is bundled into client
 * components, and core drags in server-only dependencies.
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
// Wizard steps (visibility is category-driven)
// ---------------------------------------------------------------------------

export type WizardStep = "persona" | "image" | "composite" | "script" | "audio" | "render";

/**
 * The composite step exists only for physical products; it is skippable inside
 * the step itself. The image (background) step skips itself silently when the
 * persona has no background images.
 */
export function wizardSteps(category: string | undefined): WizardStep[] {
  return category === "physical_product"
    ? ["persona", "image", "composite", "script", "audio", "render"]
    : ["persona", "image", "script", "audio", "render"];
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

/** A kind='background' reference image of the selected persona. */
export type PersonaImage = { id: string; label?: string; imageUrl: string };

export type CompositeState = {
  id: string;
  status: string; // queued | generating | ready | failed
  previewUrl?: string;
  error?: string;
  approved: boolean;
};

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

export type RenderState = {
  id: string;
  status: string;
  videoUrl?: string;
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

/** Mirrors core's assertWithinWordBudget counting: whitespace-separated tokens. */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export type ScriptState = { scriptId: string; text: string; wordBudget?: number };

/** Only a real content change warrants a save (and therefore a new script row). */
export function needsTextSave(savedText: string, editedText: string): boolean {
  return editedText.trim() !== savedText.trim();
}

/**
 * POST /api/scripts/[id]/text creates a NEW immutable row — every later step
 * (audio, render) must reference the returned id, never the original.
 */
export function withEditedText(
  script: ScriptState,
  response: { scriptId: string; text: string },
): ScriptState {
  return { ...script, scriptId: response.scriptId, text: response.text };
}

// ---------------------------------------------------------------------------
// Render enqueue body (wizard state -> POST /renders)
// ---------------------------------------------------------------------------

/**
 * The exact body StepRender posts. personaImageId is the background chosen in
 * the image step; absent means the persona's default image at render time.
 */
export function renderRequestBody(opts: {
  scriptId: string;
  audioId: string;
  personaId: string;
  personaImageId?: string;
  compositeId?: string;
}): Record<string, string> {
  return {
    scriptId: opts.scriptId,
    audioId: opts.audioId,
    personaId: opts.personaId,
    ...(opts.personaImageId ? { personaImageId: opts.personaImageId } : {}),
    ...(opts.compositeId ? { compositeId: opts.compositeId } : {}),
  };
}

// ---------------------------------------------------------------------------
// Product photo validation (client-side copy)
// ---------------------------------------------------------------------------

/**
 * Duplicates the server rules in src/lib/service-b.ts (photoError) — that file
 * imports @aiugc/core and must stay out of the client bundle. The server
 * re-validates every upload; this only saves a round-trip.
 */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function clientPhotoError(photo: { type: string; size: number }): string | null {
  if (!PHOTO_TYPES.includes(photo.type)) return "אפשר להעלות רק תמונה בפורמט JPG, PNG או WebP.";
  if (photo.size === 0) return "הקובץ שהועלה ריק.";
  if (photo.size > MAX_PHOTO_BYTES) return "התמונה גדולה מדי — המקסימום הוא 10MB.";
  return null;
}

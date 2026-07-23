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

export type WizardStep = "persona" | "composite" | "script" | "audio" | "render";

/** The composite step exists only for physical products; it is skippable inside the step itself. */
export function wizardSteps(category: string | undefined): WizardStep[] {
  return category === "physical_product"
    ? ["persona", "composite", "script", "audio", "render"]
    : ["persona", "script", "audio", "render"];
}

// ---------------------------------------------------------------------------
// Wizard state carried across steps (owned by BWizard, edited by the steps)
// ---------------------------------------------------------------------------

export type Persona = { id: string; name: string; imageUrl: string };

export type CompositeState = {
  id: string;
  status: string; // queued | generating | ready | failed
  previewUrl?: string;
  error?: string;
  approved: boolean;
};

export type AudioState = {
  id: string;
  /** The script this audio was generated for — a newer scriptId invalidates it. */
  scriptId: string;
  status: string; // queued | generating | ready | failed
  audioUrl?: string;
  approved: boolean;
};

export type RenderState = { id: string; status: string; videoUrl?: string };

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

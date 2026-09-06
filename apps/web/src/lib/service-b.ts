import { z } from "zod";
import { textSafeAreaSchema } from "@aiugc/core/hook-geometry";

/**
 * Pure, unit-testable parts of the Service B HTTP layer: request body schemas,
 * the persona image and opener selection, the render-source checks, and the
 * ownership decision. Route handlers (src/app/api) wire these to auth + DB.
 */

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

export const scriptRequestSchema = z.object({
  personaId: z.string().uuid(),
  durationPreset: z.union([z.literal(15), z.literal(30)]),
  pointers: z.string().max(500).optional(),
});

export const scriptTextSchema = z.object({ text: z.string().trim().min(1) });

export const renderRequestSchema = z
  .object({
    scriptId: z.string().uuid(),
    audioId: z.string().uuid(),
    personaId: z.string().uuid(),
    /** The selfie the persona card showed (Persona.personaImageId). Required:
     *  nothing on the customer path resolves a default at render time. */
    personaImageId: z.string().uuid(),
    /** An opener clip of that selfie, with the FINAL on-screen line and,
     *  when the customer moved it, the rect it sits in. */
    openerClipId: z.string().uuid().optional(),
    hookText: z.string().trim().min(1).optional(),
    hookTextSafeArea: textSafeAreaSchema.optional(),
  })
  // The opener and its text come together or not at all, and a rect without
  // an opener has nothing to sit on — the same rule createBRender throws on,
  // caught here as a 400 instead.
  .refine((body) =>
    body.openerClipId === undefined
      ? body.hookText === undefined && body.hookTextSafeArea === undefined
      : body.hookText !== undefined,
  );

/** Pre-confirm quote lookup — the render's price comes from the approved audio. */
export const renderPreviewRequestSchema = z.object({ audioId: z.string().uuid() });

export function isUuid(value: string): boolean {
  return z.string().uuid().safeParse(value).success;
}

// ---------------------------------------------------------------------------
// Persona image selection (avatar-card thumbnail + the Service B render source)
// ---------------------------------------------------------------------------

type StoredImage = { kind: string; filePath: string; retired: boolean };
type PersonaImageRow = StoredImage & { isDefault: boolean; createdAt: Date };

/** Which wizard is asking: the two pick different images off the same rows. */
export type CatalogService = "a" | "b";

/**
 * A stranded "pending" placeholder (no "/" in file_path — a crashed
 * `persona add-image`) must never be signed, and a retired image is out of
 * every picker. Same guards as core's lipsync default-image resolution.
 */
function isUsable(image: StoredImage): boolean {
  return image.filePath.includes("/") && !image.retired;
}

function newestFirst<T extends PersonaImageRow>(images: T[]): T[] {
  return [...images].filter(isUsable).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * THE Service B image of a persona: the default kind='selfie' image, else the
 * newest usable selfie, else none. One resolver for the card thumbnail, the
 * opener list and the render source, so all three land on the same row —
 * the card can never show one selfie while the render animates another. A
 * persona without one is not renderable by Service B and is excluded from
 * its catalog. is_default only breaks ties between selfies; a standing
 * default is never picked.
 */
export function personaSelfie<T extends PersonaImageRow>(images: T[]): T | undefined {
  const selfies = newestFirst(images).filter((image) => image.kind === "selfie");
  return selfies.find((image) => image.isDefault) ?? selfies[0];
}

/**
 * Avatar-card thumbnail. Service A (the hook-gallery speaker): kind='preview'
 * -> is_default -> newest — the card is a portrait, nothing renders from it.
 * Service B: personaSelfie, because the card IS the render source.
 */
export function personaThumbnail<T extends PersonaImageRow>(
  images: T[],
  service: CatalogService,
): T | undefined {
  if (service === "b") return personaSelfie(images);
  const usable = newestFirst(images);
  return (
    usable.find((image) => image.kind === "preview") ??
    usable.find((image) => image.isDefault) ??
    usable[0]
  );
}

/**
 * The opener list for one persona: the ACTIVE clips made from
 * personaSelfie(images) — the row the card shows and the render animates.
 * Clips of any other image of the persona (a retired selfie, a standing
 * default, a newer non-default selfie) are not offered, whatever is_default
 * says: an opener ends on the frame of the selfie it was made from, and it
 * is only a transition if the talking head starts on that same frame.
 */
export function personaOpeners<
  I extends PersonaImageRow & { id: string },
  C extends { personaImageId: string; active: boolean },
>(images: I[], clips: C[]): C[] {
  const selfie = personaSelfie(images);
  if (!selfie) return [];
  return clips.filter((clip) => clip.active && clip.personaImageId === selfie.id);
}

// ---------------------------------------------------------------------------
// Render source checks (POST /renders): the card's image, and its opener
// ---------------------------------------------------------------------------

export type RouteRefusal = { status: 400 | 404; error: string };

/**
 * Why `image` cannot be the source of a Service B render for `personaId`.
 * createBRender takes an explicit personaImageId on trust — its selfie guard
 * covers only a resolved default, so the founder's CLI can render any image —
 * which makes the customer route the place where the card's image is held to
 * the format: this persona's, a selfie, stored, not retired.
 */
export function renderSourceError(
  image: { personaId: string; kind: string; filePath: string; retired: boolean } | undefined,
  personaId: string,
): RouteRefusal | undefined {
  if (!image) return { status: 404, error: "תמונת הדמות לא נמצאה." };
  if (image.personaId !== personaId) {
    return { status: 400, error: "התמונה לא שייכת לדמות הזאת." };
  }
  if (image.kind !== "selfie") {
    return { status: 400, error: "אפשר ליצור סרטון רק מתמונת סלפי של הדמות." };
  }
  if (image.retired) return { status: 400, error: "התמונה הזאת הוסרה — בחרו את הדמות מחדש." };
  if (!image.filePath.includes("/")) {
    return { status: 400, error: "תמונת הדמות עדיין לא מוכנה — נסו שוב בעוד רגע." };
  }
  return undefined;
}

/** Why `opener` cannot play in front of a talking head animated from `personaImageId`. */
export function renderOpenerError(
  opener: { personaImageId: string; active: boolean } | undefined,
  personaImageId: string,
): RouteRefusal | undefined {
  if (!opener) return { status: 404, error: "אפקט הפתיחה לא נמצא." };
  if (!opener.active) return { status: 400, error: "אפקט הפתיחה הזה כבר לא זמין — בחרו אחר." };
  if (opener.personaImageId !== personaImageId) {
    return { status: 400, error: "אפקט הפתיחה לא שייך לתמונת הדמות הזאת." };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Ownership: core writes bypass RLS, so every route decides access explicitly.
// ---------------------------------------------------------------------------

export type BusinessAccess = "ok" | "forbidden" | "missing";

export function businessAccess(
  business: { ownerUserId: string } | undefined,
  requester: { id: string; role: "customer" | "admin" } | undefined,
): BusinessAccess {
  if (!business) return "missing";
  if (!requester) return "forbidden";
  if (requester.role === "admin") return "ok";
  return business.ownerUserId === requester.id ? "ok" : "forbidden";
}

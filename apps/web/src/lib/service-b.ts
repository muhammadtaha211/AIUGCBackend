import { z } from "zod";
import { questionnaireSchema } from "@aiugc/core";

/**
 * Pure, unit-testable parts of the Service B HTTP layer: request body schemas,
 * the ownership decision, the composite category guard, and product photo
 * validation. Route handlers (src/app/api) wire these to auth + DB.
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

export const renderRequestSchema = z.object({
  scriptId: z.string().uuid(),
  audioId: z.string().uuid(),
  personaId: z.string().uuid(),
  /** Explicit persona reference image chosen in the background step. */
  personaImageId: z.string().uuid().optional(),
  compositeId: z.string().uuid().optional(),
});

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

/** The background picker shows only stored, non-retired kind='background' images. */
export function backgroundImages<T extends StoredImage>(images: T[]): T[] {
  return images.filter((image) => image.kind === "background" && isUsable(image));
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

// ---------------------------------------------------------------------------
// Composite guards (physical products only; sane photo uploads)
// ---------------------------------------------------------------------------

export function canUseComposites(questionnaire: unknown): boolean {
  const parsed = questionnaireSchema.safeParse(questionnaire);
  return parsed.success && parsed.data.category === "physical_product";
}

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** MIME -> extension for the stored product photo; also the allowlist. */
export const PHOTO_EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

/** Hebrew validation error for an uploaded product photo, or null when fine. */
export function photoError(photo: { type: string; size: number }): string | null {
  if (!PHOTO_EXTENSIONS[photo.type]) return "אפשר להעלות רק תמונה בפורמט JPG, PNG או WebP.";
  if (photo.size === 0) return "הקובץ שהועלה ריק.";
  if (photo.size > MAX_PHOTO_BYTES) return "התמונה גדולה מדי — המקסימום הוא 10MB.";
  return null;
}

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

export function isUuid(value: string): boolean {
  return z.string().uuid().safeParse(value).success;
}

// ---------------------------------------------------------------------------
// Persona image selection (avatar-card thumbnail + background picker)
// ---------------------------------------------------------------------------

type PersonaImageRow = { kind: string; filePath: string };

/**
 * A stranded "pending" placeholder (no "/" in file_path — a crashed
 * `persona add-image`) must never be signed. Same guard as core's lipsync
 * default-image resolution.
 */
function isStored(image: PersonaImageRow): boolean {
  return image.filePath.includes("/");
}

/** Avatar-card thumbnail preference: kind='preview' -> is_default -> newest. */
export function personaThumbnail<
  T extends PersonaImageRow & { isDefault: boolean; createdAt: Date },
>(images: T[]): T | undefined {
  const newestFirst = [...images]
    .filter(isStored)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return (
    newestFirst.find((image) => image.kind === "preview") ??
    newestFirst.find((image) => image.isDefault) ??
    newestFirst[0]
  );
}

/** The background picker shows only stored kind='background' images. */
export function backgroundImages<T extends PersonaImageRow>(images: T[]): T[] {
  return images.filter((image) => image.kind === "background" && isStored(image));
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

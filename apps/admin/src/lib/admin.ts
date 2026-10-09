import type { PersonaImageKind } from "@aiugc/core";
import { z } from "zod";

/**
 * Pure, unit-testable parts of the founder admin area: the role gate decision,
 * request body schemas, and reference-image upload validation. Route handlers
 * (src/app/api/admin) wire these to auth + DB.
 */

// ---------------------------------------------------------------------------
// Role gate: users.role='admin' is the only admin authority.
// ---------------------------------------------------------------------------

export type AdminAccess = "ok" | "forbidden";

/** No session user, no users row, or role!='admin' → forbidden. */
export function adminAccess(requester: { role: "customer" | "admin" } | undefined): AdminAccess {
  return requester?.role === "admin" ? "ok" : "forbidden";
}

/**
 * Whether an `auth.getUser()` error means the read FAILED, as opposed to
 * answering "no valid session". auth-js populates `error` for both: measured
 * 2026-09-10 against @supabase/auth-js 2.110.6, a request with no cookies
 * resolves AuthSessionMissingError (status 400) and a bad JWT resolves
 * AuthApiError (403) — those are verdicts. Only a non-Response failure or a
 * 500-599 (AuthRetryableFetchError) and an unparseable body (AuthUnknownError)
 * leave the question open. See lib/fetch.ts handleError, and the apps/web twin
 * of this function in apps/web/src/lib/auth-user.ts, which carries the full
 * measured table.
 * docs/vault/defects/auth-getuser-errors-read-as-signed-out.md
 *
 * Duplicated rather than shared: apps/admin and apps/web have no common
 * package, and a package for one predicate is not worth the moving part.
 */
const COULD_NOT_TELL = ["AuthRetryableFetchError", "AuthUnknownError"];

export function authReadFailed(
  // Both optional: the discriminator is `name`, but a parameter that declares
  // ONLY an optional property is a weak type, and TypeScript then refuses any
  // error object that happens not to carry a name — which is exactly the shape
  // a hand-written double has.
  error: { name?: string; message?: string } | null | undefined,
): boolean {
  return error != null && COULD_NOT_TELL.includes(error.name ?? "");
}

/** Route params arrive as raw strings — anything not a UUID is a plain 404. */
export function isUuid(value: string): boolean {
  return z.string().uuid().safeParse(value).success;
}

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

export const createPersonaSchema = z.object({
  name: z.string().trim().min(1),
  /** Blank or absent = no voice: a character for גוש טקסט alone (0055, decision 0099 R1). */
  voiceId: z
    .string()
    .trim()
    .nullish()
    .transform((value) => value || null),
  gender: z.enum(["female", "male"]),
});

/** One PATCH per persona edit: any subset of name, voice id, gender. */
export const personaPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    voiceId: z.string().trim().min(1).max(120).optional(),
    gender: z.enum(["female", "male"]).optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: "empty patch",
  });

export const grantSchema = z.object({
  userId: z.string().uuid(),
  credits: z.number().int().positive(),
  note: z.string().trim().min(1).max(500),
});

export const roleChangeSchema = z.object({
  role: z.enum(["customer", "admin"]),
});

/** Lockout prevention: the session admin can never change their own role. */
export function canChangeRole(sessionUserId: string, targetUserId: string): boolean {
  return sessionUserId !== targetUserId;
}

/**
 * The persona-image kinds. ONE list: it feeds both schemas below AND the
 * options both admin selects render, so the offered set and the accepted set
 * cannot disagree. `satisfies` ties it to core's PersonaImageKind
 * (packages/core/src/pipelines/bank.ts) so the two cannot silently drift: a
 * kind core drops fails here, and a kind core adds is a missing key on the
 * labels Record below. 'selfie' is the Service B render source — without it
 * settable from the admin app a character needs SQL to finish.
 */
export const PERSONA_IMAGE_KINDS = [
  "preview",
  "background",
  "selfie",
] as const satisfies readonly PersonaImageKind[];

/** Badge and select vocabulary, shared by the image card and the upload form. */
export const PERSONA_IMAGE_KIND_LABELS: Record<PersonaImageKind, string> = {
  preview: "תצוגה",
  background: "רקע",
  selfie: "סלפי",
};

/**
 * The optional `kind` field on the images upload form. Absent, null or "" →
 * undefined, so addPersonaImage omits the column and its 'background' default
 * (0009_persona_image_kind.sql) still applies; anything else must be a known
 * kind. Raw FormData values arrive as `File | string | null`.
 */
export const uploadKindSchema = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.enum(PERSONA_IMAGE_KINDS).optional(),
);

/** One PATCH per image action: label edit, kind change, retire, make-default. */
export const imagePatchSchema = z
  .object({
    label: z.string().trim().max(200).nullable().optional(),
    kind: z.enum(PERSONA_IMAGE_KINDS).optional(),
    retired: z.boolean().optional(),
    makeDefault: z.literal(true).optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: "empty patch",
  });

// ---------------------------------------------------------------------------
// Reference-image upload validation. The client downscales and center-crops to
// exactly 1080x1920 before submitting, but the server never trusts it — the
// dimensions are parsed from the actual bytes (JPEG SOF / PNG IHDR; no image
// library, no temp files).
// ---------------------------------------------------------------------------

export const REFERENCE_IMAGE = { width: 1080, height: 1920 } as const;

export type ImageInfo = { width: number; height: number; extension: ".jpg" | ".png" };

export function imageDimensions(bytes: Uint8Array): ImageInfo | null {
  // PNG: 8-byte signature, then the IHDR chunk with width/height at 16/20.
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return { width: readU32(bytes, 16), height: readU32(bytes, 20), extension: ".png" };
  }
  // JPEG: walk the marker segments to a start-of-frame (SOF0–SOF15, minus the
  // non-frame markers DHT/JPG/DAC that share the 0xC0 nibble).
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1]!;
      if (marker === 0xff) {
        offset += 1; // fill byte before a marker
        continue;
      }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
        offset += 2; // standalone marker, no length field
        continue;
      }
      const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isFrame) {
        return {
          height: (bytes[offset + 5]! << 8) | bytes[offset + 6]!,
          width: (bytes[offset + 7]! << 8) | bytes[offset + 8]!,
          extension: ".jpg",
        };
      }
      offset += 2 + ((bytes[offset + 2]! << 8) | bytes[offset + 3]!);
    }
  }
  return null;
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

/** Hebrew validation error for an uploaded reference image, or null when fine. */
export function referenceImageError(bytes: Uint8Array): string | null {
  if (bytes.length === 0) return "הקובץ שהועלה ריק.";
  const info = imageDimensions(bytes);
  if (!info) return "הקובץ אינו תמונת JPG או PNG תקינה.";
  if (info.width !== REFERENCE_IMAGE.width || info.height !== REFERENCE_IMAGE.height) {
    return `התמונה חייבת להיות בדיוק 1080×1920 — התקבל ${info.width}×${info.height}.`;
  }
  return null;
}

/**
 * The source rectangle that center-crops a (dstW:dstH)-aspect region out of a
 * srcW×srcH image — the canvas drawImage math the upload client uses.
 */
export function coverCrop(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const scale = Math.max(dstW / srcW, dstH / srcH);
  const sw = dstW / scale;
  const sh = dstH / scale;
  return { sx: (srcW - sw) / 2, sy: (srcH - sh) / 2, sw, sh };
}

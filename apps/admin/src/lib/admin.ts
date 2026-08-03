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

/** Route params arrive as raw strings — anything not a UUID is a plain 404. */
export function isUuid(value: string): boolean {
  return z.string().uuid().safeParse(value).success;
}

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

export const createPersonaSchema = z.object({
  name: z.string().trim().min(1),
  voiceId: z.string().trim().min(1),
  gender: z.enum(["female", "male"]),
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

/** One PATCH per image action: label edit, kind toggle, retire, make-default. */
export const imagePatchSchema = z
  .object({
    label: z.string().trim().max(200).nullable().optional(),
    kind: z.enum(["preview", "background"]).optional(),
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

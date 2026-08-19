import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getEnv } from "./config";
import { PermanentError } from "./jobs/errors";
import { logger } from "./logger";
import { LOCAL_STORAGE_DIR } from "./paths";

/**
 * Three private buckets (docs/03-storage.md):
 * - raw:     user uploads as-is (deleted 30 days after normalization)
 * - assets:  normalized demos, hook bank, persona clips, thumbnails
 * - renders: audio previews and video outputs (retention per app_config)
 * Plus ONE public bucket:
 * - catalog: copies of persona catalog images (founder-curated, readable by
 *   any signed-in user per 0007's RLS) — stable cacheable URLs. Nothing
 *   business-scoped ever goes here.
 */
export type Bucket = "raw" | "assets" | "renders" | "catalog";

/**
 * supabase-js defaults Buffer uploads to text/plain;charset=UTF-8, which
 * providers that check Content-Type on the signed URL (HeyGen) reject. Every
 * upload is tagged from its key's extension instead.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".json": "application/json",
};

export function contentTypeForKey(key: string): string {
  const contentType = MIME_BY_EXTENSION[path.extname(key).toLowerCase()];
  if (!contentType) {
    logger.warn({ key }, "no MIME mapping for extension; storing as application/octet-stream");
    return "application/octet-stream";
  }
  return contentType;
}

/**
 * Storage path format: "<bucket>/<key>", where key follows {business_id|bank}/{entity}/{id}/{filename}.
 * Contract: fetching an object that does not exist (download, signedUrl) throws
 * `missingObjectError` — a PermanentError, because a missing object will never
 * appear on retry. Network/auth failures stay plain errors (transient).
 */
export interface Storage {
  put(
    bucket: Bucket,
    key: string,
    source: string | Buffer,
    options?: { upsert?: boolean; cacheControl?: string },
  ): Promise<string>;
  download(storagePath: string, localFile: string): Promise<void>;
  remove(storagePath: string): Promise<void>;
  signedUrl(storagePath: string, expiresInSeconds: number): Promise<string>;
  /**
   * URL for an object in the PUBLIC catalog bucket — stable (no expiry, no
   * token), so browsers/CDNs/next-image can cache it. Pure URL construction,
   * no round trip, hence sync. Objects in the private buckets 404 on it.
   */
  publicUrl(storagePath: string): string;
  /**
   * Target for a direct browser upload (demo videos are far over Vercel's
   * route body limit, so their bytes never pass through a route handler).
   * The browser PUTs the file to the returned URL.
   */
  createSignedUploadUrl(storagePath: string): Promise<string>;
}

export function storageKey(parts: {
  businessId?: string;
  entity: "demo" | "hook_clip" | "persona_image" | "audio" | "video" | "thumb" | "composite";
  id: string;
  filename: string;
}): string {
  return [parts.businessId ?? "bank", parts.entity, parts.id, parts.filename].join("/");
}

/** "<bucket>/<key>" apart again — for callers that re-`put()` an object they
 *  downloaded by its stored path, so the bucket is never guessed. */
export function splitPath(storagePath: string): { bucket: Bucket; key: string } {
  const slash = storagePath.indexOf("/");
  return { bucket: storagePath.slice(0, slash) as Bucket, key: storagePath.slice(slash + 1) };
}

/** The one message every backend throws for an absent object (shown to the user as-is). */
export function missingObjectError(storagePath: string): PermanentError {
  // The key holds business UUIDs — keep it off the user-facing message; the
  // worker's `log.warn({ err })` serializes the property for debugging.
  const message = "קובץ המקור לא נמצא באחסון";
  return Object.assign(new PermanentError(message, { customerMessage: message }), { storagePath });
}

/** Supabase reports a missing key as 404 / "Object not found"; anything else stays transient. */
function isMissingObject(error: {
  message: string;
  status?: number;
  statusCode?: string;
}): boolean {
  return (
    error.status === 404 ||
    String(error.statusCode ?? "") === "404" ||
    /object not found/i.test(error.message)
  );
}

/** Filesystem-backed storage for the CLI phase / local dev (no Supabase project needed). */
class LocalStorage implements Storage {
  async put(bucket: Bucket, key: string, source: string | Buffer): Promise<string> {
    const dest = path.join(LOCAL_STORAGE_DIR, bucket, key);
    mkdirSync(path.dirname(dest), { recursive: true });
    if (typeof source === "string") copyFileSync(source, dest);
    else writeFileSync(dest, source);
    return `${bucket}/${key}`;
  }

  async download(storagePath: string, localFile: string): Promise<void> {
    const { bucket, key } = splitPath(storagePath);
    const src = path.join(LOCAL_STORAGE_DIR, bucket, key);
    if (!existsSync(src)) throw missingObjectError(storagePath);
    mkdirSync(path.dirname(localFile), { recursive: true });
    copyFileSync(src, localFile);
  }

  async remove(storagePath: string): Promise<void> {
    const { bucket, key } = splitPath(storagePath);
    rmSync(path.join(LOCAL_STORAGE_DIR, bucket, key), { force: true });
  }

  async signedUrl(storagePath: string): Promise<string> {
    const { bucket, key } = splitPath(storagePath);
    const src = path.join(LOCAL_STORAGE_DIR, bucket, key);
    if (!existsSync(src)) throw missingObjectError(storagePath);
    return `file://${src.replaceAll("\\", "/")}`;
  }

  publicUrl(storagePath: string): string {
    // Sync by contract, so no existence check — same file:// shape as signedUrl.
    const { bucket, key } = splitPath(storagePath);
    return `file://${path.join(LOCAL_STORAGE_DIR, bucket, key).replaceAll("\\", "/")}`;
  }

  async createSignedUploadUrl(): Promise<string> {
    // A browser cannot PUT into the local filesystem; the upload flow is
    // Supabase-only. The CLI path uses put() directly.
    throw new Error("local storage has no signed upload URLs — configure Supabase");
  }
}

/** Exported for tests (stub client asserts on upload params); use `getStorage()` everywhere else. */
export class SupabaseStorage implements Storage {
  constructor(private client: SupabaseClient) {}

  async put(
    bucket: Bucket,
    key: string,
    source: string | Buffer,
    options?: { upsert?: boolean; cacheControl?: string },
  ): Promise<string> {
    const bytes = typeof source === "string" ? readFileSync(source) : source;
    const { error } = await this.client.storage.from(bucket).upload(key, bytes, {
      contentType: contentTypeForKey(key),
      // Upsert by default: jobs are retryable, and a retry after a crash
      // between upload and DB write re-runs the same upload — it must
      // overwrite, not fail with "resource already exists".
      upsert: options?.upsert ?? true,
      // Served as `cache-control: public, max-age=<n>` on the public endpoint;
      // supabase-js defaults to 3600 when absent.
      ...(options?.cacheControl ? { cacheControl: options.cacheControl } : {}),
    });
    if (error) throw new Error(`storage upload failed (${bucket}/${key}): ${error.message}`);
    return `${bucket}/${key}`;
  }

  async download(storagePath: string, localFile: string): Promise<void> {
    const { bucket, key } = splitPath(storagePath);
    const { data, error } = await this.client.storage.from(bucket).download(key);
    if (error) {
      if (isMissingObject(error)) throw missingObjectError(storagePath);
      throw new Error(`storage download failed (${storagePath}): ${error.message}`);
    }
    mkdirSync(path.dirname(localFile), { recursive: true });
    writeFileSync(localFile, Buffer.from(await data.arrayBuffer()));
  }

  async remove(storagePath: string): Promise<void> {
    const { bucket, key } = splitPath(storagePath);
    const { error } = await this.client.storage.from(bucket).remove([key]);
    if (error) throw new Error(`storage remove failed (${storagePath}): ${error.message}`);
  }

  async signedUrl(storagePath: string, expiresInSeconds: number): Promise<string> {
    const { bucket, key } = splitPath(storagePath);
    const { data, error } = await this.client.storage
      .from(bucket)
      .createSignedUrl(key, expiresInSeconds);
    if (error) {
      if (isMissingObject(error)) throw missingObjectError(storagePath);
      throw new Error(`signed url failed (${storagePath}): ${error.message}`);
    }
    return data.signedUrl;
  }

  publicUrl(storagePath: string): string {
    const { bucket, key } = splitPath(storagePath);
    return this.client.storage.from(bucket).getPublicUrl(key).data.publicUrl;
  }

  async createSignedUploadUrl(storagePath: string): Promise<string> {
    const { bucket, key } = splitPath(storagePath);
    // upsert: a retried upload after a network drop must overwrite, not 409.
    const { data, error } = await this.client.storage
      .from(bucket)
      .createSignedUploadUrl(key, { upsert: true });
    if (error) {
      throw new Error(`signed upload url failed (${storagePath}): ${error.message}`);
    }
    return data.signedUrl;
  }
}

/**
 * Content-Type the storage host serves for an object — what HeyGen/ElevenLabs
 * see when they fetch a signed URL. Repair tooling (`aiugc storage retype`);
 * reads headers only, the body is cancelled.
 */
export async function servedContentType(storage: Storage, storagePath: string): Promise<string> {
  const url = await storage.signedUrl(storagePath, 60);
  if (url.startsWith("file://")) return "n/a (local storage has no content types)";
  const response = await fetch(url);
  await response.body?.cancel();
  if (!response.ok) {
    throw new Error(`content-type check failed (${storagePath}): HTTP ${response.status}`);
  }
  return response.headers.get("content-type") ?? "unknown";
}

let instance: Storage | undefined;

export function getStorage(): Storage {
  if (!instance) {
    const env = getEnv();
    instance =
      env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
        ? new SupabaseStorage(createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY))
        : new LocalStorage();
  }
  return instance;
}

/** Test hook. */
export function setStorage(s: Storage | undefined): void {
  instance = s;
}

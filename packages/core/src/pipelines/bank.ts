import { and, desc, eq, isNull, or } from "drizzle-orm";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Db } from "../db";
import { hookClips, jobs, personaImages, personas, structures, videoRenders } from "../db/schema";
import { blurPlaceholder } from "../media/ffmpeg";
import { SEED_STRUCTURES_DIR, WORK_DIR } from "../paths";
import type { TextSafeArea } from "../providers/remotion";
import { getStorage, storageKey } from "../storage";

/** Founder-curated banks: hook clips (closed, pre-rendered), personas, structures. */

export async function addHookClip(
  db: Db,
  opts: { filePath: string; durationMs: number; textSafeArea: TextSafeArea; tags?: object },
) {
  const inserted = await db
    .insert(hookClips)
    .values({
      filePath: "pending",
      durationMs: opts.durationMs,
      textSafeArea: opts.textSafeArea,
      tags: opts.tags ?? {},
    })
    .returning();
  const clip = inserted[0]!;
  let filePath: string;
  try {
    filePath = await getStorage().put(
      "assets",
      storageKey({ entity: "hook_clip", id: clip.id, filename: "clip.mp4" }),
      opts.filePath,
    );
  } catch (err) {
    // A failed upload must not strand the "pending" placeholder row.
    await db.delete(hookClips).where(eq(hookClips.id, clip.id));
    throw err;
  }
  await db.update(hookClips).set({ filePath }).where(eq(hookClips.id, clip.id));
  return { ...clip, filePath };
}

export async function addPersona(
  db: Db,
  opts: { name: string; voiceId: string; gender?: "female" | "male"; identity?: object },
) {
  const inserted = await db
    .insert(personas)
    .values({
      name: opts.name,
      voiceId: opts.voiceId,
      gender: opts.gender,
      identity: opts.identity ?? {},
    })
    .returning();
  return inserted[0]!;
}

/** Catalog copies serve for a year — keys are content-addressed, so changed
 *  bytes are a new URL and stale caches can never show the wrong image. */
const CATALOG_CACHE_SECONDS = "31536000";

/** Content-addressed catalog filename: same bytes, same URL; new bytes, new URL. */
function catalogFilename(bytes: Buffer, extension: string): string {
  return `${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}${extension}`;
}

/**
 * Best-effort blur placeholder for the pickers (~8px WebP data URL). null when
 * ffmpeg is missing or the bytes don't decode — a cosmetic placeholder must
 * never fail an upload, and the pickers render fine without one.
 */
async function tryBlurPlaceholder(bytes: Buffer, id: string, extension: string) {
  const dir = path.join(WORK_DIR, "persona-blur");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}${extension}`);
  writeFileSync(file, bytes);
  try {
    return await blurPlaceholder(file);
  } catch {
    return null;
  } finally {
    rmSync(file, { force: true });
  }
}

/**
 * The first image for a persona becomes the default; --default moves the flag.
 * Source: a local file path (CLI) or raw upload bytes (web admin). Every image
 * is stored twice: the private assets original (render pipeline) and a public
 * catalog copy (stable cacheable URL for the pickers — persona images are
 * catalog data any signed-in user may see, per 0007's RLS).
 */
export async function addPersonaImage(
  db: Db,
  opts: { personaId: string; isDefault?: boolean } & (
    { filePath: string } | { bytes: Buffer; extension: string }
  ),
) {
  const existing = await db
    .select()
    .from(personaImages)
    .where(eq(personaImages.personaId, opts.personaId))
    .limit(1);
  const isDefault = Boolean(opts.isDefault) || existing.length === 0;
  // Inserted as non-default: the flag moves only after the upload succeeds, so
  // a failed upload leaves the previous default in place (and the partial
  // unique index on is_default never sees two defaults).
  const inserted = await db
    .insert(personaImages)
    .values({ personaId: opts.personaId, filePath: "pending", isDefault: false })
    .returning();
  const image = inserted[0]!;
  const extension = "filePath" in opts ? path.extname(opts.filePath) || ".jpg" : opts.extension;
  const bytes = "filePath" in opts ? readFileSync(opts.filePath) : opts.bytes;
  let filePath: string;
  let catalogPath: string;
  try {
    filePath = await getStorage().put(
      "assets",
      storageKey({ entity: "persona_image", id: image.id, filename: `image${extension}` }),
      bytes,
    );
    catalogPath = await getStorage().put(
      "catalog",
      storageKey({
        entity: "persona_image",
        id: image.id,
        filename: catalogFilename(bytes, extension),
      }),
      bytes,
      { cacheControl: CATALOG_CACHE_SECONDS },
    );
  } catch (err) {
    // A failed upload must not strand the "pending" placeholder row.
    await db.delete(personaImages).where(eq(personaImages.id, image.id));
    throw err;
  }
  const blurDataUrl = await tryBlurPlaceholder(bytes, image.id, extension);
  await db
    .update(personaImages)
    .set({ filePath, catalogPath, blurDataUrl })
    .where(eq(personaImages.id, image.id));
  if (isDefault) await setDefaultPersonaImage(db, image.id);
  return { ...image, filePath, catalogPath, blurDataUrl, isDefault };
}

/**
 * Backfill: images uploaded before the catalog bucket (or the blur column)
 * existed get their public copy and/or blur placeholder stamped. Counts rows
 * actually updated, so a re-run reports 0; retired and placeholder rows are
 * skipped (no picker lists them), and rows whose bytes never decode simply
 * keep a null blur.
 */
export async function syncPersonaImageCatalog(db: Db): Promise<number> {
  const rows = await db
    .select()
    .from(personaImages)
    .where(or(isNull(personaImages.catalogPath), isNull(personaImages.blurDataUrl)));
  const storage = getStorage();
  const workDir = path.join(WORK_DIR, "catalog-sync");
  let synced = 0;
  for (const image of rows) {
    if (!image.filePath.includes("/") || image.retired) continue;
    const extension = path.extname(image.filePath) || ".jpg";
    const local = path.join(workDir, `${image.id}${extension}`);
    mkdirSync(workDir, { recursive: true });
    await storage.download(image.filePath, local);
    const bytes = readFileSync(local);
    rmSync(local, { force: true });
    const updates: { catalogPath?: string; blurDataUrl?: string } = {};
    if (!image.catalogPath) {
      updates.catalogPath = await storage.put(
        "catalog",
        storageKey({
          entity: "persona_image",
          id: image.id,
          filename: catalogFilename(bytes, extension),
        }),
        bytes,
        { cacheControl: CATALOG_CACHE_SECONDS },
      );
    }
    if (!image.blurDataUrl) {
      const blur = await tryBlurPlaceholder(bytes, image.id, extension);
      if (blur) updates.blurDataUrl = blur;
    }
    if (Object.keys(updates).length === 0) continue;
    await db.update(personaImages).set(updates).where(eq(personaImages.id, image.id));
    synced++;
  }
  return synced;
}

/**
 * Atomically move the persona's default flag to this image (clear-then-set, so
 * the partial unique index never sees two defaults). One implementation, two
 * callers: `addPersonaImage --default` and the admin make-default action.
 */
export async function setDefaultPersonaImage(db: Db, imageId: string) {
  const rows = await db.select().from(personaImages).where(eq(personaImages.id, imageId)).limit(1);
  const image = rows[0];
  if (!image) throw new Error(`persona image ${imageId} not found`);
  if (!image.filePath.includes("/")) {
    throw new Error(`persona image ${imageId} has no stored file`);
  }
  if (image.retired) throw new Error(`persona image ${imageId} is retired`);
  await db
    .update(personaImages)
    .set({ isDefault: false })
    .where(and(eq(personaImages.personaId, image.personaId), eq(personaImages.isDefault, true)));
  await db.update(personaImages).set({ isDefault: true }).where(eq(personaImages.id, imageId));
  return { ...image, isDefault: true };
}

/**
 * "Delete" is retire: video_renders.params reference image ids and QC
 * regeneration re-reads them, so rows are never hard-deleted. The current
 * default cannot be retired — the render fallback must always find a usable
 * default, so another image has to be promoted first.
 */
export async function setPersonaImageRetired(db: Db, imageId: string, retired: boolean) {
  const rows = await db.select().from(personaImages).where(eq(personaImages.id, imageId)).limit(1);
  const image = rows[0];
  if (!image) throw new Error(`persona image ${imageId} not found`);
  if (retired && image.isDefault) {
    throw new Error("cannot retire the default image — make another image the default first");
  }
  await db.update(personaImages).set({ retired }).where(eq(personaImages.id, imageId));
  return { ...image, retired };
}

export async function addStructure(db: Db, opts: { title: string; skeleton: unknown }) {
  const inserted = await db
    .insert(structures)
    .values({ title: opts.title, skeleton: opts.skeleton })
    .returning();
  return inserted[0]!;
}

/**
 * Insert every checked-in skeleton (seed/structures/*.json, title = file name)
 * through the same path as `aiugc bank add-structure`. Titles already in the
 * bank are skipped, so re-running after adding a new file is safe.
 */
export async function seedStructures(db: Db, dir: string = SEED_STRUCTURES_DIR) {
  const existing = new Set(
    (await db.select({ title: structures.title }).from(structures)).map((r) => r.title),
  );
  const added: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const title = path.basename(file, ".json");
    if (existing.has(title)) continue;
    await addStructure(db, {
      title,
      skeleton: JSON.parse(readFileSync(path.join(dir, file), "utf8")),
    });
    added.push(title);
  }
  return added;
}

/** Ops views for `aiugc status` (Supabase Studio serves the same need in the browser). */

export async function recentJobs(db: Db, limit = 15) {
  return db.select().from(jobs).orderBy(desc(jobs.updatedAt)).limit(limit);
}

export async function recentRenders(db: Db, limit = 15) {
  return db.select().from(videoRenders).orderBy(desc(videoRenders.updatedAt)).limit(limit);
}

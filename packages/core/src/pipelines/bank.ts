import { and, desc, eq, isNull, or } from "drizzle-orm";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getEnv } from "../config";
import type { Db } from "../db";
import {
  hookClips,
  jobs,
  openerClips,
  personaImages,
  personas,
  structures,
  textBlockClips,
  videoRenders,
} from "../db/schema";
import { textSafeAreaSchema } from "../hook-geometry";
import { enqueue, type Job } from "../jobs/queue";
import { PermanentError } from "../jobs/errors";
import type { JobContext, JobResult } from "../jobs/worker";
import { blurPlaceholder, normalizeVideo, probe } from "../media/ffmpeg";
import { SEED_STRUCTURES_DIR, WORK_DIR } from "../paths";
import type { TextSafeArea } from "../providers/remotion";
import { getStorage, splitPath, storageKey } from "../storage";

/** Founder-curated banks: hook clips (closed, pre-rendered), personas, structures. */

/**
 * Every composition runs at exactly 30fps, so a bank clip at any other rate is
 * resampled by the renderer and shows fewer distinct frames than the output
 * claims. Nothing upstream catches it: the CLI takes the founder's --duration
 * on trust and the admin upload validates MIME/size/dimensions/duration from
 * the browser, which cannot read a frame rate at all.
 */
const COMPOSITION_FPS = 30;

/**
 * Re-encoding is destructive and in place, so it needs a real reason. 1% of
 * 30fps covers NTSC 29.97, which duplicates one frame across a 4s clip and is
 * invisible; 24 or 25fps duplicates one in five and judders. fps 0 means
 * ffprobe could not tell us — never rewrite a master on a guess.
 */
export function needsNormalize(fps: number): boolean {
  return fps > 0 && Math.abs(fps - COMPOSITION_FPS) > 0.3;
}

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
  // Same route as the admin upload rather than normalizing the local file
  // here: one code path, one failure mode, and the CLI keeps working on a box
  // without ffmpeg. `aiugc work` (or the worker) picks it up.
  await requestHookClipNormalize(db, clip.id);
  return { ...clip, filePath };
}

/**
 * Bring a stored hook clip to the composition's 30fps, in place.
 *
 * Idempotent: a clip already at rate is downloaded, probed and left alone, so
 * re-running over the whole bank re-encodes nothing. `checkOnly` reports what
 * it would do and touches nothing — the safe way to point this at the live
 * bank. `durationMs` is deliberately not rewritten: resampling moves the last
 * frame's presentation time by under one frame, the column is display-only
 * (the renderer measures the file itself), and updating it would add a second
 * write that a crash could leave half-done.
 */
export async function normalizeHookClip(
  db: Db,
  clipId: string,
  opts: { checkOnly?: boolean } = {},
): Promise<{ fps: number; normalized: boolean }> {
  const rows = await db.select().from(hookClips).where(eq(hookClips.id, clipId)).limit(1);
  const clip = rows[0];
  if (!clip) throw new PermanentError(`hook clip ${clipId} not found`);
  if (!clip.filePath.includes("/")) throw new PermanentError(`hook clip ${clipId} has no file`);
  return normalizeStoredClip(clip.filePath, clipId, opts);
}

/**
 * The bank-clip rate check, shared by the hook bank and the גוש טקסט bank:
 * download, probe, re-encode to 30fps only when the rate is off, upload back
 * over the same key. The clip's audio survives either way — a clip at rate is
 * left byte for byte, and normalizeVideo keeps the track as AAC.
 */
async function normalizeStoredClip(
  filePath: string,
  clipId: string,
  opts: { checkOnly?: boolean },
): Promise<{ fps: number; normalized: boolean }> {
  // Unique per run: the founder's `aiugc work` and the deployed worker share
  // one database, so two runners can hold the same clip at the same time.
  mkdirSync(path.join(WORK_DIR, "bank"), { recursive: true });
  const dir = mkdtempSync(path.join(WORK_DIR, "bank", `${clipId}-`));
  try {
    const local = path.join(dir, "clip.mp4");
    await getStorage().download(filePath, local);
    const { fps } = await probe(local);
    if (!needsNormalize(fps) || opts.checkOnly) return { fps, normalized: false };

    const normalized = path.join(dir, "clip-30fps.mp4");
    await normalizeVideo(local, normalized);
    // Back to the same storage path: file_path is what every picker and render
    // reads, so a new key would just strand the old bytes behind it.
    const { bucket, key } = splitPath(filePath);
    await getStorage().put(bucket, key, normalized);
    return { fps, normalized: true };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Same check for a גוש טקסט clip (Service C): the composition plays the clip
 * once with its own sound, so the rate has to be the composition's and the
 * audio has to survive — normalizeStoredClip does both.
 */
export async function normalizeTextBlockClip(
  db: Db,
  clipId: string,
  opts: { checkOnly?: boolean } = {},
): Promise<{ fps: number; normalized: boolean }> {
  const rows = await db.select().from(textBlockClips).where(eq(textBlockClips.id, clipId)).limit(1);
  const clip = rows[0];
  if (!clip) throw new PermanentError(`text block clip ${clipId} not found`);
  if (!clip.filePath.includes("/")) {
    throw new PermanentError(`text block clip ${clipId} has no file`);
  }
  return normalizeStoredClip(clip.filePath, clipId, opts);
}

/** Queue the worker to check a גוש טקסט clip's frame rate. */
export async function requestTextBlockClipNormalize(db: Db, clipId: string): Promise<void> {
  await enqueue(db, {
    type: "normalize_text_block_clip",
    idempotencyKey: `normalize_text_block_clip:${clipId}`,
    payload: { clipId },
  });
}

export async function handleNormalizeTextBlockClip(job: Job, ctx: JobContext): Promise<JobResult> {
  const { clipId } = job.payload as { clipId: string };
  // DRY_RUN files are text stubs, not media — ffprobe rejects every one.
  if (getEnv().DRY_RUN) return { kind: "done" };
  const result = await normalizeTextBlockClip(ctx.db, clipId);
  ctx.log.info({ clipId, ...result }, "bank: checked text block clip frame rate");
  return { kind: "done" };
}

/** Queue the worker to check a clip's frame rate. */
export async function requestHookClipNormalize(db: Db, clipId: string): Promise<void> {
  await enqueue(db, {
    type: "normalize_hook_clip",
    idempotencyKey: `normalize_hook_clip:${clipId}`,
    payload: { clipId },
  });
}

export async function handleNormalizeHookClip(job: Job, ctx: JobContext): Promise<JobResult> {
  const { clipId } = job.payload as { clipId: string };
  // DRY_RUN files are text stubs, not media — ffprobe rejects every one.
  if (getEnv().DRY_RUN) return { kind: "done" };
  const result = await normalizeHookClip(ctx.db, clipId);
  ctx.log.info({ clipId, ...result }, "bank: checked hook clip frame rate");
  return { kind: "done" };
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

/**
 * Edit a persona's name, pinned voice or gender — only the fields given are
 * written: the admin edit form PATCHes a partial body, so an untouched voice
 * id is never rewritten.
 */
export async function updatePersona(
  db: Db,
  personaId: string,
  patch: { name?: string; voiceId?: string; gender?: "female" | "male" },
) {
  const rows = await db.select().from(personas).where(eq(personas.id, personaId)).limit(1);
  const persona = rows[0];
  if (!persona) throw new Error(`persona ${personaId} not found`);
  const set: typeof patch = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.voiceId !== undefined) set.voiceId = patch.voiceId;
  if (patch.gender !== undefined) set.gender = patch.gender;
  if (Object.keys(set).length === 0) return persona;
  const updated = await db.update(personas).set(set).where(eq(personas.id, personaId)).returning();
  return updated[0]!;
}

/** Catalog copies serve for a year — keys are content-addressed, so changed
 *  bytes are a new URL and stale caches can never show the wrong image. */
const CATALOG_CACHE_SECONDS = "31536000";

/** Content-addressed catalog filename: same bytes, same URL; new bytes, new URL. */
function catalogFilename(bytes: Buffer, extension: string): string {
  return `${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}${extension}`;
}

/**
 * Best-effort blur placeholder for the pickers (~8px WebP data URL). The
 * scratch mkdir/write sit inside the try with ffmpeg because a cosmetic
 * placeholder must never fail an upload — on Vercel the work dir is read-only
 * and there is no ffmpeg (that stranded two rows at "pending" on 2026-09-02);
 * a null blur is backfilled by `aiugc persona sync-catalog`.
 */
async function tryBlurPlaceholder(bytes: Buffer, id: string, extension: string) {
  const file = path.join(WORK_DIR, "persona-blur", `${id}${extension}`);
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, bytes);
    return await blurPlaceholder(file);
  } catch {
    return null;
  } finally {
    // Best-effort too: `force` only forgives a missing file, and on POSIX a
    // scratch path under a regular file lstat's as ENOTDIR — a throw here
    // would override the catch's null and fail the upload after all.
    try {
      rmSync(file, { force: true });
    } catch {
      /* scratch cleanup must never fail the upload either */
    }
  }
}

/**
 * The first image for a persona becomes the default; --default moves the flag.
 * Source: a local file path (CLI) or raw upload bytes (web admin). Every image
 * is stored twice: the private assets original (render pipeline) and a public
 * catalog copy (stable cacheable URL for the pickers — persona images are
 * catalog data any signed-in user may see, per 0007's RLS).
 */
export type PersonaImageKind = "preview" | "background" | "selfie";

export async function addPersonaImage(
  db: Db,
  opts: {
    personaId: string;
    isDefault?: boolean;
    /** Absent = the column default ("background"). "selfie" is the Service B render source. */
    kind?: PersonaImageKind;
    label?: string;
    /** Lineage: the standing image a selfie was derived from (persona_images.source_image_id). */
    sourceImageId?: string;
  } & ({ filePath: string } | { bytes: Buffer; extension: string }),
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
    .values({
      personaId: opts.personaId,
      filePath: "pending",
      isDefault: false,
      kind: opts.kind,
      label: opts.label,
      sourceImageId: opts.sourceImageId,
    })
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

/**
 * Register one founder-made opener clip against a (selfie image × effect)
 * pair (vault 0017). The file is uploaded play-ready — already reversed where
 * the effect is a reveal; nothing processes it at render time. One ACTIVE row
 * per pair (0032's partial unique index): a re-registration supersedes the
 * previous clip, which stays in the table as active=false because render
 * params may reference it.
 */
export async function addOpenerClip(
  db: Db,
  opts: {
    personaImageId: string;
    effect: string;
    label: string;
    filePath: string;
    durationMs: number;
    /**
     * Where the hard cut lands, in clip time (0..durationMs): the first frame
     * whose pose matches the selfie — hand out of the frame and settled — so
     * the talking head, idling on that selfie, continues it. Tagging the
     * frame where the face merely appears cuts on a moving hand.
     */
    revealAtMs: number;
    textSafeArea: TextSafeArea;
  },
) {
  const image = (
    await db.select().from(personaImages).where(eq(personaImages.id, opts.personaImageId)).limit(1)
  )[0];
  if (!image) throw new Error(`persona image ${opts.personaImageId} not found`);
  if (image.kind !== "selfie") {
    throw new Error(`persona image ${opts.personaImageId} is not a selfie (kind: ${image.kind})`);
  }
  // Same exclusions createBRender applies to the render source: a retired
  // image and a stranded "pending" placeholder (no "/") can never be animated,
  // so a clip made from them could never be cut against anything.
  if (image.retired) throw new Error(`persona image ${opts.personaImageId} is retired`);
  if (!image.filePath.includes("/")) {
    throw new Error(`persona image ${opts.personaImageId} never finished uploading`);
  }
  if (opts.revealAtMs < 0 || opts.revealAtMs > opts.durationMs) {
    throw new Error(`revealAtMs ${opts.revealAtMs} is outside the clip (0..${opts.durationMs})`);
  }
  const textSafeArea = textSafeAreaSchema.parse(opts.textSafeArea);

  // Inserted inactive: the partial unique index only sees active rows, so the
  // previous clip for this pair keeps serving until the upload has landed.
  const inserted = await db
    .insert(openerClips)
    .values({
      personaImageId: opts.personaImageId,
      effect: opts.effect,
      label: opts.label,
      filePath: "pending",
      durationMs: opts.durationMs,
      revealAtMs: opts.revealAtMs,
      textSafeArea,
      active: false,
    })
    .returning();
  const clip = inserted[0]!;
  let filePath: string;
  try {
    filePath = await getStorage().put(
      "assets",
      storageKey({ entity: "opener_clip", id: clip.id, filename: "clip.mp4" }),
      opts.filePath,
    );
  } catch (err) {
    // A failed upload must not strand the "pending" placeholder row.
    await db.delete(openerClips).where(eq(openerClips.id, clip.id));
    throw err;
  }
  await db.transaction(async (tx) => {
    await tx
      .update(openerClips)
      .set({ active: false })
      .where(
        and(
          eq(openerClips.personaImageId, opts.personaImageId),
          eq(openerClips.effect, opts.effect),
          eq(openerClips.active, true),
        ),
      );
    await tx.update(openerClips).set({ filePath, active: true }).where(eq(openerClips.id, clip.id));
  });
  return { ...clip, filePath, active: true };
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
 * bank are skipped, so re-running after adding a new file is safe. With
 * `update`, an existing title gets its skeleton replaced from the file instead
 * (every row carrying that title — `title` is not unique); nothing else on the
 * row changes.
 */
export async function seedStructures(
  db: Db,
  opts: { update?: boolean } = {},
  dir: string = SEED_STRUCTURES_DIR,
): Promise<{ added: string[]; updated: string[] }> {
  const existing = new Set(
    (await db.select({ title: structures.title }).from(structures)).map((r) => r.title),
  );
  const added: string[] = [];
  const updated: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const title = path.basename(file, ".json");
    const skeleton = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
    if (existing.has(title)) {
      if (!opts.update) continue;
      await db.update(structures).set({ skeleton }).where(eq(structures.title, title));
      updated.push(title);
      continue;
    }
    await addStructure(db, { title, skeleton });
    added.push(title);
  }
  return { added, updated };
}

/** Ops views for `aiugc status` (Supabase Studio serves the same need in the browser). */

export async function recentJobs(db: Db, limit = 15) {
  return db.select().from(jobs).orderBy(desc(jobs.updatedAt)).limit(limit);
}

export async function recentRenders(db: Db, limit = 15) {
  return db.select().from(videoRenders).orderBy(desc(videoRenders.updatedAt)).limit(limit);
}

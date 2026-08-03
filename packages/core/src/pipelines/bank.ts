import { and, desc, eq } from "drizzle-orm";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Db } from "../db";
import { hookClips, jobs, personaImages, personas, structures, videoRenders } from "../db/schema";
import { SEED_STRUCTURES_DIR } from "../paths";
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

/**
 * The first image for a persona becomes the default; --default moves the flag.
 * Source: a local file path (CLI) or raw upload bytes (web admin).
 */
export async function addPersonaImage(
  db: Db,
  opts: { personaId: string; isDefault?: boolean } & (
    | { filePath: string }
    | { bytes: Buffer; extension: string }
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
  const extension =
    "filePath" in opts ? path.extname(opts.filePath) || ".jpg" : opts.extension;
  let filePath: string;
  try {
    filePath = await getStorage().put(
      "assets",
      storageKey({ entity: "persona_image", id: image.id, filename: `image${extension}` }),
      "filePath" in opts ? opts.filePath : opts.bytes,
    );
  } catch (err) {
    // A failed upload must not strand the "pending" placeholder row.
    await db.delete(personaImages).where(eq(personaImages.id, image.id));
    throw err;
  }
  await db.update(personaImages).set({ filePath }).where(eq(personaImages.id, image.id));
  if (isDefault) await setDefaultPersonaImage(db, image.id);
  return { ...image, filePath, isDefault };
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

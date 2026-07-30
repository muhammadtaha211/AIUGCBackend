import { and, desc, eq } from "drizzle-orm";
import path from "node:path";
import type { Db } from "../db";
import { hookClips, jobs, personaImages, personas, structures, videoRenders } from "../db/schema";
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
  const filePath = await getStorage().put(
    "assets",
    storageKey({ entity: "hook_clip", id: clip.id, filename: "clip.mp4" }),
    opts.filePath,
  );
  await db.update(hookClips).set({ filePath }).where(eq(hookClips.id, clip.id));
  return { ...clip, filePath };
}

export async function addPersona(
  db: Db,
  opts: { name: string; voiceId: string; identity?: object },
) {
  const inserted = await db
    .insert(personas)
    .values({ name: opts.name, voiceId: opts.voiceId, identity: opts.identity ?? {} })
    .returning();
  return inserted[0]!;
}

/** The first image for a persona becomes the default; --default moves the flag. */
export async function addPersonaImage(
  db: Db,
  opts: { personaId: string; filePath: string; isDefault?: boolean },
) {
  const existing = await db
    .select()
    .from(personaImages)
    .where(eq(personaImages.personaId, opts.personaId))
    .limit(1);
  const isDefault = Boolean(opts.isDefault) || existing.length === 0;
  if (isDefault) {
    await db
      .update(personaImages)
      .set({ isDefault: false })
      .where(and(eq(personaImages.personaId, opts.personaId), eq(personaImages.isDefault, true)));
  }
  const inserted = await db
    .insert(personaImages)
    .values({ personaId: opts.personaId, filePath: "pending", isDefault })
    .returning();
  const image = inserted[0]!;
  let filePath: string;
  try {
    filePath = await getStorage().put(
      "assets",
      storageKey({
        entity: "persona_image",
        id: image.id,
        filename: `image${path.extname(opts.filePath) || ".jpg"}`,
      }),
      opts.filePath,
    );
  } catch (err) {
    // A failed upload must not strand the "pending" placeholder row.
    await db.delete(personaImages).where(eq(personaImages.id, image.id));
    throw err;
  }
  await db.update(personaImages).set({ filePath }).where(eq(personaImages.id, image.id));
  return { ...image, filePath };
}

export async function addStructure(db: Db, opts: { title: string; skeleton: unknown }) {
  const inserted = await db
    .insert(structures)
    .values({ title: opts.title, skeleton: opts.skeleton })
    .returning();
  return inserted[0]!;
}

/** Ops views for `aiugc status` (Supabase Studio serves the same need in the browser). */

export async function recentJobs(db: Db, limit = 15) {
  return db.select().from(jobs).orderBy(desc(jobs.updatedAt)).limit(limit);
}

export async function recentRenders(db: Db, limit = 15) {
  return db.select().from(videoRenders).orderBy(desc(videoRenders.updatedAt)).limit(limit);
}

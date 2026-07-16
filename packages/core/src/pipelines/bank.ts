import { desc, eq } from "drizzle-orm";
import type { Db } from "../db";
import { hookClips, jobs, personaClips, personas, structures, videoRenders } from "../db/schema";
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

export async function addPersonaClip(
  db: Db,
  opts: { personaId: string; filePath: string; durationMs: number },
) {
  const inserted = await db
    .insert(personaClips)
    .values({ personaId: opts.personaId, filePath: "pending", durationMs: opts.durationMs })
    .returning();
  const clip = inserted[0]!;
  const filePath = await getStorage().put(
    "assets",
    storageKey({ entity: "persona_clip", id: clip.id, filename: "clip.mp4" }),
    opts.filePath,
  );
  await db.update(personaClips).set({ filePath }).where(eq(personaClips.id, clip.id));
  return { ...clip, filePath };
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

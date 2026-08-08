import { and, eq } from "drizzle-orm";
import type { Db } from "../db";
import { audioRenders, events, scripts } from "../db/schema";

/**
 * The audio render's script pointer, read and watched.
 *
 * Kept out of pipelines/tts.ts on purpose: the length-fit regeneration that
 * moves the pointer lives there and is on its way out, while these two outlive
 * it as the guarantee that what a customer approves is what gets spoken.
 */

/** The tripwire's event kind — one row per audio render whose pointer moved. */
export const AUDIO_SCRIPT_POINTER_MOVED = "audio_script_pointer_moved";

/**
 * An audio render together with the script it will actually speak, resolved
 * through audio_renders.script_id.
 *
 * Takes only the audio render id, by design: there is no script id to pass, so
 * no caller — API route, worker, CLI — can display or bill for a script other
 * than the one the render reads.
 *
 * `pointerMoved` is `script.createdAt > audioRender.createdAt`. requestAudio
 * can only point a new audio row at a script that already exists, so a pointed-at
 * script that is YOUNGER than the audio row means something repointed it after
 * the fact. Verified against production 2026-08-08: it flags all three known
 * swaps and none of the other 37 audio renders, including every user-edited
 * script (whose new row is created before its audio) and all 26 b_scripts.
 *
 * It is deliberately a property of the two rows and not of anything a client
 * sends, so it survives a refresh, back-navigation, and a wizard that never ran.
 *
 * KNOWN LIMITATION: a repoint at an OLDER script row is invisible to this —
 * the timestamps would look ordinary. Nothing writes audio_renders.script_id
 * that way today (the only writer regenerates, which always inserts a newer
 * row). Catching it would need the originally-requested script id stored on the
 * audio render, i.e. a schema change; that is not worth a migration for a case
 * no code can currently produce.
 */
export async function getAudioWithScript(
  db: Db,
  audioRenderId: string,
): Promise<{
  audio: typeof audioRenders.$inferSelect;
  script: typeof scripts.$inferSelect;
  pointerMoved: boolean;
} | null> {
  const rows = await db
    .select({ audio: audioRenders, script: scripts })
    .from(audioRenders)
    .innerJoin(scripts, eq(audioRenders.scriptId, scripts.id))
    .where(eq(audioRenders.id, audioRenderId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { ...row, pointerMoved: row.script.createdAt > row.audio.createdAt };
}

/**
 * Record that an audio render's script pointer moved — at most one row per
 * audio render.
 *
 * The caller is a 2s poll and the predicate stays true for the life of the row,
 * so the existence check is what makes this exactly-once; `events` carries no
 * unique index to lean on.
 *
 * The id of the script the pointer moved AWAY from is not recorded, because the
 * server cannot know it: nothing stores which script the audio was originally
 * requested for (see the limitation above). `audioCreatedAt` is the anchor for
 * finding it by hand — it is the newest script for this business created before
 * that instant.
 */
export async function recordAudioScriptPointerMove(
  db: Db,
  opts: {
    audioRenderId: string;
    businessId: string;
    toScriptId: string;
    audioCreatedAt: Date;
    scriptCreatedAt: Date;
    actorUserId?: string;
  },
): Promise<void> {
  const seen = await db
    .select({ id: events.id })
    .from(events)
    .where(
      and(eq(events.kind, AUDIO_SCRIPT_POINTER_MOVED), eq(events.subjectId, opts.audioRenderId)),
    )
    .limit(1);
  if (seen[0]) return;

  await db.insert(events).values({
    kind: AUDIO_SCRIPT_POINTER_MOVED,
    actorUserId: opts.actorUserId,
    businessId: opts.businessId,
    subjectType: "audio_render",
    subjectId: opts.audioRenderId,
    payload: {
      toScriptId: opts.toScriptId,
      audioCreatedAt: opts.audioCreatedAt.toISOString(),
      scriptCreatedAt: opts.scriptCreatedAt.toISOString(),
    },
  });
}

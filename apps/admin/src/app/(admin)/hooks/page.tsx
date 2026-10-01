import { redirect } from "next/navigation";
import { getDb, getStorage, schema } from "@aiugc/core";
import type { SafeRect } from "@aiugc/core/hook-geometry";
import type { HookTextColor } from "@aiugc/core/hook-text-color";
import { adminSession, SIGNED_URL_TTL_SECONDS } from "@/lib/api";
import { HooksManager } from "./hooks-manager";

/**
 * Hook-clip bank: every clip (inactive ones grayed, never hidden — active=false
 * is the retire mechanism and rows are never deleted), with the upload flow and
 * per-clip actions. The Service A wizard picker shows only active clips of the
 * persona the customer chose; a clip with no persona is shown to nobody.
 */
export default async function AdminHooksPage() {
  const db = getDb();
  const session = await adminSession(db);
  if (!session) redirect("/login");

  const rows = await db.select().from(schema.hookClips).orderBy(schema.hookClips.createdAt);
  const personaRows = await db
    .select({ id: schema.personas.id, name: schema.personas.name })
    .from(schema.personas)
    .orderBy(schema.personas.createdAt);
  const personaName = new Map(personaRows.map((p) => [p.id, p.name]));

  const storage = getStorage();
  const clips = [];
  for (const clip of rows) {
    // A stranded "pending" placeholder (crashed CLI upload) has nothing to show.
    if (!clip.filePath.includes("/")) continue;
    clips.push({
      id: clip.id,
      url: await storage.signedUrl(clip.filePath, SIGNED_URL_TTL_SECONDS),
      durationMs: clip.durationMs,
      tags: clip.tags as Record<string, string>,
      textSafeArea: clip.textSafeArea as SafeRect,
      textColor: clip.textColor as HookTextColor,
      active: clip.active,
      personaId: clip.personaId ?? undefined,
      personaName: clip.personaId ? personaName.get(clip.personaId) : undefined,
      sourceClipId: clip.sourceClipId ?? undefined,
    });
  }

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-white">פתיחים</h1>
      <HooksManager clips={clips} personas={personaRows} />
    </div>
  );
}

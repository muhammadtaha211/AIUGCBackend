import { redirect } from "next/navigation";
import { getDb, getStorage, schema } from "@aiugc/core";
import { adminSession, SIGNED_URL_TTL_SECONDS } from "@/lib/api";
import type { SafeRect } from "@/lib/hooks";
import { HookCard } from "./hook-card";
import { UploadHook } from "./upload-hook";

/**
 * Hook-clip bank: every clip (inactive ones grayed, never hidden — active=false
 * is the retire mechanism and rows are never deleted), with the upload flow and
 * per-clip actions. The Service A wizard picker shows only active clips.
 */
export default async function AdminHooksPage() {
  const db = getDb();
  const session = await adminSession(db);
  if (!session) redirect("/login");

  const rows = await db.select().from(schema.hookClips).orderBy(schema.hookClips.createdAt);

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
      active: clip.active,
    });
  }

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-white">פתיחים</h1>

      <div className="mt-6">
        <UploadHook />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {clips.map((clip) => (
          <HookCard key={clip.id} clip={clip} />
        ))}
        {clips.length === 0 && (
          <p className="col-span-full text-sm text-gray-500">
            אין פתיחים עדיין — מעלים קליפ ראשון למעלה.
          </p>
        )}
      </div>
    </div>
  );
}

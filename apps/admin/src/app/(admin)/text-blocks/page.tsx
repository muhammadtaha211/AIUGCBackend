import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb, getStorage, schema } from "@aiugc/core";
import type { SafeRect } from "@aiugc/core/hook-geometry";
import type { HookTextColor } from "@aiugc/core/hook-text-color";
import type { SpeakerGender } from "@aiugc/core/text-block";
import { adminSession, SIGNED_URL_TTL_SECONDS } from "@/lib/api";
import { TextBlockCard } from "./text-block-card";
import { UploadTextBlock } from "./upload-text-block";

/**
 * The גוש טקסט bank (Service C, admin-only in phase 1): every clip (inactive
 * ones grayed, never hidden — active=false is the retire mechanism and rows
 * are never deleted), with the upload flow and per-clip actions. The studio
 * at /text-blocks/new picks from the active ones.
 */
export default async function AdminTextBlocksPage() {
  const db = getDb();
  const session = await adminSession(db);
  if (!session) redirect("/login");

  const rows = await db
    .select()
    .from(schema.textBlockClips)
    .orderBy(schema.textBlockClips.createdAt);

  const storage = getStorage();
  const clips = [];
  for (const clip of rows) {
    // A stranded "pending" placeholder has nothing to show.
    if (!clip.filePath.includes("/")) continue;
    clips.push({
      id: clip.id,
      url: await storage.signedUrl(clip.filePath, SIGNED_URL_TTL_SECONDS),
      durationMs: clip.durationMs,
      speakerGender: clip.speakerGender as SpeakerGender,
      textSafeArea: clip.textSafeArea as SafeRect,
      textColor: clip.textColor as HookTextColor,
      active: clip.active,
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-white">גוש טקסט — הקליפים</h1>
        <Link href="/text-blocks/new" className="text-sm font-medium text-accent hover:underline">
          יצירת גוש טקסט לעסק ←
        </Link>
      </div>

      <div className="mt-6">
        <UploadTextBlock />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {clips.map((clip) => (
          <TextBlockCard key={clip.id} clip={clip} />
        ))}
        {clips.length === 0 && (
          <p className="col-span-full text-sm text-gray-500">
            אין קליפים עדיין — מעלים קליפ ראשון למעלה.
          </p>
        )}
      </div>
    </div>
  );
}

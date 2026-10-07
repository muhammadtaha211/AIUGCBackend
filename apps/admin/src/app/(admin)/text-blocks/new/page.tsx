import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { getDb, getStorage, schema } from "@aiugc/core";
import type { SafeRect } from "@aiugc/core/hook-geometry";
import type { HookTextColor } from "@aiugc/core/hook-text-color";
import type { SpeakerGender } from "@aiugc/core/text-block";
import { adminSession, SIGNED_URL_TTL_SECONDS } from "@/lib/api";
import { TextBlockStudio } from "./studio";

/**
 * The founder's גוש טקסט studio (Service C, phase 1): pick one of his own
 * businesses and an active clip, generate the batch, edit a text, render it,
 * download the MP4. A server page like every admin page — it reads Drizzle
 * directly and signs the URLs; the client half calls the API routes and
 * refreshes this page while a render is in flight.
 *
 * Only admin-owned businesses are offered: createTextBlockRender refuses any
 * other in phase 1 (no credit key yet), so the picker does not pretend.
 */
export default async function AdminTextBlockStudioPage() {
  const db = getDb();
  const session = await adminSession(db);
  if (!session) redirect("/login");

  const { businesses, users, textBlockClips, videoRenders } = schema;
  const businessRows = await db
    .select({ id: businesses.id, name: businesses.name, ownerEmail: users.email })
    .from(businesses)
    .innerJoin(users, eq(users.id, businesses.ownerUserId))
    .where(eq(users.role, "admin"))
    .orderBy(businesses.createdAt);

  const clipRows = await db
    .select()
    .from(textBlockClips)
    .where(eq(textBlockClips.active, true))
    .orderBy(textBlockClips.createdAt);

  const renderRows = await db
    .select({
      id: videoRenders.id,
      businessId: videoRenders.businessId,
      businessName: businesses.name,
      status: videoRenders.status,
      params: videoRenders.params,
      filePath: videoRenders.filePath,
      error: videoRenders.error,
      createdAt: videoRenders.createdAt,
    })
    .from(videoRenders)
    .innerJoin(businesses, eq(businesses.id, videoRenders.businessId))
    .where(eq(videoRenders.service, "c"))
    .orderBy(desc(videoRenders.createdAt))
    .limit(30);

  const storage = getStorage();
  const clips = [];
  for (const clip of clipRows) {
    if (!clip.filePath.includes("/")) continue;
    clips.push({
      id: clip.id,
      url: await storage.signedUrl(clip.filePath, SIGNED_URL_TTL_SECONDS),
      durationMs: clip.durationMs,
      speakerGender: clip.speakerGender as SpeakerGender,
      textSafeArea: clip.textSafeArea as SafeRect,
      textColor: clip.textColor as HookTextColor,
    });
  }

  const renders = [];
  for (const render of renderRows) {
    const params = render.params as { text?: string };
    renders.push({
      id: render.id,
      businessId: render.businessId,
      businessName: render.businessName,
      status: render.status,
      text: params.text ?? "",
      error: render.error ?? undefined,
      createdAt: render.createdAt.toISOString(),
      downloadUrl:
        render.status === "released" && render.filePath
          ? await storage.signedUrl(render.filePath, SIGNED_URL_TTL_SECONDS, {
              download: `tavnit-text-block-${render.createdAt.toISOString().slice(0, 10)}-${render.id.slice(0, 8)}.mp4`,
            })
          : undefined,
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-white">גוש טקסט — יצירה</h1>
        <Link href="/text-blocks" className="text-sm font-medium text-accent hover:underline">
          → הקליפים
        </Link>
      </div>
      <TextBlockStudio businesses={businessRows} clips={clips} renders={renders} />
    </div>
  );
}

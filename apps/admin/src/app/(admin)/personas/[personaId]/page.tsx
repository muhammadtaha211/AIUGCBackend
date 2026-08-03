import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, getStorage, schema } from "@aiugc/core";
import { adminSession, SIGNED_URL_TTL_SECONDS } from "@/lib/api";
import { isUuid } from "@/lib/admin";
import { CopyId } from "../copy-id";
import { ImageCard } from "./image-card";
import { UploadImage } from "./upload-image";

/**
 * One persona: every reference image (retired ones grayed, never hidden — they
 * can be un-retired), with the per-image actions and the crop-and-upload form.
 */
export default async function AdminPersonaDetailPage({
  params,
}: {
  params: Promise<{ personaId: string }>;
}) {
  const { personaId } = await params;
  const db = getDb();
  const session = await adminSession(db);
  if (!session) redirect("/login");

  if (!isUuid(personaId)) notFound();
  const personaRows = await db
    .select()
    .from(schema.personas)
    .where(eq(schema.personas.id, personaId))
    .limit(1);
  const persona = personaRows[0];
  if (!persona) notFound();

  const imageRows = await db
    .select()
    .from(schema.personaImages)
    .where(eq(schema.personaImages.personaId, personaId))
    .orderBy(schema.personaImages.createdAt);

  const storage = getStorage();
  const images = [];
  for (const image of imageRows) {
    // A stranded "pending" placeholder (crashed upload) has nothing to show.
    if (!image.filePath.includes("/")) continue;
    images.push({
      id: image.id,
      url: await storage.signedUrl(image.filePath, SIGNED_URL_TTL_SECONDS),
      kind: image.kind,
      label: image.label,
      isDefault: image.isDefault,
      retired: image.retired,
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-white">{persona.name}</h1>
        <span className="text-sm text-gray-400">
          {persona.gender === "female" ? "נקבה" : persona.gender === "male" ? "זכר" : "ללא מגדר"}
        </span>
        <span className="font-mono text-xs text-gray-400" dir="ltr">
          {persona.voiceId}
        </span>
        <CopyId id={persona.id} />
      </div>

      <div className="mt-6">
        <UploadImage personaId={persona.id} />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {images.map((image) => (
          <ImageCard key={image.id} image={image} />
        ))}
        {images.length === 0 && (
          <p className="col-span-full text-sm text-gray-500">
            אין תמונות עדיין — מעלים תמונת ייחוס ראשונה למעלה.
          </p>
        )}
      </div>
    </div>
  );
}

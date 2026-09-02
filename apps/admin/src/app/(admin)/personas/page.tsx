import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, getStorage, schema } from "@aiugc/core";
import { adminSession, SIGNED_URL_TTL_SECONDS } from "@/lib/api";
import { CopyId } from "./copy-id";
import { CreatePersonaForm } from "./create-persona-form";

/**
 * Persona bank: every persona (active or not) with a thumbnail — so the founder
 * sees who each row is, not just a name — and its usable image count.
 */
export default async function AdminPersonasPage() {
  const db = getDb();
  const session = await adminSession(db);
  if (!session) redirect("/login");

  const { personas, personaImages } = schema;
  const rows = await db.select().from(personas).orderBy(personas.createdAt);
  // One query for every live image, grouped in memory: the thumbnail pick
  // needs kind/default/createdAt, and the count is the same non-retired set.
  const imageRows = await db.select().from(personaImages).where(eq(personaImages.retired, false));
  const imagesByPersona = new Map<string, typeof imageRows>();
  for (const image of imageRows) {
    imagesByPersona.set(image.personaId, [...(imagesByPersona.get(image.personaId) ?? []), image]);
  }

  const storage = getStorage();
  const thumbnails = new Map<string, string>();
  for (const persona of rows) {
    // Same preference as the customer-facing avatar card (apps/web's
    // personaThumbnail): a stored file, kind='preview' first, then the
    // default, then the newest. A "pending" placeholder has nothing to show.
    const usable = (imagesByPersona.get(persona.id) ?? [])
      .filter((image) => image.filePath.includes("/"))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const pick =
      usable.find((image) => image.kind === "preview") ??
      usable.find((image) => image.isDefault) ??
      usable[0];
    if (!pick) continue;
    // A pre-catalog row signs on the fly, and signing throws when the object
    // is gone (hand-edited rows exist) — one orphan must not 500 the whole
    // list; that persona just shows the placeholder tile.
    try {
      thumbnails.set(
        persona.id,
        pick.catalogPath
          ? storage.publicUrl(pick.catalogPath)
          : await storage.signedUrl(pick.filePath, SIGNED_URL_TTL_SECONDS),
      );
    } catch {
      // placeholder tile
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-white">דמויות</h1>

      <div className="mt-6 overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-start text-[13px] text-gray-500">
              <th className="px-4 py-2.5 text-start font-medium">תמונה</th>
              <th className="px-4 py-2.5 text-start font-medium">שם</th>
              <th className="px-4 py-2.5 text-start font-medium">מגדר</th>
              <th className="px-4 py-2.5 text-start font-medium">קול</th>
              <th className="px-4 py-2.5 text-start font-medium">תמונות</th>
              <th className="px-4 py-2.5 text-start font-medium">מזהה</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((persona) => {
              const thumbnail = thumbnails.get(persona.id);
              return (
                <tr key={persona.id} className="border-b border-white/5 last:border-b-0">
                  <td className="px-4 py-2.5">
                    <Link href={`/personas/${persona.id}`} className="block w-8">
                      {thumbnail ? (
                        // Signed URLs expire — plain img, no next/image loader.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={thumbnail}
                          alt={persona.name}
                          className="h-14 w-8 rounded border border-white/10 object-cover"
                        />
                      ) : (
                        <span className="block h-14 w-8 rounded border border-dashed border-white/15 bg-white/5" />
                      )}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/personas/${persona.id}`}
                      className="font-medium text-white hover:text-accent"
                    >
                      {persona.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-gray-300">
                    {persona.gender === "female" ? "נקבה" : persona.gender === "male" ? "זכר" : "—"}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-400" dir="ltr">
                    {persona.voiceId}
                  </td>
                  <td className="px-4 py-2.5 text-gray-300">
                    {(imagesByPersona.get(persona.id) ?? []).length}
                  </td>
                  <td className="px-4 py-2.5">
                    <CopyId id={persona.id} />
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                  אין דמויות עדיין.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-8">
        <h2 className="text-base font-semibold text-white">דמות חדשה</h2>
        <div className="mt-3 max-w-md">
          <CreatePersonaForm />
        </div>
      </div>
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@aiugc/core";
import { adminSession } from "@/lib/api";
import { CopyId } from "./copy-id";
import { CreatePersonaForm } from "./create-persona-form";

/** Persona bank: every persona (active or not) with its usable image count. */
export default async function AdminPersonasPage() {
  const db = getDb();
  const session = await adminSession(db);
  if (!session) redirect("/login");

  const { personas, personaImages } = schema;
  const rows = await db.select().from(personas).orderBy(personas.createdAt);
  const counts = await db
    .select({ personaId: personaImages.personaId, count: sql<string>`count(*)` })
    .from(personaImages)
    .where(eq(personaImages.retired, false))
    .groupBy(personaImages.personaId);
  const countByPersona = new Map(counts.map((row) => [row.personaId, Number(row.count)]));

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-white">דמויות</h1>

      <div className="mt-6 overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-start text-[13px] text-gray-500">
              <th className="px-4 py-2.5 text-start font-medium">שם</th>
              <th className="px-4 py-2.5 text-start font-medium">מגדר</th>
              <th className="px-4 py-2.5 text-start font-medium">קול</th>
              <th className="px-4 py-2.5 text-start font-medium">תמונות</th>
              <th className="px-4 py-2.5 text-start font-medium">מזהה</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((persona) => (
              <tr key={persona.id} className="border-b border-white/5 last:border-b-0">
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
                <td className="px-4 py-2.5 text-gray-300">{countByPersona.get(persona.id) ?? 0}</td>
                <td className="px-4 py-2.5">
                  <CopyId id={persona.id} />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
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

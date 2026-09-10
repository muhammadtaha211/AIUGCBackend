import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@aiugc/core";
import { authedUser } from "@/lib/auth-user";
import { BUSINESS_COOKIE, pickSelectedBusiness } from "@/lib/service-b-ui";
import { createServerSupabase } from "@/lib/supabase/server";
import { FeedbackForm } from "./feedback-form";

/**
 * The sidebar's צור קשר: one textarea that goes straight to the founder. No
 * mailto anywhere on this page — the whole point is that the message lands in
 * the database where it can be read next to the account that wrote it.
 *
 * The business id is resolved here rather than read from the cookie in the
 * browser: the cookie is client-writable, and passing only a business this
 * user actually owns means the route's ownership gate can never be what the
 * customer sees fail.
 */
export default async function FeedbackPage() {
  const supabase = await createServerSupabase();
  // authedUser throws on a FAILED read rather than letting it collapse into
  // "signed out" — see the note in @/lib/auth-user. A null user still means
  // exactly what it always did.
  const user = authedUser(await supabase.auth.getUser());
  if (!user) redirect("/start");

  const businesses = await getDb()
    .select({ id: schema.businesses.id })
    .from(schema.businesses)
    .where(eq(schema.businesses.ownerUserId, user.id))
    .orderBy(asc(schema.businesses.createdAt));

  const cookieStore = await cookies();
  const selected = pickSelectedBusiness(businesses, cookieStore.get(BUSINESS_COOKIE)?.value);

  return (
    <div className="mx-auto w-full max-w-2xl px-6 pb-16 pt-8 sm:pt-10">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">צור קשר</h1>
      <p className="mt-2 text-[15px] text-ink/65">
        מה שתכתבו כאן מגיע ישירות אלינו — אנחנו קוראים כל הודעה.
      </p>

      <FeedbackForm businessId={selected?.id ?? null} email={user.email ?? ""} />
    </div>
  );
}

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import {
  createBusiness,
  getDb,
  normalizeEmail,
  questionnaireSchema,
  schema,
  setQuestionnaire,
} from "@aiugc/core";
import { GENERIC_ERROR } from "@/lib/api-errors";
import { authReadFailed } from "@/lib/auth-user";
import { draftToQuestionnairePayload, emptyDraft, type OnboardingDraft } from "@/lib/onboarding";
import { createServerSupabase } from "@/lib/supabase/server";

const INVALID_MESSAGE = "חסרים פרטים בשאלון — חזרו למסכים הקודמים והשלימו אותם.";

/**
 * Persist the wizard draft: users row (id = auth uid) -> business ->
 * questionnaire, via the same core functions the CLI uses. Idempotent — an
 * existing owner gets their business back and nothing is created — unless the
 * body carries allowCreate: true (the signed-in "הוסף עסק" wizard), which
 * creates an additional business for the same owner.
 *
 * Every 200 carries `stored`: true when THESE answers were written, false when
 * the idempotent guard handed back a business that already existed and the
 * posted questionnaire was dropped. The two are indistinguishable without it,
 * and a caller that reads a 200 as "saved" deletes a questionnaire nobody
 * kept — docs/vault/defects/login-clears-a-draft-the-server-never-stored.md.
 */
export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  // 503, not 401 — same reasoning as requireUser in @/lib/api, and it matters
  // more here: this is the route the onboarding wizard posts a filled-in
  // questionnaire to. A 401 tells the browser the session died and the draft
  // has nowhere to go; a 503 is "try again", which is what a GoTrue blip is.
  // authReadFailed rather than a bare error check, because getUser resolves an
  // AuthSessionMissingError for the ordinary signed-out case — which the public
  // signup flow hits on every completion, and which IS a 401.
  if (authReadFailed(authError)) {
    console.error("onboarding/complete: auth read failed", authError);
    return NextResponse.json({ ok: false, error: GENERIC_ERROR }, { status: 503 });
  }
  if (!user) {
    return NextResponse.json({ ok: false, error: "צריך להתחבר קודם." }, { status: 401 });
  }
  if (!user.email) {
    return NextResponse.json(
      { ok: false, error: "לחשבון אין כתובת אימייל — הרשמו עם אימייל וסיסמה." },
      { status: 400 },
    );
  }

  let payload: Record<string, unknown>;
  let allowCreate = false;
  try {
    const body = (await request.json()) as Partial<OnboardingDraft> & { allowCreate?: boolean };
    allowCreate = body.allowCreate === true;
    payload = draftToQuestionnairePayload({ ...emptyDraft, ...body });
  } catch {
    return NextResponse.json({ ok: false, error: INVALID_MESSAGE }, { status: 400 });
  }
  const parsed = questionnaireSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: INVALID_MESSAGE }, { status: 400 });
  }
  const questionnaire = parsed.data;

  try {
    const db = getDb();
    const { users, businesses } = schema;

    // RLS scopes every read by auth.uid(), so the owner row MUST be the row
    // whose users.id equals the auth uid (the 0002 trigger mirrors it). Never
    // resolve by email alone — an email match with a different id would make
    // every subsequent RLS read return nothing.
    const byId = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    if (!byId[0]) {
      // Normalised on the way in: users_email_unique is case-sensitive, so an
      // unnormalised write here could sit alongside a differently-cased row for
      // the same person (see normalizeEmail in core).
      await db.insert(users).values({ id: user.id, email: normalizeEmail(user.email) });
    }

    // Idempotent: an existing account signing in mid-wizard keeps its business.
    // allowCreate (signed-in "הוסף עסק") deliberately skips the guard.
    if (!allowCreate) {
      const owned = await db
        .select()
        .from(businesses)
        .where(eq(businesses.ownerUserId, user.id))
        .limit(1);
      if (owned[0]) {
        // stored: false — this returns BEFORE setQuestionnaire below, so the
        // answers in this request were never written anywhere.
        return NextResponse.json({ ok: true, businessId: owned[0].id, stored: false });
      }
    }

    // Pass the resolved row's stored email so core's ensureUser (which matches
    // by email) lands on the id = auth uid row we just anchored.
    const ownerEmail = byId[0]?.email ?? user.email;
    const business = await createBusiness(db, {
      ownerEmail,
      name: questionnaire.product_name,
    });
    await setQuestionnaire(db, business.id, questionnaire);

    return NextResponse.json({ ok: true, businessId: business.id, stored: true });
  } catch (err) {
    console.error("onboarding/complete failed", err);
    return NextResponse.json(
      { ok: false, error: "השמירה נכשלה. נסו שוב בעוד רגע." },
      { status: 500 },
    );
  }
}

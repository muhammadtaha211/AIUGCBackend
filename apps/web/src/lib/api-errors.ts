import {
  AccountBudgetError,
  ContentPolicyError,
  InsufficientCreditsError,
  PlanChangeError,
} from "@aiugc/core";

/**
 * Pure, unit-testable part of the HTTP error layer: the decision of which
 * status and which Hebrew line a core pipeline error becomes. api.ts wires
 * this to NextResponse and to the log. Mirrors src/lib/service-a.ts and
 * src/lib/service-b.ts — no `@/` imports, so tests reach it directly.
 *
 * Order is load-bearing: these are substring tests and the FIRST match wins.
 * Adding a mapping means checking it is not shadowed by an earlier one and
 * does not shadow a later one.
 */

export const GENERIC_ERROR = "משהו השתבש. נסו שוב בעוד רגע.";
export const NOT_FOUND = "לא נמצא.";
export const INVALID_BODY = "הבקשה לא תקינה.";
/** The 503 every charge path answers until a gateway adapter exists. */
export const PAYMENTS_SOON = "התשלום המקוון יופעל בקרוב.";

export type CoreErrorMapping = {
  status: number;
  error: string;
  /** false = nothing matched; the caller logs it and the customer gets the generic 500. */
  mapped: boolean;
};

// Every 429 this returns is a quota refusal, not a transient failure: the
// rolling window has to clear before the same request can succeed, and the
// customer cannot raise their own cap. Clients must not offer "try again" on
// one — see the quotaBlocked handling in components/a-wizard/step-plan.tsx.
// (This module imports @aiugc/core and is therefore server-only; the client
// compares result.status directly rather than importing a helper from here.)

export function coreErrorMapping(err: unknown): CoreErrorMapping {
  const message = err instanceof Error ? err.message : "";
  const hit = (status: number, error: string): CoreErrorMapping => ({
    status,
    error,
    mapped: true,
  });

  // First, and by `instanceof` rather than by substring, on purpose. The rule
  // above is that the first match wins, and this error's message carries a
  // category string the classifier chose — free text from a model, which is
  // exactly the kind of thing that could one day contain "not found" and get
  // answered with a 404. A typed check cannot be shadowed and cannot shadow:
  // nothing below tests for this class.
  if (err instanceof ContentPolicyError) {
    // 422, not 400: the request is well-formed and the customer is allowed to
    // make it — the CONTENT is what is refused. Never surfaces `category` or
    // `reason`: both are English strings a model wrote, and `reason` quotes the
    // customer's own text back at them.
    return hit(
      422,
      "התוכן לא עבר את בדיקת התוכן שלנו. עדכנו את השאלון או את הטקסט שנבחר ונסו שוב.",
    );
  }

  // The runaway-cost guards phrase their own refusal in Hebrew, in the
  // "system limit, contact support" register — pass it through rather than
  // re-writing it here. It is NOT a product duration limit and must not be
  // re-worded into one (see MAX_B_SCRIPT_WORDS / MAX_LIPSYNC_SECONDS).
  if (/חורג מהמגבלה לעיבוד/.test(message)) return hit(400, message);
  if (/has no questionnaire yet/.test(message)) {
    return hit(400, "צריך למלא קודם את שאלון העסק.");
  }
  if (/is not voiceable/.test(message)) return hit(400, "אי אפשר להקליט תסריט מהסוג הזה.");
  if (/not found/.test(message)) return hit(404, NOT_FOUND);
  if (/audio must be approved/.test(message)) {
    return hit(409, "צריך לאשר את האודיו לפני יצירת הסרטון.");
  }
  // The steps-format hard gate (sets.ts) — the second of the two approval
  // gates the web reaches, and the one that used to fall through to a
  // generic 500. (The composite gate's line left with the composite routes.)
  if (/step plan must be approved/.test(message)) {
    return hit(409, "צריך לאשר את תוכנית הצעדים לפני יצירת הסרטון.");
  }
  if (/is retired/.test(message)) {
    return hit(400, "התמונה הזאת הוסרה — בחרו תמונה אחרת.");
  }
  if (/is not ready yet/.test(message)) return hit(409, "עוד לא מוכן — נסו שוב בעוד רגע.");
  // Two callers phrase this differently: sets.ts throws the bare "demo is not
  // ready", copy.ts throws `demo ${demoId} is not ready (status: …)`. A plain
  // /demo is not ready/ misses the second one — the uuid sits between the two
  // halves — so the vo-script route answered a not-ready demo with a generic
  // 500. Anchored at the start so it cannot swallow the analysis/composite
  // "is not ready" messages, which have their own lines above.
  if (/^demo\b.*is not ready/.test(message)) {
    return hit(409, "סרטון המוצר עדיין בעיבוד — נסו שוב בעוד רגע.");
  }
  if (/has no ready analysis/.test(message)) {
    return hit(409, "ניתוח הסרטון עדיין לא מוכן — נסו שוב עוד רגע.");
  }
  if (/only ready plans are editable/.test(message)) {
    return hit(409, "אפשר לערוך רק תוכנית מוכנה.");
  }
  if (/only ready plans can be approved/.test(message)) {
    return hit(409, "אפשר לאשר רק תוכנית מוכנה.");
  }
  if (/needs at least one step/.test(message)) {
    return hit(400, "התוכנית צריכה לפחות צעד אחד.");
  }
  // Step-shape rejections from updatePlanSteps: a well-behaved picker never
  // sends these (it mirrors the same filters), so the generic Hebrew suffices.
  if (
    /not in the analysis timeline|appears twice|unreadable state|empty label|label is over/.test(
      message,
    )
  ) {
    return hit(400, INVALID_BODY);
  }
  if (/demo note is empty/.test(message)) return hit(400, INVALID_BODY);
  if (/demo notes limit reached/.test(message)) {
    return hit(400, "הגעתם למגבלת ההערות על הסרטון.");
  }
  if (/daily audio preview limit/.test(message)) {
    return hit(429, "הגעתם למכסת ההשמעות היומית — נסו שוב מחר.");
  }
  // The per-account abuse ceiling. A fast rejection on purpose: the
  // platform-wide cap parks the job instead, and a parked job spins forever.
  if (err instanceof AccountBudgetError) {
    // The core message names the capped kind — GPU caps refuse renders, TTS
    // caps refuse recordings, LLM caps refuse plan/copy generation; the
    // Hebrew should say which.
    return hit(
      429,
      /gpu_seconds/.test(err.message)
        ? "הגעתם למכסת יצירת הסרטונים היומית של החשבון — נסו שוב מחר."
        : /llm_tokens/.test(err.message)
          ? "הגעתם למכסת יצירת התוכן היומית של החשבון — נסו שוב מחר."
          : "הגעתם למכסת ההקלטות היומית של החשבון — נסו שוב מחר.",
    );
  }
  // Typed, so the shortfall is a number the UI can render — not text scraped
  // back out of an English message.
  if (err instanceof InsufficientCreditsError) {
    return hit(402, `אין מספיק קרדיטים ליצירת הסרטון — חסרים ${err.shortfall}.`);
  }
  // Typed by `code`, so the account page can answer each refusal in its own
  // words. 404 for no subscription (nothing to change), 409 for a subscription
  // in a state that cannot change or a request with nothing to undo, 400 for
  // a plan code that is not on the ladder.
  if (err instanceof PlanChangeError) {
    switch (err.code) {
      case "no_subscription":
        return hit(404, "אין מנוי פעיל בחשבון הזה.");
      case "not_active":
        return hit(
          409,
          "אי אפשר לשנות מסלול כשהתשלום האחרון לא הצליח. עדכנו את אמצעי התשלום קודם.",
        );
      case "nothing_pending":
        return hit(409, "אין שינוי ממתין לביטול.");
      case "no_recurring_ref":
        return hit(409, "אין אמצעי תשלום שמור בחשבון הזה.");
      case "unknown_plan":
        return hit(400, INVALID_BODY);
    }
  }
  // NotConfiguredGateway (billing.ts) — the checkout is a deliberate dead end
  // until the gateway adapter exists. 503, not 500: the request was fine and
  // the customer can come back.
  if (/no payment gateway configured/.test(message)) return hit(503, PAYMENTS_SOON);
  return { status: 500, error: GENERIC_ERROR, mapped: false };
}

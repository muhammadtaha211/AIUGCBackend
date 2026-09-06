import { AccountBudgetError, InsufficientCreditsError } from "@aiugc/core";

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

  if (/ארוך מדי/.test(message)) return hit(400, message); // word budget — already Hebrew
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
  return { status: 500, error: GENERIC_ERROR, mapped: false };
}

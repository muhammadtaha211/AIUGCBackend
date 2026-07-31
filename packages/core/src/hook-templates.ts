/**
 * Founder-curated hook openers, adapted to spoken Israeli Hebrew.
 *
 * These are the FIRST LINE only — the beat that has to stop the scroll. The
 * rest of the script comes from the structure skeleton. Placeholders in
 * {curly braces} are filled from the questionnaire; a template whose
 * placeholders the questionnaire cannot support must not be chosen.
 *
 * Grammatical gender: written for a female persona (the common UGC case).
 * Past-tense first person is genderless in Hebrew, so most of these work
 * as-is; the prompt instructs the model to conjugate present-tense verbs and
 * self-reference to the persona's gender.
 *
 * Why a random subset rather than all 25 in the prompt: a model handed 25
 * options converges on the same three or four. Injecting a random handful per
 * generation is what actually produces variety across a customer's ads —
 * the same reason structures are picked at random.
 */
export const HOOK_TEMPLATES: readonly string[] = [
  // --- sensory / first-reaction -------------------------------------------
  "לא ציפיתי שזה יהיה כל כך טוב",
  "תראו את זה רגע — {הצגת המוצר}",

  // --- insider / secret ---------------------------------------------------
  "סודות של {תחום} שאף אחד לא מספר לכם",
  "אלה שלושת הדברים הכי חשובים שאתם צריכים לדעת על {תחום}",
  "אתם רוצים לדעת מה הסוד ל{תוצאה}? זה {מוצר}",

  // --- warning / mistake --------------------------------------------------
  "אלה הדברים הכי גרועים שאתם יכולים לעשות כש{בעיה}",
  "{פתרון מיושן} פשוט מת ב-2026, כולם עברו ל{מוצר}",
  "אנשים כבר לא משתמשים ב{פתרון מיושן}, ובצדק — {למה זה לא עובד}",
  "{בעיה} לא מתרשמת מ{פתרון מיושן}, הסוד זה {מוצר}",

  // --- social proof -------------------------------------------------------
  "ראיתי המון אנשים משתמשים ב{מוצר} ומספרים על שיפור ענק",
  "אנשים כבר מבינים את זה, ואתם נשארים מאחור",

  // --- superlative --------------------------------------------------------
  "המוצר הכי טוב ל{תחום} ב-2026",
  "זה אחד מהמוצרים הכי טובים שיש ל{תחום}",
  "ה{מוצר} הכי טוב שראיתי בתור {תפקיד מקצועי}",

  // --- personal result ----------------------------------------------------
  "זה בדיוק המוצר שאיתו {תוצאה}",
  "אם אתם מנסים {לפתור בעיה} ולא רואים תוצאות, אני עומדת לשנות לכם את החיים",

  // --- disbelief / too-good -----------------------------------------------
  "למה אף אחד לא סיפר לי על זה קודם? זה פשוט מטורף",
  "ממש מפחיד כמה ש{מוצר} טוב",
  "איך זה בכלל חוקי? זה טוב מדי מכדי להיות אמיתי",
  "{מוצר} טוב מדי, {סבל מהצלחה}",

  // --- ease / timing ------------------------------------------------------
  "אף פעם לא היה כזה קל {לפתור בעיה}",
  "עכשיו הזמן הכי טוב {לפתור בעיה}",

  // --- loss aversion ------------------------------------------------------
  "זה מה שאתם מפספסים אם אתם לא משתמשים ב{מוצר}",
  "אם {כאב של קהל היעד}, אתם חייבים את זה",
  "{כאב של קהל היעד} — ואתם ממש לא חייבים להישאר שם",
];

/** How many templates to offer the script model per generation. */
export const HOOK_OPTIONS_PER_GENERATION = 3;

/**
 * A random subset, without repetition. Called once per script generation and
 * rendered into the b_script prompt as {{hook_options}}. The chosen indices
 * are worth recording on scripts.params so a winning hook can be traced back.
 */
export function pickHookTemplates(
  count: number = HOOK_OPTIONS_PER_GENERATION,
  pool: readonly string[] = HOOK_TEMPLATES,
): string[] {
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

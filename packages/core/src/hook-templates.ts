/**
 * Founder-curated hook openers, adapted to spoken Israeli Hebrew.
 *
 * v2 — two changes from the first pass, both from reading real output:
 *
 * 1. NO TEMPLATE NAMES THE PRODUCT. A hook containing the brand name tells the
 *    viewer it's an ad in the first two seconds, and everything after it is
 *    discounted. The product is referred to obliquely — זה, המוצר הזה, משהו —
 *    and the name lands late, in the reveal beat. This was the single biggest
 *    problem with the first generation of scripts.
 *
 * 2. Written in FEMININE SINGULAR throughout, one consistent form. Mixing
 *    audience forms (אתם רוצות, אתם חייבות) is ungrammatical and was appearing
 *    in real output because these templates were plural while the persona and
 *    the product pulled feminine. The prompt converts to whatever form
 *    target_audience implies — but it converts from one consistent starting
 *    point, which is what stops the mixing.
 *
 * Placeholders in {curly braces} come from the questionnaire. A template whose
 * placeholders the questionnaire cannot support must not be chosen.
 */
export const HOOK_TEMPLATES: readonly string[] = [
  // --- sensory / first-reaction -------------------------------------------
  "לא ציפיתי שזה יהיה ככה טוב",
  "תראי את זה רגע",

  // --- insider / secret ---------------------------------------------------
  "אני הולכת לגלות לך את הסוד ל{תוצאה}",
  "הסוד ל{תוצאה} הרבה יותר פשוט ממה שחשבת",
  "אף אחד לא הולך לספר לך את זה על {תחום}",
  "אלה שלושת הדברים שאת חייבת לדעת על {תחום}",

  // --- warning / mistake --------------------------------------------------
  "אלה הדברים הכי גרועים שאת יכולה לעשות כש{בעיה}",
  "{פתרון מיושן} פשוט מת ב-2026",
  "אנשים כבר לא משתמשים ב{פתרון מיושן}, ובצדק — {למה זה לא עובד}",
  "{בעיה} לא מתרשמת מ{פתרון מיושן}, וזה מה שכן עובד",

  // --- social proof -------------------------------------------------------
  "ראיתי המון אנשים עוברים לזה ומספרים על שיפור ענק",
  "אנשים כבר מבינים את זה, ואת נשארת מאחור",

  // --- superlative --------------------------------------------------------
  "מצאתי את הדבר הכי טוב ל{תחום} שיש ב-2026",
  "זה ה{תחום} הכי טוב שראיתי בתור {תפקיד מקצועי}",

  // --- personal result ----------------------------------------------------
  "זה בדיוק מה שעשיתי כדי {תוצאה}",
  "אם את מנסה {לפתור בעיה} ולא רואה תוצאות, אני עומדת לשנות לך את החיים",

  // --- disbelief / too-good -----------------------------------------------
  "למה אף אחד לא סיפר לי על זה קודם, זה פשוט מטורף",
  "ממש מפחיד כמה שהמוצר הזה טוב",
  "איך זה בכלל חוקי, זה טוב מדי מכדי להיות אמיתי",
  "זה טוב מדי, {סבל מהצלחה}",

  // --- ease / timing ------------------------------------------------------
  "אף פעם לא היה כזה קל {לפתור בעיה}",
  "עכשיו הזמן הכי טוב {לפתור בעיה}",

  // --- loss aversion ------------------------------------------------------
  "זה מה שאת מפספסת ואף אחד לא מספר לך",
  "אם {כאב של קהל היעד}, את חייבת את זה",
  "{כאב של קהל היעד} — ואת ממש לא חייבת להישאר שם",
];

/** How many templates to offer the script model per generation. */
export const HOOK_OPTIONS_PER_GENERATION = 3;

/**
 * A random subset, without repetition. Called once per script generation and
 * rendered into the b_script prompt as {{hook_options}}. The chosen templates
 * are recorded on scripts.params so a winning hook can be traced back.
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

import { z } from "zod";

/**
 * Service C, גוש טקסט (decisions 0089–0091): the vocabulary and the validator
 * for the one Hebrew text block burned over a bank clip. Pure zod and string
 * math, no server imports — bundled into the admin client through the
 * "@aiugc/core/text-block" subpath, so the editor's live check and the
 * generation, edit and render checks read one rule.
 *
 * The ten skeletons themselves — the move, where the product lands, the notes
 * and the founder's Hebrew example — live in prompts/text_block/v<N>.md, the
 * way hook_lines keeps its frame library in the prompt: a skeleton change is a
 * new prompt version, never a code change. Only the ids (for the validator)
 * and a Hebrew label (for the admin UI) live here. The examples are repeated
 * below as the DRY_RUN stand-in; a test asserts the prompt carries each one
 * verbatim, and another pins each to the founder's literal text, so neither
 * can drift.
 *
 * Two checks, two scopes (0091, amended 2026-10-07): `textBlockTextError` is
 * the render rule — what can be burned — and runs on generation, on the
 * admin's edit and at render creation. `findGeneratedTextBlockDash` is a
 * generation rule only: the model's output is refused for an em or en dash;
 * an edited text is not checked for it.
 */

export const TEXT_BLOCK_SKELETONS = [
  { id: "reframe", label: "קשה, עד שמבינים" },
  { id: "instead", label: "במקום זה" },
  { id: "shoutout_hack", label: "שאפו למי שגילה" },
  { id: "wish_more_knew", label: "הלוואי שיותר אנשים היו יודעים" },
  { id: "founder_ask", label: "רעיון גרוע או גאוני?" },
  { id: "relatable_observation", label: "אין לי מושג איך אתם עושים את זה" },
  { id: "quiz", label: "חידון" },
  { id: "discovery", label: "לא רוצה להלחיץ" },
  { id: "envy_portrait", label: "יש את האחד הזה בכל" },
  { id: "cautionary_confession", label: "אל תעשו את זה, תגמרו כמוני" },
] as const;

export type TextBlockSkeletonId = (typeof TEXT_BLOCK_SKELETONS)[number]["id"];

export const TEXT_BLOCK_SKELETON_IDS: readonly TextBlockSkeletonId[] = TEXT_BLOCK_SKELETONS.map(
  (s) => s.id,
);

export function isTextBlockSkeletonId(value: string): value is TextBlockSkeletonId {
  return (TEXT_BLOCK_SKELETON_IDS as readonly string[]).includes(value);
}

/** The admin UI's heading for a skeleton; an unknown id shows as itself. */
export function textBlockSkeletonLabel(id: string): string {
  return TEXT_BLOCK_SKELETONS.find((s) => s.id === id)?.label ?? id;
}

/**
 * The hard cap, in code points: 450 (founder, planning chat of 2026-10-07,
 * superseding his 400 of 2026-10-07/08). The prompt still asks for 400 at
 * most; the 50 above it are a margin, so one text that runs a little long
 * does not fail the whole batch after its one retry. A render-time rule: a
 * 450-character text in three paragraphs fits the default area at 44–48 px,
 * above the 40 px floor (0090, amended).
 */
export const TEXT_BLOCK_MAX_CHARS = 450;

export const SPEAKER_GENDERS = ["female", "male"] as const;
export type SpeakerGender = (typeof SPEAKER_GENDERS)[number];
export const speakerGenderSchema = z.enum(SPEAKER_GENDERS);
export const SPEAKER_GENDER_LABEL: Record<SpeakerGender, string> = {
  female: "דוברת",
  male: "דובר",
};

/**
 * Characters that survive the burn: the hook-line set (copy.ts
 * ILLEGAL_HOOK_LINE_CHAR, en and em dash included) plus the newline the
 * skeletons' line breaks need. Everything outside the
 * set — Arabic script, zero-width and formatting marks, emoji — either burns
 * as a stray glyph or corrupts the line invisibly. The long dashes burn fine;
 * keeping them out of generated text is findGeneratedTextBlockDash's job.
 */
// Written as escapes, not literals: a Hebrew range inside a character class
// reorders in every editor that renders bidi.
const ILLEGAL_TEXT_BLOCK_CHAR = new RegExp(
  "[^" +
    "\\u000A" + // newline, for the line breaks the skeletons ask for
    "\\u0020-\\u007E" + // space, digits, Latin, ASCII punctuation (incl. `-`)
    "\\u0590-\\u05FF" + // the Hebrew block
    "\\u2013\\u2014\\u2018\\u2019\\u201C\\u201D\\u2026\\u20AA" + // – — ‘ ’ “ ” … ₪
    "]",
  "u",
);

/**
 * The en and em dash, refused in the MODEL's output only (founder ruling
 * 2026-10-07/08: "it makes it come off as obviously AI"; the en dash with it,
 * planning's wording). A generated text with one gets the house
 * reject-and-retry; an edited text is never checked for it.
 */
const GENERATED_TEXT_BLOCK_DASH = /[–—]/u;

/** The first long dash in a generated text, as `U+2013` or `U+2014`, or undefined. */
export function findGeneratedTextBlockDash(text: string): "U+2013" | "U+2014" | undefined {
  const char = GENERATED_TEXT_BLOCK_DASH.exec(text)?.[0];
  if (char === undefined) return undefined;
  return char === "–" ? "U+2013" : "U+2014";
}

/** The first unrenderable character in a text, described for an error message. */
export function findIllegalTextBlockChar(
  text: string,
): { char: string; codepoint: string } | undefined {
  const char = ILLEGAL_TEXT_BLOCK_CHAR.exec(text)?.[0];
  if (char === undefined) return undefined;
  const hex = char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");
  return { char, codepoint: `U+${hex}` };
}

/**
 * Windows line endings to `\n`, runs of spaces and tabs inside a line to one
 * space, line ends and the outer edges trimmed — what is stored and burned.
 * The composition draws the block `pre-wrap`, which keeps every space, while
 * the fitter measures single-spaced lines; collapsing here keeps the two in
 * agreement for an edited text.
 */
export function normalizeTextBlockText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .trim();
}

/** Code points, the way a phone counts characters. */
export function textBlockLength(text: string): number {
  return [...text].length;
}

/**
 * Why a text cannot be burned, in Hebrew, or null when it can. The one check
 * generation, the edit route and the render creation all run — the format
 * adds no content rule to an edited text (0091 §11); these are render rules.
 * The dash rule is not one of them (findGeneratedTextBlockDash).
 */
export function textBlockTextError(text: string): string | null {
  const normalized = normalizeTextBlockText(text);
  if (normalized.length === 0) return "הטקסט ריק.";
  const length = textBlockLength(normalized);
  if (length > TEXT_BLOCK_MAX_CHARS) {
    return `הטקסט ארוך מדי — עד ${TEXT_BLOCK_MAX_CHARS} תווים, ויש בו ${length}.`;
  }
  const bad = findIllegalTextBlockChar(normalized);
  if (bad) return `הטקסט מכיל תו שלא ניתן לצרוב (${bad.codepoint}).`;
  return null;
}

/**
 * The founder's first example for each skeleton as `text_block` v2 carries
 * it: v1's ten with the five changes he approved verbatim on 2026-10-07
 * (`instead`'s opener on its own line, and a closing line of its own on
 * `reframe`, `shoutout_hack`, `envy_portrait` and `cautionary_confession`),
 * casual spelling and spacing included. They are the exemplars the prompt's
 * rules were written to match (0091, amended). The DRY_RUN batch, and what the
 * prompt tests pin; the two second examples live in the prompt only. Brand
 * names are invented placeholders.
 */
export const TEXT_BLOCK_EXAMPLES: Record<TextBlockSkeletonId, string> = {
  reframe:
    "ללמוד ערבית נשמע כמו רעיון טוב, עד שמבינים שאף אחד לא באמת מדבר כמו שמלמדים בבית הספר. זה קשה, אלא אם נעזרים ביוטיוב או באפליקציה שמלמדת ערבית מדוברת דרך שיחות אמיתיות, כמו Kalam או דברים בסגנון, ולא סתם עוד רשימת מילים שרק אנשים משנות ה 60 עדיין משתמשים בהם\n\nאני עוד תקועה ב'שוקראן'",
  instead:
    "קחו את זה ממני\n\nאל תחפשו רואה חשבון רק כשמגיע מכתב ממס הכנסה. במקום זה תסגרו את הפינה הזאת פעם אחת עם פלטפורמות כמו Sfarimo, שמפיקה חשבוניות ומגישה דוחות בשבילכם. זה לא נשמע מרגש, אבל זה ההבדל בין סוף שנה רגוע לבין סוף שנה שבו אתם מבלים את הלילה מול אקסל, מתחילים להזיע מכל הודעה מהבנק ומבינים ב-4 בבוקר שאתם כנראה חייבים למדינה יותר כסף ממה שיש לכם בחשבון.\n\n(ממש ממש ממש לא מניסיון אישי בכלל...)",
  shoutout_hack:
    "שאפו למי שגילה שאם כותבים את המשימה הכי מעצבנת ראשונה ברשימה, פתאום כל השאר נראות קלות. ושאפו כפול למי שהמציא את ה-Mesima הזאת, שמזכירה את המשימה בדיוק כשיושבים מול המחשב.\n\nנגמרו התירוציםםם",
  wish_more_knew:
    "הלוואי שיותר אנשים היו יודעים שרוב צמחי הבית מתים מעודף השקיה, לא ממחסור. אצבע באדמה לפני כל השקיה, וזהו. ולמי שאין כוח לנחש, ב-Yarokli כל עציץ מגיע עם הוראות טיפול שכתובות בשפה שבן אדם יכול להבין אותה",
  founder_ask:
    "אוקיי, בכנות… רעיון גרוע או גאוני?\n\nנמאס לנו לחכות שעה למספרה, אז בנינו אפליקציה שמראה איזו מספרה בשכונה פנויה עכשיו. פותחים, רואים מי פנוי, מזמינים תור בשתי לחיצות.\n\nקוראים לה Torli. נו, כן או לא?",
  relatable_observation:
    "בעלי עסקים שמצליחים לענות ידנית לעשרים הודעות מלקוחות ב-8 בערב בלי להשתמש ב-Sederly - אין לי מושג איך אתם עושים את זה, אבל שאפו.",
  quiz: "רוב הישראלים לא עונים נכון אפילו על אחת מאלה\n\n1. איזו עיר בארץ הכי גבוהה מעל פני הים?\n2. מי היה ראש הממשלה השני של ישראל?\n3. מאיפה מגיע השם תל אביב?\n\n(עוד שאלות כאלה ב-Eretzy)",
  discovery:
    "לא רוצה להלחיץ אף אחד, אבל יש אפליקציה שמראה לכם כל מסלול טיול בצפון בצילום אמיתי, מטר אחרי מטר, עוד לפני שיצאתם מהבית. קוראים לה Shvilo, היא כבר באוויר, ומי שעדיין מתכנן טיולים מתמונות באינסטגרם… בהצלחה",
  envy_portrait:
    "יש את הבחורה הזאת בכל משרד: מגיעה בתשע עם קפה ביד, יוצאת בחמש, אף פעם לא לחוצה לפני דדליין, בונה מצגות ב-Slidy במקום שקף שקף ביד, ואיכשהו דווקא המצגות שלה הן אלה שכולם מעתיקים.\n\nמישהו יכול להסביר לי את זה?",
  cautionary_confession:
    "בשנה הראשונה של העסק מאוד מפתה לשמור את כל הקבצים רק על הלפטופ. אל תעשו את זה, כי תגמרו כמוני. בשביל זה בדיוק יש גיבויים אוטומטיים כמו Zikaroni או דברים בסגנון ואז לא תצטרכו לבכות ב 3 בבוקר כי איבדתם את כל הקבצים פתאום\n\nאל תשאלו",
};

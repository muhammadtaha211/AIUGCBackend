import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROMPTS_DIR } from "../src/paths";
import { latestPromptVersion, renderPrompt } from "../src/prompts";
import {
  findGeneratedTextBlockDash,
  TEXT_BLOCK_EXAMPLES,
  TEXT_BLOCK_MAX_CHARS,
  TEXT_BLOCK_SKELETON_IDS,
  textBlockLength,
  textBlockTextError,
  type TextBlockSkeletonId,
} from "../src/text-block";

/**
 * text_block (decisions 0090–0091). v1 is frozen: it stamped the 2026-10-07
 * fixture rows, so its bytes are pinned. v2 carries the founder's rulings
 * from his review of Tavnit's 2026-10-07 batch (0091, amended 2026-10-07 for
 * v2): the closing line, the order inside `instead`, the familiar tool in
 * `reframe`, the payoff in `envy_portrait`, signature phrases, two second
 * examples. The rules are pinned as text — the prompt is the versioned
 * artifact and a rule going missing is the real signal.
 */

/**
 * The founder's ten texts as v1 carries them: nine from the 2026-10-07 brief
 * (casual spelling and spacing included — `ה 60`, `ב 3 בבוקר`, a stretched
 * last letter) and `shoutout_hack` as he replaced it on 2026-10-07/08.
 */
const V1_EXAMPLES: Record<TextBlockSkeletonId, string> = {
  reframe:
    "ללמוד ערבית נשמע כמו רעיון טוב, עד שמבינים שאף אחד לא באמת מדבר כמו שמלמדים בבית הספר. זה קשה, אלא אם משתמשים באפליקציה שמלמדת ערבית מדוברת דרך שיחות אמיתיות, כמו Kalam או דברים בסגנון, ולא סתם עוד רשימת מילים שרק אנשים משנות ה 60 עדיין משתמשים בהם",
  instead:
    "קחו את זה ממני, אל תחפשו רואה חשבון רק כשמגיע מכתב ממס הכנסה. במקום זה תסגרו את הפינה הזאת פעם אחת עם פלטפורמות כמו Sfarimo, שמפיקה חשבוניות ומגישה דוחות בשבילכם. זה לא נשמע מרגש, אבל זה ההבדל בין סוף שנה רגוע לבין סוף שנה שבו אתם מבלים את הלילה מול אקסל, מתחילים להזיע מכל הודעה מהבנק ומבינים ב-4 בבוקר שאתם כנראה חייבים למדינה יותר כסף ממה שיש לכם בחשבון.\n\n(ממש ממש ממש לא מניסיון אישי בכלל...)",
  shoutout_hack:
    "שאפו למי שגילה שאם כותבים את המשימה הכי מעצבנת ראשונה ברשימה, פתאום כל השאר נראות קלות. ושאפו כפול למי שהמציא את ה-Mesima הזאת, שמזכירה את המשימה בדיוק כשיושבים מול המחשב. נגמרו התירוציםםם",
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
    "יש את הבחורה הזאת בכל משרד: מגיעה בתשע עם קפה ביד, יוצאת בחמש, אף פעם לא לחוצה לפני דדליין, בונה מצגות ב-Slidy במקום שקף שקף ביד, ואיכשהו גם מספיקה חדר כושר.",
  cautionary_confession:
    "בשנה הראשונה של העסק מאוד מפתה לשמור את כל הקבצים רק על הלפטופ. אל תעשו את זה, כי תגמרו כמוני. בשביל זה בדיוק יש גיבויים אוטומטיים כמו Zikaroni או דברים בסגנון ואז לא תצטרכו לבכות ב 3 בבוקר כי איבדתם את כל הקבצים פתאום",
};

/**
 * v2's first examples: v1's ten with the five changes the founder approved
 * verbatim on 2026-10-07, and nothing else. A copy, not an import, so the
 * code and the prompt cannot drift from his text together.
 */
const V2_EXAMPLES: Record<TextBlockSkeletonId, string> = {
  ...V1_EXAMPLES,
  reframe:
    "ללמוד ערבית נשמע כמו רעיון טוב, עד שמבינים שאף אחד לא באמת מדבר כמו שמלמדים בבית הספר. זה קשה, אלא אם נעזרים ביוטיוב או באפליקציה שמלמדת ערבית מדוברת דרך שיחות אמיתיות, כמו Kalam או דברים בסגנון, ולא סתם עוד רשימת מילים שרק אנשים משנות ה 60 עדיין משתמשים בהם\n\nאני עוד תקועה ב'שוקראן'",
  instead:
    "קחו את זה ממני\n\nאל תחפשו רואה חשבון רק כשמגיע מכתב ממס הכנסה. במקום זה תסגרו את הפינה הזאת פעם אחת עם פלטפורמות כמו Sfarimo, שמפיקה חשבוניות ומגישה דוחות בשבילכם. זה לא נשמע מרגש, אבל זה ההבדל בין סוף שנה רגוע לבין סוף שנה שבו אתם מבלים את הלילה מול אקסל, מתחילים להזיע מכל הודעה מהבנק ומבינים ב-4 בבוקר שאתם כנראה חייבים למדינה יותר כסף ממה שיש לכם בחשבון.\n\n(ממש ממש ממש לא מניסיון אישי בכלל...)",
  shoutout_hack:
    "שאפו למי שגילה שאם כותבים את המשימה הכי מעצבנת ראשונה ברשימה, פתאום כל השאר נראות קלות. ושאפו כפול למי שהמציא את ה-Mesima הזאת, שמזכירה את המשימה בדיוק כשיושבים מול המחשב.\n\nנגמרו התירוציםםם",
  envy_portrait:
    "יש את הבחורה הזאת בכל משרד: מגיעה בתשע עם קפה ביד, יוצאת בחמש, אף פעם לא לחוצה לפני דדליין, בונה מצגות ב-Slidy במקום שקף שקף ביד, ואיכשהו דווקא המצגות שלה הן אלה שכולם מעתיקים.\n\nמישהו יכול להסביר לי את זה?",
  cautionary_confession:
    "בשנה הראשונה של העסק מאוד מפתה לשמור את כל הקבצים רק על הלפטופ. אל תעשו את זה, כי תגמרו כמוני. בשביל זה בדיוק יש גיבויים אוטומטיים כמו Zikaroni או דברים בסגנון ואז לא תצטרכו לבכות ב 3 בבוקר כי איבדתם את כל הקבצים פתאום\n\nאל תשאלו",
};

/** The two second examples, verbatim from the v2 task prompt (2026-10-07). */
const SECOND_EXAMPLES = {
  relatable_observation:
    "ראיתי היום בספרייה מישהי שמתכוננת לפסיכומטרי. בלי קורס. בלי צ'אט. בלי Tirgulo. בלי אפילו אוזניות. רק היא, ספר תרגול ועיפרון נגד כל המדינה. כמו פסיכופתית. השראה.",
  discovery:
    "ואף אחד לא חשב לספר לי שיש אפליקציה להורים שמחברים אליה את קבוצת הווטסאפ של הגן, והיא שולחת רק את מה שבאמת חשוב: מה להביא, מתי, ולמי להעביר כסף??\n\n(קוראים לה Ganly)",
} as const;

/** The examples in the order the prompt prints them, second shapes after their first. */
const V2_FENCES = [
  V2_EXAMPLES.reframe,
  V2_EXAMPLES.instead,
  V2_EXAMPLES.shoutout_hack,
  V2_EXAMPLES.wish_more_knew,
  V2_EXAMPLES.founder_ask,
  V2_EXAMPLES.relatable_observation,
  SECOND_EXAMPLES.relatable_observation,
  V2_EXAMPLES.quiz,
  V2_EXAMPLES.discovery,
  SECOND_EXAMPLES.discovery,
  V2_EXAMPLES.envy_portrait,
  V2_EXAMPLES.cautionary_confession,
];

const CLOSING_LINE_SKELETONS = [
  "reframe",
  "shoutout_hack",
  "envy_portrait",
  "cautionary_confession",
] as const;

const vars = { questionnaire: "{}", speaker_gender: "female" };
const flat = (text: string) => text.replace(/\s+/g, " ");
const fences = (text: string) => [...text.matchAll(/^```\n([\s\S]*?)\n```$/gm)].map((m) => m[1]);
/** The Truth block's bullets, each flattened. */
const truthBullets = (text: string) =>
  /\*\*Truth\.\*\*\n\n([\s\S]*?)\n\n\*\*Characters\.\*\*/
    .exec(text)![1]!
    .split(/\n- /)
    .map((bullet) => flat(bullet.replace(/^- /, "")).trim());
/** A skeleton's description, from its numbered heading to its first example. */
const description = (text: string, id: string) =>
  new RegExp(`^\\d+\\. \\*\\*\`${id}\`\\*\\*[\\s\\S]*?(?=\\n\`\`\`)`, "m").exec(text)![0];

describe("text_block prompt v1, frozen", () => {
  it("is byte for byte the file that stamped the 2026-10-07 fixture rows", () => {
    const bytes = readFileSync(path.join(PROMPTS_DIR, "text_block", "v1.md"));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      "bb80e178c38bc08a8caa71af83ec9c7fccff02e652e168c124f7405715600052",
    );
  });

  it("still renders on request, with its ten examples", () => {
    const { text, promptVersion } = renderPrompt("text_block", vars, 1);
    expect(promptVersion).toBe("text_block@v1");
    expect(fences(text)).toEqual(TEXT_BLOCK_SKELETON_IDS.map((id) => V1_EXAMPLES[id]));
  });
});

describe("text_block prompt v2", () => {
  it("is the latest version and receives the questionnaire and the speaker gender", () => {
    expect(latestPromptVersion("text_block")).toBe(2);
    const { text, promptVersion } = renderPrompt("text_block", {
      questionnaire: '{"product_name":"Tavnit"}',
      speaker_gender: "male",
    });
    expect(promptVersion).toBe("text_block@v2");
    expect(text).toContain('"product_name":"Tavnit"');
    expect(text).toContain("The speaker is male");
    expect(text).not.toContain("{{");
  });

  it("throws when speaker_gender is missing (every clip carries one)", () => {
    expect(() => renderPrompt("text_block", { questionnaire: "{}" })).toThrow(/speaker_gender/);
  });

  it("carries the founder's twelve examples literally, in order, and the code's DRY_RUN stand-in carries the first ten", () => {
    expect(TEXT_BLOCK_EXAMPLES).toEqual(V2_EXAMPLES);
    const { text } = renderPrompt("text_block", vars);
    expect(fences(text)).toEqual(V2_FENCES);
    for (const id of TEXT_BLOCK_SKELETON_IDS) expect(text).toContain(`\`${id}\``);
  });

  it("changes exactly five of v1's examples, and the replaced endings are gone", () => {
    expect(TEXT_BLOCK_SKELETON_IDS.filter((id) => V2_EXAMPLES[id] !== V1_EXAMPLES[id])).toEqual([
      "reframe",
      "instead",
      "shoutout_hack",
      "envy_portrait",
      "cautionary_confession",
    ]);
    const { text } = renderPrompt("text_block", vars);
    expect(text).not.toContain("ואיכשהו גם מספיקה חדר כושר");
    expect(text).not.toContain("אלא אם משתמשים באפליקציה");
    expect(text).not.toContain("קחו את זה ממני, אל תחפשו");
  });

  it("every example obeys the rules a machine can check", () => {
    for (const example of V2_FENCES) {
      const head = example.slice(0, 20);
      expect(textBlockTextError(example), head).toBeNull();
      expect(findGeneratedTextBlockDash(example), head).toBeUndefined();
      expect(textBlockLength(example), head).toBeLessThanOrEqual(400);
      // A stretched letter (the same Hebrew letter three times running) at most once.
      expect(example.match(/(\p{Script=Hebrew})\1\1/gu)?.length ?? 0, head).toBeLessThanOrEqual(1);
      // The product never opens the text: no Latin in the opening words.
      expect(example.split(/\s+/).slice(0, 3).join(" "), head).not.toMatch(/[A-Za-z]/);
    }
    for (const id of CLOSING_LINE_SKELETONS) {
      const closing = /\n\n([^\n]+)$/.exec(V2_EXAMPLES[id])?.[1];
      expect(closing, id).toBeDefined();
      expect(closing!.split(" ").length, id).toBeLessThanOrEqual(6);
      expect(closing, id).not.toMatch(/[A-Za-z]/);
    }
    expect(V2_EXAMPLES.instead.startsWith("קחו את זה ממני\n\n")).toBe(true);
    expect(V2_EXAMPLES.instead).toMatch(/\n\n\([^\n]+\)$/);
    expect(SECOND_EXAMPLES.discovery).toMatch(/\n\n\(קוראים לה Ganly\)$/);
    for (const text of [
      V2_EXAMPLES.wish_more_knew,
      V2_EXAMPLES.relatable_observation,
      SECOND_EXAMPLES.relatable_observation,
      V2_EXAMPLES.discovery,
    ]) {
      expect(text).not.toContain("\n");
    }
  });

  it("argues with none of its examples: no note tells the model which part of an example to ignore", () => {
    const text = flat(renderPrompt("text_block", vars).text);
    for (const note of [
      "the rules win",
      "Do not copy that part",
      "predates",
      "is not to be copied",
      "yours is one paragraph",
      "runs long",
      "The speaker's gender decides the first-person forms",
    ]) {
      expect(text, note).not.toContain(note);
    }
  });

  it("models no long dash in its own prose: only the dash rule and the truth line carry one", () => {
    const { text } = renderPrompt("text_block", vars);
    const dashed = text.split("\n").filter((line) => /[–—]/.test(line));
    expect(dashed).toHaveLength(2);
    expect(dashed[0]).toContain("Never an em dash or an en dash");
    expect(dashed[1]).toContain("No guarantees to the viewer");
  });

  it("pins the governing principle: never an ad, in the founder's words, and the test every text passes", () => {
    const text = flat(renderPrompt("text_block", vars).text);
    expect(text).toContain(
      '"it shouldnt ever feel like im trying to sell something to the viewer, it should never come off as an ad"',
    );
    expect(text).toContain(
      '"in general as if the person who wrote the text is telling people about it casually"',
    );
    expect(text).toContain("would a person post this with nothing to sell?");
  });

  it("pins the product rules: mentioned not offered, once, never first, the address preference, no call to action", () => {
    const text = flat(renderPrompt("text_block", vars).text);
    expect(text).toContain("The product is mentioned, not offered.");
    expect(text).toContain("Name it once, in passing");
    expect(text).toContain("often as one of several: `כמו X או דברים בסגנון`");
    expect(text).toContain("The name never opens the text.");
    expect(text).toContain(
      "Prefer general phrasing to addressing the viewer in the clause that carries the product",
    );
    expect(text).toContain("No call to action for the product");
    expect(text).toContain("`instead` is the one skeleton whose move is an instruction");
  });

  it("asks for 400 characters at most and never names the 450 hard cap (§2.3)", () => {
    const text = flat(renderPrompt("text_block", vars).text);
    expect(text).toContain("Most texts stay short: around 25 to 40 words");
    expect(text).toContain(
      "Never more than 400 characters: 400 is the ceiling, for a text whose joke needs the room, never the target.",
    );
    expect(TEXT_BLOCK_MAX_CHARS).toBe(450);
    expect(text).not.toContain("450");
    expect(text).not.toContain("the render refuses more");
  });

  it("pins the shape: line breaks only where a skeleton asks for one, always as a blank line", () => {
    const text = flat(renderPrompt("text_block", vars).text);
    expect(text).toContain(
      "Line breaks only where a skeleton below asks for one: between the parts of `quiz`; between the three parts of `founder_ask`, as its example shows; after `instead`'s opener; before the closing line of `reframe`, `shoutout_hack`, `envy_portrait` and `cautionary_confession`; before a short bracketed last line where a skeleton has one (`instead`, `quiz`, `discovery`). Every other text is one paragraph.",
    );
    expect(text).toContain("no hashtags, no emoji");
    expect(text).toContain("Typed on a phone, unpolished");
  });

  it("pins the closing line: four skeletons, a reaction, never a lesson, new every time (§2.1)", () => {
    const text = flat(renderPrompt("text_block", vars).text);
    expect(text).toContain(
      "`reframe`, `shoutout_hack`, `envy_portrait` and `cautionary_confession` end on a short line of their own, after a blank line.",
    );
    expect(text).toContain("It is a reaction: the writer's own response to what they just wrote");
    expect(text).toContain("It is never a lesson, a moral or the point restated");
    expect(text).toContain(
      "Its wording is new every time, never one of the examples' closing lines.",
    );
    for (const id of CLOSING_LINE_SKELETONS) {
      expect(flat(description(renderPrompt("text_block", vars).text, id)), id).toContain(
        "ends on a closing line",
      );
    }
  });

  it("pins instead's order: the opener alone, good then bad, the reaction, the aside only after it, a short product clause (§2.2)", () => {
    const desc = flat(description(renderPrompt("text_block", vars).text, "instead"));
    expect(desc).toContain('"take it from me" stands alone on the first line, then a blank line.');
    expect(desc).toContain("in a short clause");
    expect(desc).toContain(
      "the good outcome first and the bad one last, and the bad one followed at once by a concrete human reaction to living it.",
    );
    expect(desc).toContain(
      "Only when that reaction is there may the text close on a short bracketed aside on its own last line",
    );
  });

  it("pins reframe's familiar tool: one widely known tool beside the product, never in the category (§2.4)", () => {
    const desc = flat(description(renderPrompt("text_block", vars).text, "reframe"));
    expect(desc).toContain(
      'the "unless" may name one widely known tool the audience already uses, as the familiar, harder route: never a tool in this business\'s own category, nothing said about it beyond its name, and only when one fits.',
    );
  });

  it("pins envy_portrait's payoff, and a third person's gender from the audience's world (§2.5)", () => {
    const { text } = renderPrompt("text_block", vars);
    const desc = flat(description(text, "envy_portrait"));
    expect(desc).toContain(
      "a run of traits that show the person getting the job done with less effort or money than everyone else.",
    );
    expect(desc).toContain("The product is the trait that replaces the slow or expensive way.");
    expect(desc).toContain(
      'The last trait is a surprising win that the traits explain ("they do A, B and C, and somehow D"), never an unrelated perk.',
    );
    expect(desc).toContain("never a named or real person and never the speaker");
    expect(flat(text)).toContain(
      "**A third person follows the audience's world, not the speaker.** The type in `envy_portrait`, the person seen in `relatable_observation`, anyone a text describes: their gender is the likely gender of the viewer's peers in that world, read from `target_audience`.",
    );
  });

  it("keeps v1's Truth block and changes it on one point: a type's exaggerated win (§2.6)", () => {
    const v1 = truthBullets(renderPrompt("text_block", vars, 1).text);
    const v2 = truthBullets(renderPrompt("text_block", vars).text);
    expect(v2).toEqual([
      ...v1.slice(0, 3),
      "A recognisable type the viewer knows from their own world, like `envy_portrait`'s person in every office, may end on an exaggerated win, with no number, no earnings and no health or body result. The type is never the speaker and never a specific person the speaker knows.",
      ...v1.slice(3),
    ]);
    expect(v2).toContain(
      "Never write the speaker using, trying, buying or benefiting from the product, in any tense. The speaker knows it exists and points at it; the speaker has no experience of it.",
    );
  });

  it("names each skeleton's signature phrase, and everything else is written fresh (§2.7)", () => {
    const { text } = renderPrompt("text_block", vars);
    expect([...text.matchAll(/Signature phrase: (.*)$/gm)].map((m) => m[1])).toEqual([
      "`… נשמע …, עד שמבינים ש…`.",
      "`קחו את זה ממני`.",
      "`שאפו למי ש… ושאפו כפול למי ש…`.",
      "`הלוואי שיותר … היו יודעים ש…`.",
      "`רעיון גרוע או גאוני?`.",
      "none. The move is the salute itself, and `אין לי מושג איך אתם עושים את זה, אבל שאפו` is how the first example ends, not a phrase to reuse.",
      "`רוב ה… לא עונים נכון אפילו על אחת מאלה`.",
      "`לא רוצה להלחיץ אף אחד, אבל`, or `ואף אחד לא חשב לספר לי ש…`.",
      "`יש את ה… הזה/הזאת בכל …`.",
      "`מאוד מפתה ל… אל תעשו את זה, כי תגמרו כמוני`.",
    ]);
    const prose = flat(text);
    expect(prose).toContain(
      "names its signature phrase, the exact words that make the format recognisable; only those words may repeat from text to text.",
    );
    expect(prose).toContain(
      "Everything else is written fresh for this business and never lifted from an example: the situation, the closing line, the aside, the question a text ends on, the line on why it is worth it.",
    );
    for (const lifted of [
      "- `נו, כן או לא?`",
      "- `אין לי מושג איך אתם עושים את זה, אבל שאפו`",
      "- `זה לא נשמע מרגש, אבל זה ההבדל בין`",
      "- the `מניסיון אישי` aside",
      "- `נגמרו התירוציםםם`",
      "- the small hours as the bad moment (`ב 3 בבוקר`, `ב 2 בלילה`)",
    ]) {
      expect(prose).toContain(lifted);
    }
    // The prose's own illustrations borrow nothing the list names as lifted.
    const rules = prose.slice(0, prose.indexOf("**Copying.**"));
    expect(rules).not.toContain("אין לי מושג");
    expect(rules).not.toContain("התירוציםםם");
    expect(rules).not.toContain("ב 3 בבוקר");
  });

  it("gives relatable_observation and discovery a second shape, still one skeleton each (§2.8, §2.12)", () => {
    const { text } = renderPrompt("text_block", vars);
    expect(flat(text)).toContain(
      "`relatable_observation` and `discovery` have a second example: a second shape of the same move, not another skeleton.",
    );
    expect(flat(description(text, "relatable_observation"))).toContain(
      "**The person seen in public.** One person the speaker saw, a clipped list of what they do it without with the product hidden mid-list among ordinary things, and a deadpan ending.",
    );
    expect(flat(description(text, "discovery"))).toContain(
      '**"And nobody thought to tell me there\'s a…"** The thing and what it does, as a complaint that nobody said so; the name only in a bracketed last line, after a blank line.',
    );
    expect([...text.matchAll(/^\d+\. \*\*`(\w+)`\*\*/gm)].map((m) => m[1])).toEqual([
      ...TEXT_BLOCK_SKELETON_IDS,
    ]);
  });

  it("restates the plural address and the no-invented-figure rule, and caps stretched letters (§2.10, §2.11)", () => {
    const text = flat(renderPrompt("text_block", vars).text);
    expect(text).toContain(
      "**The viewer is plural, every time.** `שבנית`, `אותך`, `שלך`, `נותן לך` speak to one person; write `שבניתם`, `אתכם`, `שלכם`, `נותן לכם`. The audience is never a feminine plural (`מנסות`), whatever the speaker's gender; write the general plural (`מנסים`).",
    );
    expect(text).toContain(
      "never a feminine plural, whoever the audience is: even an all-female `target_audience` is addressed `אתם`",
    );
    expect(text).not.toContain("for a mixed or unstated audience");
    expect(text).toContain(
      "**No figure the questionnaire does not give.** A timeframe is a figure (`שלוש שעות`)",
    );
    // Restated, not widened: Truth's everyday-number allowance is repeated where the check is.
    expect(text).toContain(
      "Everyday numbers that claim nothing about the product (`עשרים הודעות`, `ב-8 בערב`) stay fine, as Truth says.",
    );
    expect(text).toContain("Never invent a number, price, statistic, earning, timeframe or result");
    expect(text).toContain(
      "A stretched letter is the Hebrew stand-in for capitals: at most once in a text.",
    );
  });

  it("leaves wish_more_knew, founder_ask and quiz as v1 described them, apart from the signature phrase (§2.13)", () => {
    const v1 = renderPrompt("text_block", vars, 1).text;
    const v2 = renderPrompt("text_block", vars).text;
    for (const id of ["wish_more_knew", "founder_ask", "quiz"]) {
      expect(description(v2, id).replace(/ +Signature phrase: .*\n/, ""), id).toBe(
        description(v1, id),
      );
    }
  });

  it("carries the standing house rules: the character set, straight quotes, the רגע tick, the naming policy, no calendar year", () => {
    const text = flat(renderPrompt("text_block", vars).text);
    expect(text).toContain("Hebrew, Latin, digits and standard punctuation only");
    expect(text).toContain("Straight quotes only (`\"` and `'`), never the curly typographic ones");
    expect(text).toContain("Never `רגע` as a hesitation tick");
    expect(text).toContain("The tick is what is banned, not the word");
    expect(text).toContain("ChatGPT, Google, Excel, WhatsApp");
    expect(text).toContain("A reference point may be written the way Israelis type it in Hebrew");
    expect(text).toContain("any small or local named business; any direct competitor");
    expect(text).toContain("No calendar year");
    expect(text).toContain("Never an em dash or an en dash");
    expect(text).toContain("it is a plain hyphen with a space on each side");
  });

  it("describes each skeleton by its example and asks for every one back, written or skipped", () => {
    const text = flat(renderPrompt("text_block", vars).text);
    expect(text).toContain("A skeleton that does not fit this business is skipped, never forced");
    expect(text).toContain("Skip `discovery` when the questionnaire has no `wow`");
    expect(text).toContain("a salute to the people who still manage by hand without the product");
    expect(text).toContain("Then a double shoutout to whoever made the product");
    expect(text).toContain("First person plural, the only skeleton that speaks as the business");
    expect(text).toContain("It asks for an opinion and sells nothing");
    expect(text).toContain("The confession is about the problem, never about the product");
    expect(text).toContain("Return every skeleton exactly once");
  });
});

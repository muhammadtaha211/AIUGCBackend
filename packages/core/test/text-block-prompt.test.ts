import { describe, expect, it } from "vitest";
import { latestPromptVersion, renderPrompt } from "../src/prompts";
import { TEXT_BLOCK_EXAMPLES, TEXT_BLOCK_SKELETON_IDS } from "../src/text-block";

/**
 * text_block v1 (decisions 0090–0091, amended 2026-10-07): the ten skeletons
 * with the founder's examples as the exemplars, the rules reworded so every
 * example obeys every one, the truth rules as phase 1 wrote them, and the
 * standing house rules for burned text. The rules are pinned as text — the
 * prompt is the versioned artifact and a rule going missing is the real
 * signal.
 */

/**
 * The founder's ten texts, literally: nine from the 2026-10-07 brief as they
 * stood in the tree (casual spelling and spacing included — `ה 60`, `ב 3
 * בבוקר`, a stretched last letter), and `shoutout_hack` as he replaced it on
 * 2026-10-07/08. A copy, not an import, so the code and the prompt cannot
 * drift from his text together.
 */
const FOUNDER_EXAMPLES: Record<(typeof TEXT_BLOCK_SKELETON_IDS)[number], string> = {
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

describe("text_block prompt v1", () => {
  const vars = { questionnaire: "{}", speaker_gender: "female" };
  const flat = (text: string) => text.replace(/\s+/g, " ");

  it("is the latest version and receives the questionnaire and the speaker gender", () => {
    expect(latestPromptVersion("text_block")).toBe(1);
    const { text, promptVersion } = renderPrompt("text_block", {
      questionnaire: '{"product_name":"Tavnit"}',
      speaker_gender: "male",
    });
    expect(promptVersion).toBe("text_block@v1");
    expect(text).toContain('"product_name":"Tavnit"');
    expect(text).toContain("The speaker is male");
    expect(text).not.toContain("{{");
  });

  it("throws when speaker_gender is missing (every clip carries one)", () => {
    expect(() => renderPrompt("text_block", { questionnaire: "{}" })).toThrow(/speaker_gender/);
  });

  it("carries the founder's ten texts literally, the new shoutout_hack included, and the code carries the same", () => {
    expect(TEXT_BLOCK_EXAMPLES).toEqual(FOUNDER_EXAMPLES);
    const { text } = renderPrompt("text_block", vars);
    for (const id of TEXT_BLOCK_SKELETON_IDS) {
      expect(text).toContain(`\`${id}\``);
      expect(text, id).toContain(FOUNDER_EXAMPLES[id]);
    }
    // The replaced shoutout_hack (the speaker using the product, then a result) is gone.
    expect(text).not.toContain("בחיים לא הייתי פרודוקטיבית");
    expect(text).not.toContain("היא מזכירה לי את המשימה");
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
    expect(text).toContain("This is a preference, not a rule");
    expect(text).toContain("No call to action for the product");
    expect(text).toContain("`instead` is the one skeleton whose move is an instruction");
    expect(text).toContain(
      "Advice or a warning about the problem (`אל תעשו את זה`) is not a call to action",
    );
  });

  it("pins the shape rules: the length, the 400 ceiling, the line-break rule, the register, the plural audience", () => {
    const text = flat(renderPrompt("text_block", vars).text);
    expect(text).toContain("Most texts stay short: around 25 to 40 words");
    expect(text).toContain("The hard cap is 400 characters");
    expect(text).toContain(
      "400 is the ceiling, for a text whose joke needs the room, never the target",
    );
    expect(text).toContain(
      "Line breaks only in `quiz` and `founder_ask`, and before a short bracketed aside on its own last line",
    );
    expect(text).toContain("Typed on a phone, unpolished");
    expect(text).toContain(
      "is named once, by `product_name`, as the brand writes it. Latin stays Latin",
    );
    expect(text).toContain("The audience is addressed in the plural");
    expect(text).toContain("no hashtags, no emoji");
  });

  it("pins the dash rule: never an em or en dash, a spaced plain hyphen, the joining hyphen is not a dash", () => {
    const text = flat(renderPrompt("text_block", vars).text);
    expect(text).toContain("Never an em dash or an en dash");
    expect(text).toContain('"it makes it come off as obviously AI"');
    expect(text).toContain("it is a plain hyphen with a space on each side");
    expect(text).toContain("is not a dash and stays as it is");
  });

  it("pins the truth rules as phase 1 wrote them: no speaker experience of the product, no invented figures, no health or money promises", () => {
    const text = flat(renderPrompt("text_block", vars).text);
    expect(text).toContain(
      "Never write the speaker using, trying, buying or benefiting from the product, in any tense",
    );
    expect(text).toContain("Never invent a number, price, statistic, earning, timeframe or result");
    expect(text).toContain("stated as the business's claim and never as the speaker's experience");
    expect(text).toContain("No health or money promises");
    expect(text).toContain("Nothing negative about a named company");
    expect(text).toContain("The texts never refer to the clip");
  });

  it("carries the standing house rules: the character set, straight quotes, the רגע tick, the naming policy, no calendar year", () => {
    const text = flat(renderPrompt("text_block", vars).text);
    expect(text).toContain("Hebrew, Latin, digits and standard punctuation only");
    expect(text).toContain("never the curly typographic pair");
    expect(text).toContain("Never `רגע` as a hesitation tick");
    expect(text).toContain("The tick is what is banned, not the word");
    expect(text).toContain("ChatGPT, Google, Excel, WhatsApp");
    expect(text).toContain("A reference point may be written the way Israelis type it in Hebrew");
    expect(text).toContain("any small or local named business; any direct competitor");
    expect(text).toContain("No calendar year");
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
    expect(text).toContain("A third-person archetype, never a named or real person");
    expect(text).toContain("Return every skeleton exactly once");
  });
});

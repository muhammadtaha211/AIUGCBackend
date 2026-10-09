import type { SafeRect } from "@aiugc/core/hook-geometry";
import type { HookTextColor } from "@aiugc/core/hook-text-color";
import {
  normalizeTextBlockText,
  TEXT_BLOCK_MAX_CHARS,
  textBlockLength,
} from "@aiugc/core/text-block";
import type { TextBlockNextResponse } from "./service-c";

/**
 * The Service C (גוש טקסט) wizard's Hebrew copy and pure helpers, client-safe
 * (decision 0099). The strings the C wizard shares word for word with A and B
 * — המשך, נסה שוב, the render timeline — stay inline in its components the
 * way theirs do; everything the format says for itself is here, so the
 * founder can rewrite it in one place.
 *
 * ⚠️ COPY PENDING FOUNDER REVIEW.
 */

export type CWizardStep = "persona" | "clip" | "studio" | "render";

export const C_WIZARD_STEPS: CWizardStep[] = ["persona", "clip", "studio", "render"];

export const C_WIZARD_TITLE = "גוש טקסט";

export const C_STEP_TITLES: Record<CWizardStep, string> = {
  persona: "בחירת דמות",
  clip: "בחירת קליפ",
  studio: "הטקסט והמיקום",
  render: "יצירת הסרטון",
};

/** The persona step's header: the character scopes the clip gallery and is
 *  who the text is written as — nobody talks, so B's copy would mislead. */
export const C_PERSONA_COPY = {
  title: "בחרו דמות",
  sub: "לכל דמות יש קליפים משלה, והטקסט נכתב מפי הדמות. בוחרים דמות, ואחר כך את הקליפ.",
};

/** No character has a usable clip yet — before the founder assigns the bank. */
export const C_EMPTY_CATALOG =
  "עוד אין דמויות זמינות לגוש טקסט, אנחנו מוסיפים ממש בקרוב. נסו שוב מאוחר יותר.";

export const C_CLIP_COPY = {
  title: "בחרו קליפ",
  sub: "הקליפ מתנגן פעם אחת מההתחלה עד הסוף, עם הסאונד שלו, והטקסט צרוב עליו לכל האורך.",
};
export const C_CLIP_GROUP_LABEL = "בחירת קליפ";
export const C_CLIPS_LOADING = "טוענים את הקליפים…";
export const C_CLIPS_EMPTY = "לדמות הזאת אין כרגע קליפים, בחרו דמות אחרת או נסו שוב מאוחר יותר.";

export const C_STUDIO_COPY = {
  title: "הטקסט והמיקום שלו",
  sub: "מקבלים טקסט לפי שאלון העסק, עורכים אותו חופשי וקובעים איפה הוא יושב על הקליפ.",
};
export const C_TEXT_LOADING = "כותבים טקסט לפי שאלון העסק…";
export const C_ANOTHER_TEXT = "טקסט אחר";
/** Heading over the texts already shown this session. */
export const C_EARLIER_TEXTS = "טקסטים קודמים";
export const C_PLACEMENT_HINT = "גוררים את המסגרת כדי להזיז את הטקסט, ומהפינות כדי לשנות גודל.";

export const C_RENDER_COPY = {
  title: "ככה הסרטון ייבנה",
  sub: "אפשר לחזור אחורה ולשנות את הקליפ, הטקסט או המיקום.",
};
export const C_LIBRARY_LINK = "לכל היצירות";

/** The confirm screen's one-line shape. The clip's own length IS the video's. */
export function cShapeSummary(clipDurationMs: number): string {
  const seconds = Math.round(clipDurationMs / 100) / 10;
  return `סרטון באורך ${seconds} שנ׳: הקליפ מתנגן פעם אחת עם הסאונד שלו, והטקסט שבחרתם צרוב עליו לכל האורך.`;
}

/** One clip of GET /api/text-block-clips?personaId= (the routes' other shapes are service-c.ts's). */
export type TextBlockClip = {
  id: string;
  durationMs: number;
  previewUrl: string;
  /** The founder-drawn area — seeds the studio's placement editor. */
  textSafeArea: SafeRect;
  /** The colour the block burns in, set in admin; shown, never picked here. */
  textColor: HookTextColor;
};

/**
 * A text shown this session. `text` is the stored row's; `draft` is the
 * customer's unsaved edit of it, kept per text so moving between texts loses
 * nothing. Saving makes a NEW script row (scripts are immutable).
 */
export type TextBlockOption = TextBlockNextResponse & { draft?: string };

/** What the textarea shows and the preview burns: the edit, else the stored text. */
export function textBlockDraft(option: TextBlockOption): string {
  return option.draft ?? option.text;
}

/** Whether continue has to save first — compared the way the route stores it. */
export function isTextBlockDirty(option: TextBlockOption): boolean {
  return normalizeTextBlockText(textBlockDraft(option)) !== option.text;
}

/** The live counter, `{length}/450`, counted the way textBlockTextError counts. */
export function textBlockCounter(text: string): string {
  return `${textBlockLength(normalizeTextBlockText(text))}/${TEXT_BLOCK_MAX_CHARS}`;
}

/** A served text joins the session's list once — two tabs can serve one row twice. */
export function withShownText(
  texts: TextBlockOption[],
  next: TextBlockNextResponse,
): TextBlockOption[] {
  return texts.some((text) => text.scriptId === next.scriptId) ? texts : [...texts, next];
}

/** The saved edit replaces its text in place: new row id, no draft left. */
export function withSavedText(
  texts: TextBlockOption[],
  oldScriptId: string,
  saved: { scriptId: string; text: string },
): TextBlockOption[] {
  return texts.map((text) =>
    text.scriptId === oldScriptId
      ? { scriptId: saved.scriptId, text: saved.text, skeleton: text.skeleton }
      : text,
  );
}

/** The texts to go back to: every one but the pick, most recent first. */
export function earlierTexts(texts: TextBlockOption[], pickId: string | null): TextBlockOption[] {
  return texts.filter((text) => text.scriptId !== pickId).reverse();
}

/**
 * Whether "try again" can be honest. A 429 is a daily quota (api-errors.ts):
 * the same request fails until the rolling window clears, so the control
 * comes off the screen instead of lying.
 */
export function retryableTextBlockFailure(status: number): boolean {
  return status !== 429;
}

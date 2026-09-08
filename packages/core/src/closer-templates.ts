import type { Questionnaire } from "./pipelines/businesses";

/**
 * Founder-curated closers — the twin of the hook bank (`hook-templates.ts`).
 * Every Service B script ends: name → one or two strongest advantages → ONE of
 * these, and nothing after it. Replaces the fixed verdict close
 * (ממליצה בחום / הלינק למטה / שווה לך לבדוק) that b_script v1–v11 hard-coded.
 *
 * Punctuation is part of the closer, not decoration. Measured by the founder in
 * the ElevenLabs v3 UI (Hebrew, 2026-09-07): audio tags have no audible effect;
 * punctuation does. Exclamation marks scale excitement; one trailing dot reads
 * decisive, none reads open-ended; two dots elongate the final sound and do NOT
 * create a pause. So every closer is a tested string — text + punctuation —
 * and the prompt copies it byte for byte.
 */
export interface CloserTemplate {
  /**
   * Canonical form: female speaker — the HOOK_TEMPLATES convention. Audience-
   * axis closers are written in the plural (תנסו) and the prompt conjugates
   * them down to whatever form the rest of the script uses.
   */
  text: string;
  /** Tested delivery punctuation, appended to the text as-is. */
  punctuation: string;
  tones: readonly Questionnaire["tone"][];
  /** Which axis the text carries, so the prompt knows what may be conjugated. */
  agrees: "none" | "speaker" | "audience";
  /** Audience-axis closers usable only when the script addresses a plural audience. */
  pluralOnly?: boolean;
}

const ALL_TONES = ["friendly", "direct", "professional"] as const;

export const CLOSER_TEMPLATES: readonly CloserTemplate[] = [
  {
    // Always four marks — the tested delivery (founder, 2026-09-08).
    text: "הכי ממליצה בעולם",
    punctuation: "!!!!",
    tones: ["friendly", "direct"],
    agrees: "speaker",
  },
  {
    text: "אין על זה, אין",
    punctuation: ".",
    tones: ["friendly", "direct"],
    agrees: "none",
  },
  {
    // Two dots on purpose: elongates the final sound, no pause (founder, 2026-09-07).
    text: "חבל על הזמן",
    punctuation: "..",
    tones: ["friendly"],
    agrees: "none",
  },
  {
    text: "אני לא חוזרת אחורה",
    punctuation: ".",
    tones: ALL_TONES,
    agrees: "speaker",
  },
  {
    text: "מאז אני רק עם זה",
    punctuation: ".", // untested
    tones: ALL_TONES,
    agrees: "none",
  },
  {
    text: "תנסו ותגידו לי בתגובות",
    punctuation: ".", // untested
    tones: ["friendly", "direct"],
    agrees: "audience",
  },
  {
    text: "תודו לי אחר כך",
    punctuation: ".", // untested
    tones: ["friendly"],
    agrees: "audience",
    pluralOnly: true,
  },
  {
    text: "אין מה להתלבט",
    punctuation: ".", // untested
    tones: ["direct", "professional"],
    agrees: "none",
  },
  {
    text: "שווה כל שקל",
    punctuation: ".", // untested
    tones: ["direct", "professional"],
    agrees: "none",
  },
  {
    text: "מאז, שקט",
    punctuation: ".", // untested
    tones: ["professional", "direct"],
    agrees: "none",
  },
  {
    text: "בעיה נפתרה",
    punctuation: ".", // untested
    tones: ["direct", "professional"],
    agrees: "none",
  },
];

/** How many closers to offer the script model per generation. */
export const CLOSER_OPTIONS_PER_GENERATION = 3;

/**
 * A random subset of the closers that fit the tone, without repetition. Called
 * once per script generation and rendered into the b_script prompt as
 * {{closer_options}}; the offered texts are recorded on scripts.params next to
 * hookTemplates. Never empty: every tone has at least one closer (under test).
 */
export function pickClosers(
  tone: Questionnaire["tone"],
  count: number = CLOSER_OPTIONS_PER_GENERATION,
  pool: readonly CloserTemplate[] = CLOSER_TEMPLATES,
): CloserTemplate[] {
  const shuffled = pool.filter((c) => c.tones.includes(tone));
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

// Marks a model is tempted to "tidy" get named, so the line says they are on purpose.
const MARK_NOTES: Record<string, string> = { "..": "two dots", "!!!!": "four exclamation marks" };

/**
 * The line the prompt shows for one closer: the text with its punctuation, and
 * what — if anything — the model may conjugate. The prompt numbers these.
 */
export function describeCloser(c: CloserTemplate): string {
  const shown = `"${c.text}${c.punctuation}"`;
  const mark = MARK_NOTES[c.punctuation];
  switch (c.agrees) {
    case "none":
      return `${shown} — copy exactly, ${mark ? `${mark}, ` : ""}nothing to conjugate`;
    case "speaker":
      return `${shown} — ${mark ? `${mark}; ` : ""}conjugate speaker gender only`;
    case "audience":
      return `${shown} — ${
        c.pluralOnly
          ? "plural audience only; copy exactly"
          : "conjugate only the audience form, to the one every other sentence uses"
      }`;
  }
}

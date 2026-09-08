import type { Questionnaire } from "./pipelines/businesses";

/**
 * Founder-curated closers — the twin of the hook bank (`hook-templates.ts`).
 * Every Service B script ends: name → one or two strongest advantages → ONE of
 * these, and nothing after it. Replaces the fixed verdict close
 * (ממליצה בחום / הלינק למטה / שווה לך לבדוק) that b_script v1–v11 hard-coded.
 *
 * Punctuation is part of the closer, not decoration. Measured by the founder in
 * the ElevenLabs v3 UI (Hebrew, 2026-09-07): audio tags have no audible effect;
 * punctuation does. Exclamation marks scale excitement (4 = max useful); one
 * trailing dot reads decisive, none reads open-ended; two dots elongate the
 * final sound and do NOT create a pause. So a closer's punctuation is a tested
 * delivery control and the prompt copies it byte for byte.
 */
export interface CloserTemplate {
  /**
   * Canonical form: female speaker — the HOOK_TEMPLATES convention. Audience-
   * axis closers are written in the plural (תנסו) and the prompt conjugates
   * them down to whatever form the rest of the script uses.
   */
  text: string;
  /** Tested delivery punctuation. exclaim: the model picks 1..max marks by how casual the business is. */
  punctuation: { kind: "fixed"; mark: string } | { kind: "exclaim"; max: number };
  tones: readonly Questionnaire["tone"][];
  /** Which axis the text carries, so the prompt knows what may be conjugated. */
  agrees: "none" | "speaker" | "audience";
  /** Audience-axis closers usable only when the script addresses a plural audience. */
  pluralOnly?: boolean;
}

const ALL_TONES = ["friendly", "direct", "professional"] as const;

export const CLOSER_TEMPLATES: readonly CloserTemplate[] = [
  {
    text: "הכי ממליצה בעולם",
    punctuation: { kind: "exclaim", max: 4 },
    tones: ["friendly", "direct"],
    agrees: "speaker",
  },
  {
    text: "אין על זה, אין",
    punctuation: { kind: "fixed", mark: "." },
    tones: ["friendly", "direct"],
    agrees: "none",
  },
  {
    // Two dots on purpose: elongates the final sound, no pause (founder, 2026-09-07).
    text: "חבל על הזמן",
    punctuation: { kind: "fixed", mark: ".." },
    tones: ["friendly"],
    agrees: "none",
  },
  {
    text: "אני לא חוזרת אחורה",
    punctuation: { kind: "fixed", mark: "." },
    tones: ALL_TONES,
    agrees: "speaker",
  },
  {
    text: "מאז אני רק עם זה",
    punctuation: { kind: "fixed", mark: "." }, // untested
    tones: ALL_TONES,
    agrees: "none",
  },
  {
    text: "תנסו ותגידו לי",
    punctuation: { kind: "fixed", mark: "." }, // untested
    tones: ["friendly", "direct"],
    agrees: "audience",
  },
  {
    text: "תודו לי אחר כך",
    punctuation: { kind: "fixed", mark: "." }, // untested
    tones: ["friendly"],
    agrees: "audience",
    pluralOnly: true,
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

/**
 * The line the prompt shows for one closer: the text with its punctuation, and
 * what — if anything — the model may conjugate. The prompt numbers these.
 */
export function describeCloser(c: CloserTemplate): string {
  const shown =
    c.punctuation.kind === "fixed"
      ? `"${c.text}${c.punctuation.mark}"`
      : `"${c.text}" + 1 to ${c.punctuation.max} exclamation marks (${c.punctuation.max} = most casual)`;
  let rule: string;
  switch (c.agrees) {
    case "none":
      rule =
        c.punctuation.kind === "fixed" && c.punctuation.mark === ".."
          ? "copy exactly, two dots, nothing to conjugate"
          : "copy exactly, nothing to conjugate";
      break;
    case "speaker":
      rule = "conjugate speaker gender only";
      break;
    case "audience":
      rule = c.pluralOnly
        ? "plural audience only; copy exactly"
        : "conjugate only the audience form, to the one every other sentence uses";
      break;
  }
  return `${shown} — ${rule}`;
}

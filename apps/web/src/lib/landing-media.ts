/**
 * Every asset the public landing shows, in one object, so swapping a stand-in
 * for the real thing is a one-file edit: drop the file into
 * `apps/web/public/landing/` and set its `src` here. See the README there for
 * the expected filenames.
 *
 * A `null` src means "not shot yet". The page then draws its own still in that
 * slot — today's AdFrame with the slot's label on it. It never prints the word
 * "placeholder" on screen, and it never reaches the network for anything but
 * the picsum stand-in the landing already used.
 *
 * One exception: `instagramShot` hides its column instead of drawing a still.
 *
 * The hook lines live here too, because they are the copy burned onto those
 * clips: one file, one edit, whether what changes is the footage or the line.
 */

/** A 9:16 clip. `poster` is the frame shown before it plays. */
type VideoSlot = { src: string | null; poster: string | null; alt: string };

/** A still — a screenshot of a real screen, not a clip. */
type ImageSlot = { src: string | null; alt: string };

/** A hook-bank clip with the Hebrew line a render burns over it. */
type HookClipSlot = { src: string | null; poster: string | null; line: string };

type LandingMedia = {
  /** The presenter the self-marketing band is about. Founder-set. */
  presenterName: string;
  /** `null` hides the Instagram link entirely — the band still renders. */
  instagramUrl: string | null;
  demoBefore: VideoSlot;
  demoAfter: VideoSlot;
  presenterSample: VideoSlot;
  /** Exactly four — the strip and the output tiles are both four across. */
  hookClips: readonly [HookClipSlot, HookClipSlot, HookClipSlot, HookClipSlot];
  hookStudioShot: ImageSlot;
  instagramShot: ImageSlot;
};

export const LANDING_MEDIA: LandingMedia = {
  presenterName: "עדי",
  instagramUrl: null,

  demoBefore: { src: null, poster: null, alt: "הדמו שצילמתם" },
  demoAfter: { src: null, poster: null, alt: "המודעה שתבנית הרכיבה" },
  presenterSample: { src: null, poster: null, alt: "דוגמה לסרטון עם דמות AI" },

  hookClips: [
    { src: null, poster: null, line: "לא האמנתי שזה באמת עובד" },
    { src: null, poster: null, line: "למה אף אחד לא סיפר לי על זה?!" },
    { src: null, poster: null, line: "חייבת להראות לכם מה הגיע לי" },
    { src: null, poster: null, line: "עצרו הכל. תראו את זה" },
  ],

  hookStudioShot: { src: null, alt: "בחירת משפט פתיחה" },
  instagramShot: { src: null, alt: "חשבון האינסטגרם" },
};

/** The burned example lines, in order — the four `hookClips` lines. */
export const HOOKS = LANDING_MEDIA.hookClips.map((clip) => clip.line);

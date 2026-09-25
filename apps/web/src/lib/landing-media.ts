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
  /** The finished ad, its hook line burned in — the page draws no line over it. */
  demoAfter: VideoSlot;
  presenterSample: VideoSlot;
  /** Exactly four — step 2's strip is four across. */
  hookClips: readonly [HookClipSlot, HookClipSlot, HookClipSlot, HookClipSlot];
  hookStudioShot: ImageSlot;
  instagramShot: ImageSlot;
};

export const LANDING_MEDIA: LandingMedia = {
  presenterName: "נועה",
  instagramUrl: null,

  demoBefore: {
    src: "/landing/demo-before.mp4",
    poster: "/landing/demo-before.jpg",
    alt: "הדמו שצילמתם",
  },
  demoAfter: {
    src: "/landing/demo-after.mp4",
    poster: "/landing/demo-after.jpg",
    alt: "המודעה שתבנית הרכיבה",
  },
  presenterSample: {
    src: "/landing/presenter.mp4",
    poster: "/landing/presenter.jpg",
    alt: "דוגמה לסרטון עם דמות AI",
  },

  // Bank clips, shown bare — step 2 draws no line over them (founder's call,
  // 2026-09-25). The lines feed step 3's option-list mock through `HOOKS`.
  // 1 noa/disbelief, 2 omri/laughing, 3 shira/takesoffheadphones, 4 nehoray/ma.
  hookClips: [
    { src: "/landing/hook-1.mp4", poster: "/landing/hook-1.jpg", line: "לא האמנתי שזה באמת עובד" },
    {
      src: "/landing/hook-2.mp4",
      poster: "/landing/hook-2.jpg",
      line: "למה אף אחד לא סיפר לי על זה?!",
    },
    {
      src: "/landing/hook-3.mp4",
      poster: "/landing/hook-3.jpg",
      line: "חייבת להראות לכם מה הגיע לי",
    },
    { src: "/landing/hook-4.mp4", poster: "/landing/hook-4.jpg", line: "עצרו הכל. תראו את זה" },
  ],

  hookStudioShot: { src: null, alt: "בחירת משפט פתיחה" },
  instagramShot: { src: null, alt: "חשבון האינסטגרם" },
};

/** The burned example lines, in order — the four `hookClips` lines. */
export const HOOKS = LANDING_MEDIA.hookClips.map((clip) => clip.line);

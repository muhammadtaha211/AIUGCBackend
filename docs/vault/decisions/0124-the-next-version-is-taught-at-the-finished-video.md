---
type: decision
status: verified
verified: 2026-10-22
method: "Founder brief in chat, 2026-10-22 (eight numbered decisions, two marked PLANNING DEFAULT he did not strike). Built on feat/next-version-action. Read back in the tree: the route apps/web/src/app/api/renders/[id]/route.ts (nextVersionFor), the player apps/web/src/components/render-player.tsx (NextVersionLink), the strings apps/web/src/lib/quote-ui.ts (NEXT_VERSION_BUTTON, nextVersionLine), the C entry apps/web/src/app/home/c/new/page.tsx + apps/web/src/lib/service-c-ui.ts (cWizardEntry) + apps/web/src/components/c-wizard/c-wizard.tsx, the event apps/web/src/lib/analytics.ts (next_version_started). Pinned by apps/web/test/next-version.test.ts (12 cases, PGlite, the real route and the real player markup). Live price MEASURED 2026-10-22, read-only (packages/core/.work/next-version-probe.ts, select value from app_config where key='credit_costs'): a_steps_credits 25, a_demo_analysis_credits 20, c_text_block_credits 25. Posting switches MEASURED the same day (packages/core/.work/next-version-switch.ts): no social_posting or tiktok_posting row, so the default, admins only. Browser: a throwaway harness page mounting the real components behind a fetch mock, headless Chrome at 375 px; NOT a signed-in walk."
source: founder + code
---

# 0124 — The next version is taught at the finished video

## The decision

The founder's brief, 2026-10-22. Each item is his, with his reason:

1. **Volume is taught at the finished video.** Not by a popup on the A card, and not by linking
   his Instagram account. The "a few videos are enough" misconception bites after the first videos
   get few views, so the message belongs where the next video is decided. A wall on the card's tap
   gets dismissed. An account with low numbers reads as a results claim with a bad number
   ([[0061-landing-positioning-two-services-no-results-claims]] §2).
2. **Variants in a batch by default stays deferred** (0101 ruling 12's "campaigns that generate
   themselves") until there is real-user data. Too big a commitment before any.
3. **A third action on every surface a finished הוק + דמו plays**, beside הורדה and תזמון פרסום,
   opens the A wizard at the character step. A different visual hook starts at the character
   ([[0012-persona-first-steps-wizard]]); the recording's analysis and plan are already paid and
   approved, and the plan step is the pass-through 0061 §4 describes.
4. **The recording is carried only if that is a small change**; otherwise the customer picks it at
   the demo step. It was a small change (below), so it is carried.
5. **One line beside the action, two sentences.** Further versions from the same recording are
   discounted, and the next one costs N credits. Make many versions, with different text hooks and
   visual hooks each time, and see what works. "Discounted" is his word, by choice: the customer
   sees the first render's total as the price of a video. N comes from the quote path the wizard
   charges with, never a literal ([[0048-the-demo-analysis-is-charged-once-per-demo]]). No results
   claim and no number of videos per plan (0061 §2,
   [[0051-the-credit-unit-and-the-three-credit-only-plans]] §5).
6. **A finished גוש טקסט gets the same action**, back to the text step with the same character
   and clip, with no price line (C is a flat price). PLANNING DEFAULT he did not strike.
7. **דמות AI videos get nothing.** Volume is the A and C play.
8. **The click sends one PostHog event, with the service**, per docs/10's table. The measure of
   whether the nudge works is renders per recording, and the event says whether this button is
   the path there. PLANNING DEFAULT.

Not built, by the brief's limits: any change to credits, prices, `credit_costs` or a quote
function; a migration; anything on דמות AI, the landing, `/pricing` or the legal pages; a modal or
interstitial; `instagramUrl` stays null.

## How it works

**The route decides, like תזמון פרסום.** `GET /api/renders/[id]` sends `nextVersion` for a
released render with a file, and only for:

- **A, steps format** (createSet's own reading: an absent format with a plan is steps) whose set
  names a demo: `href` `/home/a/new?demo=<demo>`. `credits` is
  `quoteTotal(quoteStepsASet(db, business, demo), 1)`, the same call the quote route serves and
  `createSet` charges with. It is sent only when the quote is chargeable **and** its analysis part
  is 0, so it is a discount. Absent, the line keeps its second sentence alone: the admin bypass,
  and a recording that still owes the analysis, whose next render would cost the first-render
  total.
- **C**: `href` `/home/c/new?persona=<the clip's character>&clip=<clip>`. No price.

B, the retired full format and an unfinished render get nothing; neither does a C row whose clip
has no character.

**The recording is carried with no wizard change.** The A wizard already restores `?demo=` (`a-wizard.tsx`, its mount effect):
the demo GET proves ownership, `restoredDemo` refuses another business's or a rejected demo, and
`clampRestoredStep` lands on the persona step when no step is given. The strip shows the
recording from the first screen. At the demo step the customer sees "הסרטון מוכן" with continue
and "החלפת הסרטון". The plan step re-attaches to the approved plan (0061 §4's pass-through), and
the render step's confirm says 25 with no breakdown.

**The C entry is the one wizard change.** The page reads `?persona=&clip=` (`cWizardEntry`: two
well-formed ids or nothing) and passes it in. The wizard resolves the character from the catalog
the page sent and the clip from that character's gallery (`GET /api/text-block-clips`), so a clip
the gallery would not offer today is not offered here either. It lands on the text step, which
serves the next text as it always does. Anything missing is a fresh wizard. The address goes back
to bare, so a reload restarts the wizard as it always has. While it resolves, the card says
`טוענים…` (an existing string).

**A wizard's own finish step links to the page it is on.** A soft navigation there would keep the
mounted wizard and nothing would start over, so the player turns that one case into a full load
(same pathname → `window.location.assign`), and the mount reads the new address. From the home
strip and the library it stays a soft `Link`. Both paths were checked in headless Chrome against
the real `AWizard`: each landed on step 1 with the recording in the strip, the first in the same
window, the second after a reload.

**The modals reserve the button at open**, from the row's service, inert until the route answers
(the pattern תזמון פרסום set). The A line appears with the response, as the pending-posts line
does, under the buttons.

**Layout.** הורדה alone today for a customer (no posting switch row exists, so the default is
admins only), so a customer sees הורדה | גרסה נוספת in two columns. With תזמון פרסום, גרסה נוספת
takes the whole second row.

**The event** is `next_version_started` with `service: "a" | "c"`, sent on the click as a beacon
(the same-page case unloads the page).

## The strings — COPY PENDING FOUNDER REVIEW

- The button, A and C: `גרסה נוספת`
- The A line with a price: `גרסאות נוספות מאותה הקלטה בהנחה: הבאה תעלה {N} קרדיטים. כדאי ליצור
הרבה גרסאות, עם משפט פתיחה וקליפ פתיחה אחרים בכל פעם, ולראות מה עובד.`
- The A line without one: the second sentence alone.

"Text hooks and visual hooks" are written in the wizard's own words: `משפט פתיחה` (the hook-studio
step) and `קליפ פתיחה` (the hook gallery step).

## What the render step says today, and why the line agrees with it

MEASURED 2026-10-22 against the live `credit_costs` row (25 / 20): on a recording nobody has
rendered from, the confirm says 45 and the breakdown reads `45 קרדיטים: 25 לסרטון + 20 על ניתוח
ההקלטה. כל מודעה נוספת מאותה הקלטה תעלה 25.` On a reused recording there is no breakdown and the
confirm says 25. The new line says the next one costs 25 from the same function, and stays silent
on the price whenever the quote would not give it.

## Unverified

- **No signed-in walk.** The account the founder owns as a customer has a finished C video but no
  finished A video. Making one would spend credits and run a job on the live box. The 375 px
  screenshots are from a throwaway harness, deleted before the commit. It mounted the real player
  in the strip's modal chrome, and the real `AWizard` and `CWizard`, behind a fetch mock (the
  number shown is the mock's 25, equal to the live row). The real route and the real number are
  pinned by the test, not by a browser.
- Not seen on a real phone.
- Whether the line moves the "renders per recording" number is the event's job, not this note's.

## Related

- [[0047-finished-renders-play-in-one-component]] — the one player this extends.
- [[0101-tavnit-schedules-and-posts-to-instagram-and-tiktok]] — תזמון פרסום, the pattern followed.
- [[0099-service-c-phase-2-opens-to-customers]] — the C wizard's steps.

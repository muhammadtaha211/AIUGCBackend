---
type: decision
status: verified
verified: 2026-10-13
method: "Founder decisions 1–5 of §2 of the task prompt 'social posting, four UI fixes after PR 3' (2026-10-13), each given as 'Decided on 2026-10-13 … Not up for relitigation' with his reasons, and the planning proposals he accepted there. MEASURED in the tree at fix/social-posting-ui: apps/web/src/lib/social.ts (postCountsByRender), apps/web/src/lib/social-posting-ui.ts (postTag, TILE_TAG_POSTED, SOUND_ON_INSTAGRAM), apps/web/src/app/api/businesses/[businessId]/renders/route.ts, apps/web/src/app/home/render-tile.tsx, apps/web/src/components/ui/button.tsx (WHITE_BUTTON_CLASS), apps/web/src/components/social/when-fields.tsx, apps/web/src/lib/schedule-form.ts, apps/web/src/components/social/sound-picker.tsx (SoundPreview); packages/core/src/providers/meta-graph.ts searchAudio, packages/core/src/pipelines/social.ts (CONTAINER_POLL_DELAY_MS, the publish_post run_at), packages/core/src/jobs/worker.ts (pollIntervalMs 2000), packages/core/src/pipelines/social-failure-email.ts formatPostTime. apps/web/test/social-schedule.test.ts (32 passing). A throwaway harness page and headless Chrome over CDP at 1280 and 375 px: the button's computed colours, both pickers opened by a click on the field's far edge, the keyboard paths, 288 time options, days 1–12 October disabled with today 13 October, an Instagram row opening a new tab. No production query, no paid call, no migration, no deploy."
source: founder
---

# 0108 — Four UI fixes after PR 3: a "פורסם" tag, a readable schedule button, Tavnit's own date and time pickers, Instagram-only sounds kept

Tags as in [[0101-tavnit-schedules-and-posts-to-instagram-and-tiktok]]: **FOUNDER-REPORTED** (his
ruling, statement or reasoning), **MEASURED** (read in the tree, or run), **REASONED** (inference
from what is cited), **PLANNING DEFAULT**. All five decisions are FOUNDER-REPORTED, 2026-10-13, not up
for relitigation. They change [[0101-tavnit-schedules-and-posts-to-instagram-and-tiktok]] (decision
10's tag and the when step) and [[0107-social-posting-pr3-tick-landing-line-failure-email]]'s
screens. **Nothing about how posts are scheduled or published changed**: no core function, no job,
no limit, no email, no connect, no migration.

> **2026-10-16 — §1 now applies per platform ([[0115-tiktok-inbox-posting-pr4]] §3):** one tag per
> platform with its mark, Instagram first; TikTok's terminal words are "נשלח לטיקטוק" on inbox
> delivery and "פורסם" on the published webhook. Instagram's rule is unchanged.

## 1. The "פורסם" tag

A video's tile (the home strip and the all-videos page) shows **"פורסם"** once at least one of its
posts went out and none is waiting; **"מתוזמן"** while any post is waiting (`scheduled`, or
`publishing` — a quota wait included); **no tag** when its only posts failed (or were cancelled).
**His reason:** the user should know a video is already posted and not have to second-guess. The
rule for several accounts was planning's proposal, accepted. "פורסם" is his word, final.

MEASURED, as built: the list route returns `postTag: "scheduled" | "posted" | null` from one grouped
query in the web app (`postCountsByRender`, `count(*) filter (where status …)` over the page's
released rows), decided by `postTag()`; the key is absent for an account the switch hides, as
PR 3's `scheduled` was. "פורסם" is green (`bg-emerald-100 text-emerald-800`, the calendar's posted
chip); "מתוזמן" stays grey.

## 2. The schedule button's colours

White at rest, light grey on hover, its text readable in both states, on every player. **His
reason:** on hover the button disappeared and its black text was barely visible.

MEASURED, the cause: the player used the `secondary` variant, whose `light:` hover is a 4 % ink tint
(`light:hover:bg-ink/[0.04]`). Inside `.theme-light` over the modals' `bg-black/80` that is black,
under `text-ink`. As built: `WHITE_BUTTON_CLASS` — solid `bg-white`, `hover:bg-neutral-200`,
`text-ink` — so it is the same on the black modals and the wizards' paper. Computed in headless
Chrome: rest `rgb(255,255,255)`, hover `oklch(0.922 0 0)`, text `rgb(17,17,17)` in both.

## 3. The date and time pickers

Clicking anywhere on either field opens its picker; the date opens a small month calendar in
Tavnit's own style with the days that cannot be picked greyed out; the time is picked from a list in
5-minute steps; "עכשיו" stays; the same design on phone and desktop, and usable from the keyboard.
**His reason:** only the small icon opened them, which nobody would guess, and both looked outdated.
They worked, so this is a UI fix only. The 5-minute steps and the one design for phone and desktop
were planning's proposals, accepted.

MEASURED, before: PR 3's fields were the browser's own `<input type="date">` and
`<input type="time">`. As built: each field is one button; the month (`MonthCalendar`) disables
every day outside today … the horizon (30 days, or the file's last day — unchanged), arrows move a
day or a week (left is later, right to left), Home/End the week's ends, PageUp/PageDown a month,
Enter picks, Escape closes; the list (`TimeList`) opens on the current time or the next step,
arrows a step, PageUp/PageDown an hour. The field shows "יום ד׳, 14.10" — the weekday and the
numeric date, short enough for a phone's half width; the month's name and year are in the open
calendar. The same component serves the post page's edit form, so it changed there too.

MEASURED, the step against the job: `publish_post` is enqueued with `run_at` = the chosen instant,
the light lane polls every 2 s (`runLane`'s `pollIntervalMs` 2000), then Meta's container is polled
every 60 s (`CONTAINER_POLL_DELAY_MS`). REASONED: a 5-minute step does not mislead — the job starts
at the minute chosen and the Reel goes live a minute or more after it either way. "עכשיו" keeps the
current minute (14:37), off the grid; the list then opens on the next step (14:40), and the field
shows the exact time.

## 4. 24-hour time, no AM/PM

He gave no reason. Planning's: the product is Hebrew-first. The time list is "00:00" … "23:55".

MEASURED, elsewhere in the feature: no AM/PM. The calendar and the done line (`formatTime`), the
post page (`formatWhen`) and the failure email (`formatPostTime`) all format `he-IL` with
`hour12: false`. REASONED: the only source was the native time input, which follows the browser's
locale rather than the page's — an English-locale browser shows AM/PM there.

## 5. Sounds with no file stay, with an honest button

A sound Meta gives no playable file for stays in the list; its play button reads **"האזנה
באינסטגרם"** and opens Instagram in a new tab. Sounds with a file play in place, as before. **His
reason:** they are the most popular trending sounds, and Meta gives no file, so Tavnit cannot play
them. The button's text is his, final.

MEASURED, what decides a new-tab row: core folds Meta's two fields into one link,
`previewUrl: on_platform_audio_preview_link ?? download_url` (`providers/meta-graph.ts`
`searchAudio`), and PR 3's picker tried `<audio>.play()` on it and opened it in a new tab when the
browser refused. So a row went to a new tab whenever Meta sent `on_platform_audio_preview_link` —
an `instagram.com/reels/audio/…` page. Planning's inference (only that field, no `download_url`)
agrees with his own 2026-10-10 Graph API Explorer reading, "either `download_url` or
`on_platform_audio_preview_link`" per row. The tree would also send a row carrying **both** to
Instagram, the page preferred; whether Meta ever sends both is not known (no live call was made).

As built, in the web app only: a link whose host is `instagram.com` or a subdomain of it
(`isInstagramPage`; `cdninstagram.com` is not one) renders as a real link, `target="_blank"`
`rel="noopener noreferrer"`, reading "האזנה באינסטגרם", and stops any preview playing here. Every
other link keeps ▶ and plays in place, with PR 3's open-on-refusal fallback.

## Strings, dependencies, scope

- **New strings:** "פורסם" and "האזנה באינסטגרם" only, both his. The pickers reuse "תאריך", "שעה",
  "החודש הקודם", "החודש הבא" and "עכשיו"; the weekday and month names and the field's face are
  `Intl` `he-IL` output.
- **No new dependency.** No change outside `apps/web`.

## Reported by him the same day (FOUNDER-REPORTED, 2026-10-13)

- PR 3 is merged and works live for him.
- In the trending original sounds, about the first ten opened an `instagram.com/reels/audio/…` page
  in a new tab and the rest played inside Tavnit. Songs always played inside.

## Related

- [[0047-finished-renders-play-in-one-component]] — the one player, where the button lives.
- [[0034-profile-and-settings-are-one-page]] — unchanged.

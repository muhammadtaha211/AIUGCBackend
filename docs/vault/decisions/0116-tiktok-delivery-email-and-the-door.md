---
type: decision
status: verified
verified: 2026-10-17
method: "Founder decisions of §2 of the task prompt 'PR 4.1: the TikTok delivery email and the door' (2026-10-17, docs/claude/prompts/2026-10-17-tiktok-delivery-email.md), each 'Not up for relitigation', with his reasons; the plan approved the same day (docs/claude/plans/2026-10-17-tiktok-delivery-email.md). MEASURED in the tree at feat/tiktok-delivery-email: packages/core/src/pipelines/social-delivery-email.ts, social-failure-email.ts (the shared gate, count and send ladder), social-copy.ts (the path and deliveryEmail), config.ts (envString), apps/worker/src/index.ts, apps/web/src/lib/social-ui.ts, social-posting-ui.ts, the schedule flow; packages/core/test/social-delivery-email.test.ts (18), config.test.ts (6), social-failure-email.test.ts (24, unchanged); apps/web/test/social-schedule.test.ts (46) — passing 2026-10-17 on the branch. The live run behind the path and the unfinished video: [[tiktok-inbox-live-run-2026-10-17]]. No migration, no env change, no deploy, no production write."
source: founder
---

# 0116 — The TikTok delivery email and the door: one email when a video reaches the inbox, one inbox path everywhere, scheduling unchanged, every env string trimmed

Tags as in [[0115-tiktok-inbox-posting-pr4]]: **FOUNDER-REPORTED**, **MEASURED**, **REASONED**,
**PLANNING DEFAULT**. §1–§5 are FOUNDER-REPORTED, 2026-10-17, not up for relitigation. §6 lists the
planning defaults he approved with the plan.

## 1. An email when a TikTok video reaches the owner's inbox

**Options offered:** do nothing (TikTok's own notification); a reminder only after a day of silence;
an email at delivery. **Chosen: the email at delivery.** **His reason:** the owner is not in Tavnit
when the video lands, TikTok's notification is easy to miss — he missed it on the live run, knowing
what to look for — and email is the only channel Tavnit has. MEASURED the same night: one video
(a הוק + דמו, 23:25 UTC on the 16th) is still `delivered`, unfinished, in his own TikTok
([[tiktok-inbox-live-run-2026-10-17]]).

One email per delivered video, sent on the first transition to `delivered` whatever moved it (the
webhook or a poll), never twice for one post; folded per sweep like the failure email; the same
sending path, ceiling and switch logic. Content: the video's name, the account, the three-step path,
a link to the post page, and one line that unfinished videos block new ones. As built:
docs/09 §The delivery email.

## 2. The path, and where it is printed

As observed on the live run (FOUNDER-REPORTED): TikTok → the **Inbox** tab (תיבת דואר נכנס) →
**System Notifications** (התראות מערכת) → the notification "Your content from Tavnit is ready" → tap →
TikTok's editor. The notification's Hebrew wording was not observed, so the English title is quoted and
each tab carries both names, since owners run TikTok in either language. Printed verbatim in four
places — the TikTok card's lead, the schedule note shown when TikTok is picked, the delivered line on
the post page, and the email — from one source, `TIKTOK_INBOX_PATH` in `social-copy.ts`.

**Hebrew copy never says «טיוטה».** His PR 4 change 1 ([[0115-tiktok-inbox-posting-pr4]] §8) forbade
naming a Drafts folder, and a test already fails any TikTok line matching `טיוט|Drafts?`. "Draft" in the
task prompt is English shorthand; the lines say «סרטון». **PLANNING DEFAULT.**

## 3. Scheduling stays as it is; the TikTok-only step says what the time is for

**Options offered:** keep the schedule; send every TikTok video at once ("now"). **Chosen: keep.**
**His reasons:** a video plus an email at the chosen time is a routine an owner can keep, while a pile
of unfinished videos is not; TikTok caps pending uploads at five per account per day, so "send
everything now" fails on the sixth and the hourly deferral would schedule invisibly; in a mixed
schedule the video should land when the Reel goes live. What changes is a sentence: the TikTok-only
time step says the video and a reminder email arrive then, that the sound, caption and posting are
done in TikTok, and that עכשיו sends it right away. The mixed step and Instagram-only get no new
sentence.

## 4. Every environment string in the shared config is trimmed

**His reason:** on 2026-10-17 a Vercel value began with a newline and TikTok refused
`client_key=%0A…`; it must not be possible again, for Meta's keys as much as TikTok's. One
`envString` for every key in `packages/core/src/config.ts`; a padded `DRY_RUN=1` still reads as on; a
test walks the schema's own keys, so a new key that skips the trim fails it. REASONED limit, not
changed: `LOG_LEVEL` (`logger.ts`) and the web's `NEXT_PUBLIC_*` reads do not go through the config.

## 5. Not now, on purpose

A reminder when a video is still unfinished after a day; per-user email preferences; Instagram's
deauthorize callback. Named next steps in state-of-play, not built.

## 6. Planning defaults he approved with the plan

- **Where:** the worker's sweep, a sibling of the failure email — never the publish job or the
  webhook, so an email fault cannot touch a post. The shared machinery (the on/off gate, the pause, the
  day's count, the Resend error ladder) moved into exported helpers in `social-failure-email.ts`; the
  failure email's 24 tests are unchanged and green. **The one edit to code that was not new.**
- **Due:** a TikTok post still `delivered` (a video already posted needs no reminder), delivered in the
  last 24 h, that no earlier delivery email lists. The log is `events` rows of kind
  `post_delivery_email` (no migration — `events.kind` is text); a `refused` row counts as told.
- **Fold and settle:** one email per Tavnit account per sweep, oldest first, no 24 h cooldown (every
  video is told), sent once the newest video was delivered **2 minutes** ago — the failure email's
  settle time — so the email arrives about 2–3 minutes after the video lands.
- **The ceiling is shared:** the failure email's 20 a UTC day, counted over both kinds. Failure emails
  are swept first each tick; **no reserve is built** — a day of deliveries can use the slots a late
  failure would need.
- **The video's name:** a render has no title, so it is the failure email's line — service, business,
  account, planned time.
- **The link:** one video → its page, `https://tavnit.ai/calendar/<postId>`; several → the calendar.
  The page opens for the signed-in owner only (a 404 for anyone else, by design), and the email says
  so, as the failure email does; a web test opens the page the email links to as its owner and as
  anyone else.
- **The path in the email** is a numbered list of the same three phrases the screens join with
  arrows.

## Still open

- Whether the email lands, reads right and links correctly on the box — the live check after the
  merge (docs/09 t8).
- The owed `/privacy` sentence: the page's «שליחת מיילים» names Resend for the two sign-up emails only
  ([[resend-is-an-undisclosed-processor]]); it also lacks the failure email, and now this one.
  Reported, not edited (the legal pages stay held).

## Related

- [[0115-tiktok-inbox-posting-pr4]] — the build this follows; its "Still open" is closed by the live run.
- [[0107-social-posting-pr3-tick-landing-line-failure-email]] — the failure email, which this mirrors.
- [[tiktok-inbox-live-run-2026-10-17]] — where the path and the unfinished video come from.

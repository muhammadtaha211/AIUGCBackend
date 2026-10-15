---
type: decision
status: verified
verified: 2026-10-15
method: "Founder decisions 1 to 6 of §2 of the task prompt 'PostHog records every page, hides only what is sensitive' (2026-10-15), each 'Decided on 2026-10-15 … Not up for relitigation', with his reasons and the planning conditions he accepted; the prompt's three planning defaults. MEASURED at feat/posthog-record-every-page: apps/web/src/lib/analytics.ts (MASK, SENSITIVE, isHidden, EMAIL, maskText, maskInput, isPlayableMedia, maskAttribute, NOT_PLAYABLE, BLOCK_SELECTOR, posthogOptions), apps/web/src/lib/analytics-client.ts (admit, held, recheck, release, decide, queue), apps/web/src/components/recording-notice.tsx and landing/site-footer.tsx, the data-ph-mask marks, apps/web/test/analytics.test.ts (106 tests, all passing 2026-10-15), apps/web/src/lib/api.ts SIGNED_URL_TTL_SECONDS, and the browser check in facts/posthog-hiding-check-2026-10-15.md."
source: founder
supersedes: "[[0104-what-posthog-records-and-what-never-leaves]] §1 and §3"
---

# 0110 — Every page records; only the sensitive is hidden; media shows where a replay plays it; the notice on every public page

Tags as in [[0103-posthog-in-apps-web-eu-cloud-free-plan]]: **FOUNDER-REPORTED**, **MEASURED**,
**REASONED**, **PLANNING DEFAULT**. All six decisions are FOUNDER-REPORTED, 2026-10-15, not up for
relitigation. They reverse [[0104-what-posthog-records-and-what-never-leaves]] §1 (recordings from
`/start` on) and §3 (hidden by default). 0104 §2 (the user id only, admin accounts send nothing), §4
(addresses and the other channels) and §5 (a notice, not a banner) stand.

## 1. Every page is recorded

**FOUNDER-REPORTED.** His reason: he wants to see how a stranger reads the landing and what they
stop at. Planning's reasons for stopping at `/start` (value, quota under ad traffic, no notice on the
landing) he answered: value is highest now, with nobody to ask; a recording costs the same whatever
its length and the free 5,000 a month are not binding; the notice goes on the public pages.

**MEASURED:** `isRecordedPath` and `stopRecordingIfPublic` are gone; the runtime starts the
recording on every route once the gate has answered (`decide`), and nothing stops it between a
public page and an app page (pinned in tests). In the browser check, the landing, `/pricing`,
`/start`, `/reset-password`, `/login` and the harness page each produced a recording batch.
**MEASURED in posthog-js 1.434.15's source, not decided here:** the recorder holds a fresh page's
first batch until the visitor interacts or the visible page unloads cleanly, so a visit with
neither ships no recording.

## 2. Only the sensitive is hidden

**FOUNDER-REPORTED.** His reason: he wants every movement, and business content typed into a tool
for making ads is not sensitive. Planning's addition, accepted: email addresses and other identity
fields stay hidden, since they are personal data rather than business content.

**MEASURED, the mechanism.** Every text node, text field and attribute still goes through Tavnit's
functions (`maskTextSelector: "*"`, `maskAllInputs: true`), so the dashboard's masking settings
cannot override them; the default is now shown. Hidden:

- inside `data-ph-mask`: text, fields, attribute words and links, images and videos;
- password, email and phone fields, a password field switched to text, and fields whose
  `autocomplete` says username, email, tel, current-password, new-password or one-time-code, marked
  or not (`SENSITIVE`);
- an email address anywhere, by pattern (`EMAIL`), from the word before its `@`. One typed into
  an ordinary field is hidden from the moment its `@` is typed; what came before the `@` has been
  recorded by then, since posthog-js records every keystroke (MEASURED in its source: it passes
  rrweb no input sampling). `/privacy` §3 says so;
- codes and tokens in addresses, as before (`sanitizeUrl`), now also in an `http(s)` address shown
  or typed on the page.

Marked with `data-ph-mask`: the account email (sidebar, avatar letter, settings), a connected
Instagram account's name, username and picture wherever they show (settings, its success line and
disconnect dialog, the schedule picker, the calendar, the post page and its link to the post, the
expired-account notice on `/home`), the contact and feedback forms whole, and the deletion code. A
test pins a mark in each of those files. The 2026-10-11 readable markers (`data-ph-unmask`, `ConfirmDialog
readable`) and the recap's mask are removed. Sumit's page is on its own domain and never recorded.

**PLANNING DEFAULTS, unstruck; merged as PR #99 on 2026-10-15 with none struck (FOUNDER-REPORTED: "merge everything"):** the contact and feedback forms are hidden
whole, message included (a message to support is not ad content and may carry a phone number); the
signed-in shell shows the business name and the credit balance, only the email hidden; the footer
line on public pages is the same sentence as `/start`'s.

## 3. Customer media is shown where the replay will play it

**FOUNDER-REPORTED.** His reason: he can open the videos in the database anyway. Planning's
condition, accepted: shown only where a replay would play them; a link that expires first keeps the
blank box. He keeps the separate decision of whether to lengthen a link's lifetime.

**MEASURED:** a replay carries the link and the viewer's browser fetches it (posthog-js's replayer;
PostHog's troubleshooting page). `isPlayableMedia` and the same rule in CSS (`BLOCK_SELECTOR`) show
a link with no query, which covers Tavnit's static files, the public catalogue bucket and Next's
image optimiser serving one. Everything else is a box: a signed link, the Meta CDN, `blob:`,
`data:`, `/api/`. Every signed link apps/web mints lives **3600 s** (`SIGNED_URL_TTL_SECONDS`), so
every customer video and image stays a box. What shows is Tavnit's own: the persona images, and the
landing's and `/home` cards' examples. Lifetimes per kind of media: `docs/10-analytics.md`. No
lifetime was changed.

**REASONED, for his lengthening decision:** a longer lifetime alone would not make customer media
play. The signed link's token is in its query, which `sanitizeUrl` strips as "a token in an
address" (hidden list, decision 2). Showing it would mean keeping a working link to the customer's
file in PostHog for as long as it lives.

## 4. The notice on every public page, as small and muted as the site allows

**FOUNDER-REPORTED.** His reason: keep it subtle. Planning's floor, accepted: readable without
zooming at 375 px, because the open counsel question on notice-only consent (legal-review P14) rests
on the line being a notice.

**MEASURED:** `RecordingNotice` sits in `SiteFooter`, which the landing and the `(marketing)` and
`(legal)` layouts render (every public page), under the copyright line. Every instance, the `/start`
and auth-page lines included, is now `text-[11px] text-ink/45`. That is 11 px, the public pages'
smallest size (the landing's caption badges), at the footer copyright's 45% ink: 3.0:1 on white and
on paper. It was 12 px at 50% (3.5:1). Wording and link are unchanged. **REASONED, the choice:** the
site goes lower. 10 px exists inside the 0.95-zoomed app pane; 35% ink exists on the calendar's
out-of-month days (2.3:1); lime-on-lime badges sit near 1.2:1. Those are dimmed states, not text
meant to be read, and joining 10 px to 35% fails the floor. The line is below WCAG AA's 4.5:1 for
small text, as the copyright line beside it already is; legal-review P14 tells counsel so. On
`/home/new-business`, which shares `/start`'s first step, it sits in the 0.95-zoomed `/home` pane
and renders at about 10.5 px. On public pages it is at the foot of the page, so recording starts
before a visitor can have reached it; that is for counsel too (P14). Screenshots at 1280 and 375 px went to
the founder with the task report; they are not committed. MEASURED there: at 375 px the line wraps
nowhere and the page has no horizontal scroll.

## 5. No gap at sign-in, no stop between public and app pages

**FOUNDER-REPORTED.**

**MEASURED, the mechanism (the admin rule's strength kept, and widened):** from the moment the
session cookie changes, nothing leaves until the gate has answered. That rule is 0104 §2's, where it
was called `canSend`; it is `admit` now. It now compares the cookie's value, not just its presence,
so another account's session written over this one, which Supabase does without removing the old
cookie, and a token refresh both count. It also stops when another tab has marked the device. Each
of these is pinned in tests. The gate is now asked at once, not on the next route, and an answer
fetched for a cookie value that changed meanwhile is asked again. The recorder's batches in between
(up to ten, about twenty seconds) and the steps fired then are held, not dropped. A sign-in's go out
only on a customer's answer: the batches as the recorder's own request (pinned against posthog-js's
`_captureSnapshot`), then the steps. Any other change's go out if the answer allows them and the
identity did not change: a token refresh, or a sign-out through `signOut()`. An admin's answer drops
them, stops the recording and marks the device, as before. Once the gate has said no, nothing is
queued until it says yes again.

**MEASURED in the browser** (on the final tree, the answer delayed 7 s):

- A customer's sign-in reached the stand-in as `$identify` and then the held batch. Its events
  started 7 ms after the cookie and carried the post-sign-in marker.
- An admin's sign-in, both over an anonymous page and written over a live customer session, produced
  no request at all from the cookie on.
- The same browser, signed out, sent nothing on the landing.

## 6. Unchanged

**FOUNDER-REPORTED:** the EU cloud, the free plan, no card; the user id only; admin accounts send
nothing; no proxy; the named steps; no flags, surveys, experiments or server-side capture.

## Related

- [[0104-what-posthog-records-and-what-never-leaves]] — §1 and §3 superseded here; the rest stands.
- [[0103-posthog-in-apps-web-eu-cloud-free-plan]] — the service and the boundary.
- [[posthog-hiding-check-2026-10-15]] — the browser measurement.
- `docs/10-analytics.md` — the mechanism, the shown/hidden table, the media table.
- `/privacy` §3 and §6 and legal-review rows P13 and P14 — what the page now says.

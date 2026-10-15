---
type: fact
status: verified
verified: 2026-10-15
method: "The 2026-10-11 recipe (docs/10-analytics.md, 'The hiding check'), rebuilt in the session scratchpad and not committed: ingest.mjs, a node http server on 127.0.0.1:8789 standing in for PostHog's ingest (config answers {sessionRecording:{endpoint:'/s/'}}; every /e/ and /s/ body recorded, gunzipped, each compressed snapshot inflated; runs 2 and 3 also stamp each request's arrival time); the web dev server started through a temporary .claude/launch.json entry (reverted) with NEXT_PUBLIC_POSTHOG_KEY=phc_local_hiding_check and NEXT_PUBLIC_POSTHOG_HOST=http://127.0.0.1:8789 set in its own process only; drive.mjs, headless Chrome over raw CDP with a normal desktop user agent and --disable-blink-features=AutomationControlled, /api/analytics/viewer answered through CDP's Fetch domain; analyze.mjs, a per-phase split and a substring search of every captured byte. Tree: feat/posthog-record-every-page before its first commit, posthog-js 1.434.15. A throwaway harness page at apps/web/src/app/start/probe/page.tsx (deleted with apps/web/.next after the run) mounted the real Sidebar, WizardNav, C StepStudio, RenderPlayer, SocialAccountsSection, FeedbackForm and ContactForm, a public and a signed image and a hidden input, with marker values; media links pointed at the stand-in. No production write: /start was typed to the signup step and never submitted; the sessions were this project's real session-cookie name with an unparseable value, which the middleware leaves alone. Run 1: every phase, before the adversarial review's fixes. Runs 2 and 3: the sign-in phases again with arrival times; run 3 waits until the page's pre-sign-in batch has reached the stand-in before setting the cookie. Run 4: every phase again on the final tree (after the review's fixes: the email pattern, addresses in text, the plain-CSS block selector, the cookie-value gate), with the harness also mounting PostingNotice, an address typed key by key and a typed link carrying a key, and the strict wait before each sign-in; then drive-j.mjs, a fresh profile, for an admin's session written over a live customer's. The tables are run 4's unless marked."
source: browser
supersedes: "[[posthog-hiding-check-2026-10-11]]"
---

# What leaves the browser once every page records and only the sensitive is hidden

The check behind [[0110-posthog-records-every-page-hides-only-the-sensitive]], measured against a
local stand-in on 2026-10-15. Requests counted at the stand-in; the harness page's own media fetches
are excluded. Run 1 (before the review's fixes) gave the same answer in every row it shares with
run 4, the final tree's.

## Run 4, every phase, on the final tree

| Phase | What the browser did                                                                                                                              | Requests                      | Events                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------- |
| A     | `/?utm_source=probe_ig&utm_campaign=reel_probe&fbclid=PROBEFBCLID`, scrolled                                                                      | config, `/e/`, `/s/`          | `$pageview`, `$snapshot` ×2                                   |
| B     | `/pricing`, scrolled                                                                                                                              | config, `/e/`                 | `$pageview` (its recording arrived during S)                  |
| S     | the landing, `/pricing` and `/start` at 1280×800 and 375×812 (the screenshots)                                                                    | config ×6, `/e/` ×6, `/s/` ×6 | `$pageview` ×6, `start_step_viewed` ×2, `$snapshot` ×6        |
| C     | `/start` typed through every step to the signup recap, then an email and two passwords, not submitted                                             | config, `/e/` ×4, `/s/` ×5    | `$pageview`, `start_step_viewed` ×5, `$snapshot` ×6           |
| D     | `/reset-password?token_hash=PROBETOKENHASH&type=recovery`                                                                                         | config, `/e/`                 | `$pageview` (its recording arrived during E)                  |
| E     | `/login?next=…og-paymentid=PROBESUMIT1…`, an email and a password typed                                                                           | config, `/e/`, `/s/` ×2       | `$pageview`, `$snapshot` ×2                                   |
| F     | a customer session on the harness page; a text, an email, an address key by key, a link with a key, a feedback message and the contact form typed | config, `/e/` ×2, `/s/` ×2    | `$identify`, `$pageview`, `$snapshot` ×3                      |
| G     | the harness page signed out; typing, until its batch arrived                                                                                      | config, `/e/`, `/s/`          | `$pageview`, `$snapshot`                                      |
| G2    | a customer's sign-in on that page, the viewer's answer delayed 7 s                                                                                | `/e/`, `/s/`                  | `$identify`, then the held `$snapshot`                        |
| H     | the same page signed out again; typing, until its batch arrived                                                                                   | config, `/e/`, `/s/`          | `$pageview`, `$snapshot`                                      |
| H2    | an admin's sign-in on it, the answer delayed 7 s                                                                                                  | **0**                         | none                                                          |
| I     | the same browser, signed out, on `/`                                                                                                              | **0**                         | none                                                          |
| J     | (fresh profile) a customer session on the harness page; typing, until its batch arrived                                                           | config, `/e/` ×2, `/s/`       | `$identify`, `$pageview`, `$snapshot`                         |
| J2    | an admin's session written over it (the cookie's value replaced, never absent), the answer delayed 7 s                                            | **0**                         | none; the gate asked again at once, and the device was marked |

**Every page recorded:** the stand-in received a batch whose page address was `/` (with the
campaign), `/pricing`, `/start`, `/reset-password`, `/login` and `/start/probe`. A page's first
batch arrived about five seconds after the visitor's first interaction, so a phase's recording
sometimes landed in the next phase.

**Hidden: none of these 34 markers was in any PostHog payload:**

- `PROBEFBCLID`.
- The domain of an address typed key by key into the studio (`PROBEDOMAIN`), from its `@` on, and
  the key in a typed link (`PROBEURLKEY`), whose address arrived without it
  (`https://shop.example/p/PROBEURLPATH`).
- A connected account named in the `/home` expired-account notice (`PROBEEXPIREDNAME`).
- The admin's typing after their session replaced a customer's (`PROBEOVERHELD`).
- The signup email and passwords (`PROBEEMAIL`, `PROBEPASS`).
- `PROBETOKENHASH`, `PROBESUMIT`.
- The login email and password (`PROBELOGINMAIL`, `PROBELOGINPASS`).
- The account email in the sidebar (`PROBEMAIL`).
- An email typed into the studio's text (`PROBEEDITMAIL`) and one printed in a paragraph
  (`PROBEINLINEMAIL`).
- The feedback form's shown email (`PROBEFBMAIL`).
- The connected account's name, username, picture and success line (`PROBEIGNAME`,
  `PROBEIGHANDLE`, `PROBEIGPIC`, `PROBEIGFLASH`), and Meta's signature (`PROBEOH`).
- The feedback message (`PROBEFEEDBACK`) and a phone number in it (`0501234567`).
- The contact form's name, email and message (`PROBECONTACTNAME`, `PROBECONTACTMAIL`,
  `PROBECONTACTMSG`).
- The signed links' token and files: `PROBETOKEN`, `PROBEVIDEO`, `PROBECLIP`, `PROBESIGNEDIMG`.
- A hidden input (`PROBEHIDDEN`).
- The admin's post-sign-in typing (`PROBEADMINHELD`).
- The strings `probe.test`, `token=` and `og-paymentid`.

**Shown: all of these arrived:**

- The questionnaire answers and their recap (`PROBETYPED`).
- The business name in the sidebar (`PROBEBIZ`).
- The studio's text and an earlier one (`PROBETEXT`, `PROBEOLD`).
- What was typed into it (`PROBEEDIT`), and the words around a hidden email (`PROBEINLINE כתבו`).
- The interface copy: the landing's footer line `השימוש באתר מוקלט`, `כל הזכויות שמורות`, `איזו מודעה
אתם יוצרים היום?`, `שלבי היצירה`.
- The campaign `probe_ig`.
- The public image's link whole: `http://127.0.0.1:8789/storage/v1/object/public/catalog/PROBEPUBLIC.png`.
- The landing's videos with their `/landing/*.jpg` posters made absolute, and the brand mark's
  `/_next/static/media/…png`.

**Media, both kinds:**

- The public image was recorded with its `src`. The signed image, the render player's video and the
  studio's clip were recorded as tag, class and size with no `src` (blank boxes).
- The render's download link, a link and not media, arrived as
  `…/storage/v1/object/sign/renders/PROBEDL.mp4` with no token.

**Addresses arrived cut:** every `$current_url` was origin plus path, the landing's with
`utm_source` and `utm_campaign` and without `fbclid`. Referrers arrived as `$direct`.

**Identity:** each `$identify` carried `distinct_id: "probe-user-0001"` and `$set: {}`.

## Runs 2 and 3, the sign-in on an open page

Run 3 is the strict one. The cookie was set only after the page's pre-sign-in batch had reached the
stand-in, and the viewer's answer was held 7 s. Arrival times are in ms:

| Event                                                                                            | At       |
| ------------------------------------------------------------------------------------------------ | -------- |
| Customer: the pre-sign-in batch (`PROBEBEFORE`) arrives                                          | …283035  |
| Customer: the cookie set                                                                         | …284057  |
| Customer: `$identify` (after the 7 s answer)                                                     | …293109  |
| Customer: the held batch arrives, its rrweb events from …284064 to …284087, carrying `PROBEHELD` | …296133  |
| Admin: the pre-sign-in batch (`PROBEADMINBEFORE`) arrives                                        | …314145  |
| Admin: the cookie set                                                                            | …315291  |
| Admin: anything after that, through the signed-out landing visit                                 | **none** |

After every admin answer (H2 in each run, J2), `localStorage["aiugc.analytics.off"] === "1"`.

Run 2 set the cookie without that wait. A batch holding only events from 4.8 s before the cookie
arrived 170 ms after it, with no post-sign-in marker. **REASONED:** before_send passed it before the
cookie, and the SDK's asynchronous compression delayed the request. `admit` cannot pass an event
while the cookie differs from the last answer. Run 3 rules the ambiguity out.

**Browser storage at the end:**

- localStorage: `ph_phc_local_hiding_check_posthog`, `aiugc.analytics.off`, `aiugc.onboarding.v1`.
- sessionStorage: `ph_…_window_id`, `ph_…_session_registered_properties`, `ph_…_posthog`.
- No cookie.

**What this does not cover:**

- PostHog's real ingest and replay player. The stand-in accepted everything, and that a viewer's
  browser loads a recorded `src` rests on the SDK's replayer and PostHog's troubleshooting page.
- Next's image optimiser. The harness could not serve a stand-in host through it; unit tests cover
  its links.
- `/home` itself and its example cards (`/previews/`), the calendar, the post page and the schedule
  picker: not visited. Their marks are pinned in a test that reads each file; the harness mounted
  the settings card and the expired-account notice, which carry the same kinds.
- Browsers older than Chrome 88 or Safari 14, the case the plain-CSS selector exists for: the
  selector was checked only in current Chrome (19 cases, `selector-check.mjs`, every one as
  intended).
- Network capture turned on from a real dashboard.
- Exceptions: none was thrown.

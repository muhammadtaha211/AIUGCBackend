---
type: fact
status: verified
verified: 2026-10-28
method: "Read, no connect run and nothing in production touched, at origin/main 0fc8ab0 (2026-10-28): packages/core/src/providers/meta-graph.ts, packages/core/src/pipelines/social.ts, apps/web/src/app/api/social/instagram/callback/route.ts, apps/web/src/lib/social-ui.ts; docs/09-social-posting.md §D, §E, §J and the connecting section; vault decisions 0101 and 0106 and facts/instagram-connect-live-run-2026-10-12; state-of-play's founder-reported Meta lines. Line numbers are at that commit."
source: code
---

# What connecting a new Instagram account takes while the Meta app is unapproved

"Unapproved" here means App Review and Business Verification are not passed: verification was filed
on 2026-10-14 and is "In review" (FOUNDER-REPORTED, state-of-play "External state"). No connect was
run for this note. **MEASURED** is a read of the code or of docs/09, **REASONED** a reading of those,
**UNVERIFIED** something nothing in the tree says. [[0128-the-autopilot-is-the-demand-test-engine]]
makes each candidate a new account, so each one needs all of this.

## What the account needs, before anything in Tavnit

1. **A professional account** (Business or Creator). The connect keeps only Pages whose
   `instagram_business_account` is set (`meta-graph.ts:254–264`), so a personal account never comes
   back. In the 2026-10-12 live run tavnit.ai was personal until the window converted it, and Omri
   became a Business account through Instagram's own flow (docs/09 §J).
2. **Its own Facebook Page, linked to it by hand first.** One Page per Instagram account: the
   pre-screen says so (`social-ui.ts:173`), [[0101-tavnit-schedules-and-posts-to-instagram-and-tiktok]]
   decision 3 accepted the cost ("a professional account, a linked Page, one Page per account"), and
   he reported on 2026-10-10 that his other accounts would not link to the same Page
   (FOUNDER-REPORTED, state-of-play "What the founder reported on 2026-10-10"). The link is made in
   the Instagram app, «עריכת פרופיל ← דף ← חיבור או יצירה» (`social-ui.ts:96`, `:188`). Meta's
   one-window setup, which would make the Page inside Facebook's window, is off in production and
   failed for two of three accounts (docs/09 §J, [[0106-instagram-connect-stays-on-todays-flow-with-a-page-first]]).
   Without a Page the connect answers `none` (`callback/route.ts:85`), with the line at
   `social-ui.ts:101–102`.
3. **A bio link, by hand.** Nothing in the tree reads or sets an Instagram account's bio or
   website (MEASURED by grep over `meta-graph.ts`, `social.ts`, `autopilot.ts` and `social-ui.ts`).
   The waitlist link in [[0128-the-autopilot-is-the-demand-test-engine]] is put in the bio in
   Instagram itself.

## What the Facebook window needs

4. **A Facebook profile with a role on the Meta app, or on the portfolio that claimed it.**
   MEASURED on Meta's pages (docs/09 §D, 2026-10-11): Business-type apps have no Development or Live
   modes, the access level alone decides, and Standard Access can be requested only from people with
   a role on the app or on a portfolio that claimed it. REASONED (the same section): the app's seven
   permissions are Standard Access, so "only role users (you) can connect". The portfolio «Tavnit» is
   connected to the app (FOUNDER-REPORTED, state-of-play "External state"), after which the app's
   roles are managed in Business Manager, not the dashboard's Roles panel (docs/09 §E, step 3).
   Whether any profile besides his own holds a role is not recorded.
5. **That profile must manage the Page, so the Page comes back from `me/accounts`**
   (`meta-graph.ts:254–264`; REASONED, Graph API behaviour not exercised here). Consistent with
   that: on 2026-10-12 Omri connected without being in the founder's Accounts Center, through a Page
   the window created under the founder's profile ([[instagram-connect-live-run-2026-10-12]]).
6. **Meta's limit on whose account.** Standard Access is enough only for the app owner's own or
   managed Instagram accounts (docs/09 §D, MEASURED). A customer's or a friend's account is out
   until Advanced Access, which needs App Review and Business Verification (docs/09 §F–H). The
   accounts a candidate test uses are his own, so it holds; where "managed" ends is UNVERIFIED.
7. **In Facebook's window, Continue.** His earlier grant is "all current and future", so a new Page
   and account come with it (docs/09 §J, 0106 §2). If the new account does not come back, he starts
   again, presses **Edit settings** and ticks its Page and account (`social-ui.ts:187–189`).
   `business_management` is in the scope list (`meta-graph.ts:36–42`) because `me/accounts` came
   back empty for Pages linked to a Meta business without it (FOUNDER-REPORTED Explorer result of
   2026-10-10, state-of-play "What the founder reported on 2026-10-10"); a Page made inside the
   portfolio is such a Page (REASONED).

## What happens in Tavnit

8. **A signed-in Tavnit user who passes the Instagram switch starts the connect** (an admin always
   does, `social.ts:186`) at `/connect/instagram` (docs/09, "Connecting an account"). One connect
   upserts **every** professional account the profile returns, under that login
   (`callback/route.ts:84–95`, `social.ts:392–448`): his existing four are refreshed in place and
   the new one is a new row.
9. **It then appears on `/autopilot` as a card switched off, with nothing set**
   (`autopilot-setup.ts:209–228`). The save refuses to switch it on without a count, a character, a
   demo and a usable sound (`:355–369`), and a character can be on one account per login (`:304–307`).
   What a candidate needs on top of that is
   [[autopilot-as-built-against-the-demand-test-2026-10-28]].

## Not covered, not run

- **Page Publishing Authorization.** A Page that requires it cannot be published to until it is
  done, and the app cannot tell in advance (docs/09 §J, citing Meta's content-publishing page, read
  2026-10-12). A brand-new Page may or may not hit it; none has.
- **Nothing here was exercised for a new account.** The last connects on record are the live runs of
  2026-10-12 ([[instagram-connect-live-run-2026-10-12]]); the Meta side can have changed since.

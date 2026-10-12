---
type: decision
status: verified
verified: 2026-10-12
method: "Founder decisions 1–5 of §2 of the task prompt 'social connect, Meta's one-window setup (before PR 3)' (2026-10-12), each 'Decided on 2026-10-12 … Not up for relitigation', with his reasons and his web sources as he tagged them; his two amendments to the session's plan at Stop 1 and his answer on META_LOGIN_CONFIG_ID, same day, in chat. MEASURED in the tree at feat/instagram-onboarding-connect: packages/core/src/pipelines/social.ts (instagramConnectModeSchema, getInstagramConnectMode); apps/web/src/lib/social-oauth.ts (OAUTH_WINDOW_MS, OAUTH_COOKIE_MAX_AGE_SECONDS, checkOAuthReturn, IG_ONBOARDING_EXTRAS, instagramDialogUrl, settingsOutcomePath), apps/web/src/lib/social-ui.ts, the start and callback routes, /connect/instagram, /home/settings; apps/web/test/social-connect.test.ts (25 tests) and packages/core/test/social-accounts.test.ts (7), all passing 2026-10-12. Meta's pages read 2026-10-12 by four readers, each load-bearing line re-fetched by an independent refuter (URLs in docs/09-social-posting.md, runbook J). No live connect, no env change, no deploy, no migration."
source: founder
---

# 0105 — Instagram stays on Facebook login for the sounds; Meta's one-window setup is tried behind a switch, with a code return, never the fragment

Tags as in [[0101-tavnit-schedules-and-posts-to-instagram-and-tiktok]]: **FOUNDER-REPORTED**,
**MEASURED**, **REASONED**, **UNVERIFIED** (no page and no run says it). The five decisions below
are FOUNDER-REPORTED, 2026-10-12, not up for relitigation. The mechanics are in
`docs/09-social-posting.md` (§Connecting an account, §The connect mode, runbook J).

> **2026-10-12, after the live run — decision 5 is ruled
> ([[0106-instagram-connect-stays-on-todays-flow-with-a-page-first]]):** the one-window setup
> returned a code (Omri connected through it) but failed with Facebook's generic error for two of
> three accounts ([[instagram-connect-live-run-2026-10-12]]). Customers get today's flow with the
> Page linked first; the switch stays off, its code stays; PR 3 is unblocked.

## The five decisions (FOUNDER-REPORTED, 2026-10-12)

1. **Sounds stay, so Tavnit stays on the Facebook login.** The options were Facebook login (sounds
   through Meta's Audio API, a Page per account) or Instagram's own login (no Page needed). **His
   reason:** Meta's Audio API page says the catalogue is not supported on the Instagram login (his
   web read, 2026-10-12), and his הוק + דמו files are silent, so a sound is what they post with.
2. **Instagram's own login and Ayrshare are not built.** **His reason:** both lose the sound
   picker, and Ayrshare is reported at about $299 a month for 10 profiles (his web read,
   third-party, 2026-10-12). He noted that Fastlane connects Instagram through Ayrshare on
   Instagram's own login, with no Page.
3. **The connect uses Meta's onboarding mode** (`extras={"setup":{"channel":"IG_API_ONBOARDING"}}`).
   **His reason:** most customers will not have a Page, and Meta's page says this mode converts the
   account, creates the Page and links it in one window.
4. **If it cannot be made to work safely,** the connect stays as built and the pre-screen gains
   Hebrew steps for making and linking a Page. Several accounts per platform stays (0101 §5).
5. **PR 3 waits for his live result on this.**

His limits for the task, kept here because they shape what was built: a token is never readable by
browser script and never in an address Tavnit logs — **if Meta's window works only with the
fragment return, stop and report, do not build it**; every live connect, env change and deploy
waits for his explicit OK; no Page is created for his second account; no migration.

## What Meta's pages say (MEASURED 2026-10-12, refuter-checked)

- `business-login-for-instagram` lists six parameters, "All parameters are required":
  `client_id`, `display=page`, the `extras`, `redirect_uri`, **`response_type=token`**, `scope`.
  The return puts `access_token` and `long_lived_token` in the **address fragment**. The page never
  mentions `state`, `config_id`, `code` or a server-side exchange. Its example scope omits
  `business_management` and says nothing about why.
- No other Meta page mentions the channel. Meta announced it as a beta (Messenger changelog,
  2022-05-19); no later general-availability statement was found.
- The manual flow puts a `code` in the query; Facebook Login for Business says User tokens use the
  "implicit grant by default" and "can support authorization code grant". Meta documents
  `override_default_response_type` only for the JS SDK.
- A Facebook code must be exchanged within 10 minutes **of its creation** and only once (Graph
  changelog, non-versioned change of 2012-12-05) — so time spent inside the window does not age it.

**So the fork:** the one-window setup is documented only with the fragment return. **UNVERIFIED:**
whether Meta's window honours `response_type=code` with the onboarding `extras`. The only
third-party test of that combination (a Meta community thread about three years old, Graph v16.0)
ended in "Something went wrong" while also changing `display` during an outage, so it settles
nothing; one GitHub project builds the same URL and keeps a fallback to `token`.

## What the session proposed and he approved (Stop 1, 2026-10-12)

- **One attempt, behind a switch that needs no deploy.** `app_config.instagram_connect`:
  `"onboarding"` sends Meta's parameter set with ONE change — `response_type=code` — plus `state`
  and `override_default_response_type=true`, the same five scopes, no `config_id`, no `auth_type`.
  An absent row (the default) or a value that does not parse is today's request, byte for byte.
  If the live run shows the window refuses the code or answers in the fragment, nothing more is
  built: the options go back to him — (a) this note's decision 4; (b) a Tavnit page reading the
  fragment, which breaks his limit; (c) the window used only for setup, its token thrown away
  unread, then today's code connect — the token never reaches a script but does pass through the
  browser and its history.
- **Every redirect out of the callback carries its own `#` fragment**, so a fragment Facebook
  appended anyway can never ride on to a page where scripts run.
- **Coming back never ends in a bare "נסו שוב":** six outcomes, each its own line — connected,
  none (the advice follows the mode), expired, mismatch, cancelled, error. The state cookie carries
  its issue time; the window gets **30 minutes** (a PLANNING DEFAULT he did not overrule), and the
  browser keeps the cookie a day so a late return reads as late.
- **His two amendments:** the mode-off line for הוספת חשבון **opens with the Page requirement** —
  the new Instagram account needs its own Facebook Page linked to it — and only then says to press
  "Edit settings" and check that the new Page and account are ticked, because "Continue" returned
  only Shira **because Omri has no Page**; his previous settings were already "all current and
  future". And the 31-minute wait among the live checks is optional — the test covers it.
- **His answer:** `META_LOGIN_CONFIG_ID` is not set in Vercel Production (the only related
  variables are `META_APP_ID`, `META_APP_SECRET` and `SOCIAL_TOKEN_KEY`), so Shira connected
  through the scope-list form of today's request.

## The red error of 2026-10-12

REASONED, not yet MEASURED: the state cookie lived 10 minutes in the browser
(`OAUTH_COOKIE_MAX_AGE_SECONDS = 600` before this change), and he may have spent more than ten
minutes in Facebook's window on the "Edit settings" walk; an absent cookie was refused with the one
line «החיבור לאינסטגרם לא הושלם. נסו שוב.». The same log line also covered a `state` Facebook
dropped and a cookie another tab overwrote, and a return with neither code nor error wrote no log
line at all. Confirming it needs his Vercel log lines for that callback (the message text and the
names of the query parameters, never their values).

## Not changed

`INSTAGRAM_SCOPES` (whether `business_management` is still needed on the onboarding route is
reported, not acted on: Meta's onboarding example omits it, the Instagram use-case page lists it as
required, and only community answers tie it to business-owned Pages); TikTok; the schedule flow;
the legal pages and the landing; Instagram-login code (none written).

## Related

- [[0101-tavnit-schedules-and-posts-to-instagram-and-tiktok]] — decision 3, Facebook login only.
- [[0102-social-posting-label-mix-switch-key-2026-10-11]] — the posting switch this one sits beside.
- [[0104-what-posthog-records-and-what-never-leaves]] — `sanitizeUrl` drops the fragment already;
  the callback's own fragment is the guard for every other script.

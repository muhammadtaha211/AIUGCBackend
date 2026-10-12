---
type: fact
status: verified
verified: 2026-10-12
method: "Read-only, production, through packages/core/.work/connect-mode-peek.ts (gitignored; one read-only transaction): `select value, updated_at from app_config where key = 'instagram_connect'` and `select platform, username, status, page_name is not null as has_page, access_token_enc is null as page_token_null, user_token_enc is null as user_token_null, connected_at, disconnected_at from social_accounts order by connected_at`, run four times on 2026-10-12 between ~15:05 and ~16:20 UTC. The steps inside Facebook's window are the founder's own reports in chat that day (FOUNDER-REPORTED); no session saw the window."
source: db
---

# The Instagram connect, live on tavnit.ai, 2026-10-12: the one-window setup returned a code once and failed twice; today's flow with a linked Page worked every time

The run behind [[0106-instagram-connect-stays-on-todays-flow-with-a-page-first]], on the build of
PR #93 (`fc8a03d`, decision [[0105-instagram-stays-on-facebook-login-one-window-setup-behind-a-switch]]).
One Facebook profile (the founder's), one desktop browser, his admin account.

## MEASURED in production (times UTC)

| when     | what the database shows                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 15:15:26 | Shira's row refreshed by a round trip with the switch **off** — it came back connected, not on the old failure line            |
| 15:27:28 | `app_config.instagram_connect` = `"onboarding"` (the founder's insert)                                                         |
| 15:33:02 | Shira disconnected: the row kept, `status = disconnected`, **both tokens null** (live check u, the token half)                 |
| 15:34:03 | Shira connected again as a new row (a disconnected row is not live, so the upsert inserts)                                     |
| 15:35:54 | **Omri** (`omri.creates`) connected with a Page, and Shira's live row refreshed in the same instant — one return, two accounts |
| 16:14:14 | **Yael** (`yael_creates`) connected with a Page — with the switch off by his report; the next read found no switch row         |
| ~16:20   | three live rows, Shira, Omri and Yael, **each once**; no `instagram_connect` row                                               |

**What that settles (MEASURED from the rows and the code):** in production a `social_accounts` row
is written only by the callback, after it exchanges a `code` from the query string server-side; the
handles are real accounts, not DRY_RUN's stub. Omri's row was written with the switch on, so **Meta's
one-window setup (`IG_API_ONBOARDING`) answered `response_type=code` in the query** — the point
Meta's page leaves undocumented. A Page created inside that window came back from `me/accounts` on
the same return.

## FOUNDER-REPORTED (what the window showed)

- **Omri** — professional, no Page, signed in to Instagram in another tab, **not** in the founder's
  Accounts Center. The window offered to create the Page; the first attempt errored and returned to
  Tavnit with a failure line (which one is unrecorded); the second showed a Page Meta had already
  made with a default name ("Omri's created page" or similar), he picked it, and it connected.
- **Yael** — professional, no Page, in the founder's Accounts Center. Picking the account inside the
  window threw Facebook's "Sorry, something went wrong. We're working on getting this fixed as soon
  as we can." before any password prompt — also with Yael made the active account on instagram.com
  first.
- **tavnit.ai** (the brand's own account) — personal, in the founder's Accounts Center. The window's
  switch-to-professional flow worked; adding it again, the same Facebook error the moment the
  password was entered.
- **Yael again, switch off** — after he linked a Page he had just created to Yael by hand, today's
  flow was "so quick and seamless": in Facebook's window he pressed confirm (continue), not "Edit
  settings", and Yael was added.
- His Accounts Center (seen as Yael): Yael, tavnit.ai, his personal Instagram and his personal
  Facebook — Omri is not there.

## REASONED, not measured

Both one-window failures are Instagram accounts in the same Accounts Center as the Facebook profile
running the window; the one success is not. Two cases, no Meta statement. The one public report of
this failure (a Meta developer-forum thread, about three years old) names the same generic page right
after the Instagram step, only with this setup mode, for some accounts and not others, with the
console error GraphQL 1850019 "There was an error during business onboarding flow"; Meta never
answered and its only workaround is to drop the mode. Facebook's error page never returns to Tavnit,
so the callback cannot see it.

## Still not measured

The failure line Omri's first attempt landed on; the disconnect confirm's count (u); a return address
(v); whether `business_management` is needed on either route.

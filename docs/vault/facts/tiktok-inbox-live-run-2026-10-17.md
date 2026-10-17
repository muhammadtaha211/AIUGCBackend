---
type: fact
status: verified
verified: 2026-10-17
method: "Read-only, production, three one-off scripts under packages/core/.work (gitignored; node + the postgres driver, DATABASE_URL read from apps/cli/.env inside the script, no token column selected): `select platform, status, count(*) from social_accounts where platform='tiktok' group by 1,2`; `select p.status, r.service, r.params->>'format', p.scheduled_at, p.delivered_at, p.updated_at, left(p.failure_detail, 200) from scheduled_posts p join video_renders r on r.id = p.video_render_id where p.platform='tiktok' order by p.scheduled_at`; `select status, connected_at, disconnected_at, access_token_enc is null, refresh_token_enc is null from social_accounts where platform='tiktok' order by connected_at`; `select created_at, payload->>'platform', payload->>'failureKind', payload->>'outcome' from events where kind='post_failure_email' and created_at > '2026-10-16'`. All run 2026-10-17. The steps and the verdicts t1 to t6 are the founder's own report in chat (FOUNDER-REPORTED); no session saw TikTok's app or the phone."
source: db
---

# TikTok inbox posting, live in the sandbox, night of 2026-10-16/17: the first post was refused for URL ownership, the next two reached the inbox, one was posted public

The first live run of [[0115-tiktok-inbox-posting-pr4]], on the build of PR #107 (merged as
`f11ff04`). One sandbox target user, the founder's account, the sandbox client key and secret on
Vercel Production and on the box. Times are UTC; Israel is three hours ahead, so this is the early
hours of 2026-10-17 there — the date the founder gives the run.

## MEASURED in production

| when     | what the database shows                                                                                                                                     |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 23:07:58 | the TikTok account connects (`connected_at`) — the first of the two TikTok rows                                                                             |
| 23:10:00 | a Service A (`steps`, הוק + דמו) post scheduled for 23:10 `failed` in the same second as `platform_refused`: **`tiktok 403 url_ownership_unverified`**      |
| 23:12:22 | its failure email — `post_failure_email`, platform `tiktok`, kind `platform_refused`, outcome `sent` (the only failure email in the table since the 16th)   |
| 23:25:00 | a second Service A (`steps`) post scheduled; `delivered_at` 23:25:24 — **TikTok's inbox accepted the silent הוק + דמו file**; it is still `delivered` today |
| 23:30:00 | a Service C post scheduled; `delivered_at` 23:30:20; `posted` at 23:35:42 with a post id **and** a permalink                                                |
| 23:37:32 | the account row `disconnected`, both tokens erased (`access_token_enc` and `refresh_token_enc` null) — what a removal in TikTok, or ניתוק, leaves           |
| 23:38:00 | the account connects again as a new row (`connected`, tokens present) — a disconnected row is not live, so the upsert inserts                               |

**What that settles (MEASURED, from the rows and the code):**

- The sandbox **honours a URL property, and has its own**: the refusal was TikTok's
  `url_ownership_unverified` on the pull from `auth.tavnit.ai`, and the next upload through the same
  host succeeded once the founder verified the domain in the sandbox (FOUNDER-REPORTED: "the sandbox
  kept its own URL properties list and needed its own domain verification"). The runbook line now
  says to verify the domain in the sandbox too.
- A silent file is accepted: the 23:25 post is a `steps` render, whose file has no audio stream. The
  plan's stop condition (approval change 5) did not fire.
- A post id and the player link exist on the posted row. TikTok gives `post_id` only for a public
  post ([[the-sandbox-cannot-post-publicly-2026-10-16]], falsified), so the post finished in TikTok's
  editor was public, as the founder reports. Whether the player link opens is not measured.
- The failure email works end to end from the box with the PR 4 build (the 23:12 row), for TikTok.
- The 23:25 post is a draft nobody finished. It is the case the delivery email of PR 4.1 exists for.

**What the rows do not show (reported, not smoothed over):**

- No Service B (דמות AI) post exists, so check t3 as docs/09 wrote it ("the same with a voiced
  render (דמות AI)") has no row; the voiced post is a Service C clip, which plays its own recorded
  sound. The founder reports t1 to t6 passed.
- No post failed as `connection_expired`, and no such email exists, so the second half of t5 — "the
  waiting post is red at once with the reconnect line, and an email within about three minutes" —
  left no trace in the database. The account side of t5 is there (the 23:37 disconnect, tokens
  erased, and the reconnect at 23:38).
- Whether the delivery and the completion arrived by the webhook or by the poll is in Vercel's and
  the worker's logs, which no session read.

## FOUNDER-REPORTED

Checks t1 to t6 passed; the post made in TikTok's editor was public; the sandbox kept its own URL
properties list and needed its own domain verification; the box runs the PR 4 code with the failure
email on; the sandbox pair is on Vercel Production and on the box. The sandbox therefore has its own
client key and secret (the open question in docs/09 and 0115).

## Related

- [[0115-tiktok-inbox-posting-pr4]] — the build this ran.
- [[custom-domain-serves-storage-2026-10-16]] — the probe that chose `auth.tavnit.ai`; this run is
  the first time TikTok pulled through it.
- [[instagram-connect-live-run-2026-10-12]] — the same shape of note for Instagram's run.

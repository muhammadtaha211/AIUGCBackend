---
type: decision
status: verified
verified: 2026-10-11
method: "Founder decisions 1–12 of the task prompt 'schedule a finished video and post it to Instagram and TikTok' (from his planning chat of 2026-10-10), its planning defaults, and the plan's own defaults — the plan was approved on 2026-10-11 with no question of its §10 answered, so each recommendation there stands as a PLANNING DEFAULT until he rules. MEASURED in the tree at feat/social-posting-core: supabase/migrations/0057_social_enums.sql, 0058_social_tables.sql, 0059_events_alert_index_post_failed.sql; packages/core/src/secret-box.ts, providers/meta-graph.ts, pipelines/social.ts, alerts.ts, handlers.ts, jobs/schedule.ts, config.ts, db/schema.ts; packages/core/test/secret-box, meta-graph, social-accounts, social-scheduling, social-publish and migrations tests. The live-doc facts cited were read on developers.facebook.com and developers.tiktok.com on 2026-10-10 by twelve readers and re-fetched by one independent refuter per load-bearing line (the URLs are in docs/09-social-posting.md and docs/04-integrations.md). No production query, no paid call, no live post, no migration applied by the build task. PR #89 merged 2026-10-11; the same day the founder approved the one push of 0057–0059 ('push 0057–0059, I approve this one push') and it was applied with a read-back before and after (packages/core/.work/readback-0057-0059.ts: ledger 57 -> 60 rows, the three types, the two tables with RLS on and 0 policies, 7 indexes, the alert predicate with post_failed) — recorded in facts/production-migration-push-log.md."
source: founder
---

# 0101 — Tavnit schedules a finished video and posts it: Instagram as a Reel with a catalogue sound, TikTok to the inbox

Tags as in 0099: **FOUNDER-REPORTED** (his ruling, statement or reasoning), **MEASURED** (read in
the tree, on a live doc page, or run), **REASONED** (inference from what is cited), **PLANNING
DEFAULT** (assumed by the planning assistant or this plan, kept at his approval and not otherwise
ruled). The mechanics live in `docs/09-social-posting.md`; this note records what was decided and
why.

## The twelve decisions (FOUNDER-REPORTED, 2026-10-10, not up for relitigation)

1. **Tavnit schedules and posts.** His reason, as user #1: the cost of 40 videos a month is 40
   trips through Instagram, across four accounts, not ₪150.
2. **Music is a must, and it comes from the platform, never from Tavnit.** Instagram sounds are
   attached through Meta's Audio API. CLAUDE.md's locked decision 7 is unchanged: no music is baked
   into a file. He proposed baking label songs and accepting the legal risk; planning declined to
   write that, and he went on with the picker note (decision 9).
3. **Instagram connects through Facebook login only.** Meta offers the sound feature on that setup
   alone. The cost is accepted: a professional account, a linked Page, one Page per account.
4. **TikTok is inbox only.** The inbox is where the customer adds a sound and checks the video.
   Direct posting stays private until TikTok audits the app.
5. **Several accounts per platform, chosen at schedule time.** He runs three Instagram accounts
   and one TikTok.
6. **The schedule button goes on all three surfaces**: the wizard's finish page, the player opened
   from the home strip, the player opened from the all-videos page. (MEASURED: that is five
   `RenderPlayer` mounts — the three wizards' finish steps, the strip modal, the library modal —
   the Service C wizard being the fifth that 0047 predates.)
7. **First-time users are sent to Integrations and returned to the video.**
8. **The calendar grid ships in this task, not after a plain list.** It is built with AI, so
   staging buys nothing.
9. **The picker note with its download button replaces a manual-post reminder.** Less friction.
10. **The grey "scheduled" tag.** Nobody should have to second-guess whether a video is already
    scheduled.
11. **Posting and scheduling cost no credits and are open on every tier.** He may tier-lock later
    ("probably not"). 0051 §4's "tiers differ by credit volume only" stands.
12. **Not now**: campaigns that generate themselves (wanted, a later decision), any price change
    (0068 stands), posting by signing in as the customer.

## Planning defaults (PLANNING DEFAULT, kept at approval)

> **2026-10-11 — three of these moved ([[0102-social-posting-label-mix-switch-key-2026-10-11]]):**
> the AI label is the customer's tick per post, unticked by default on every service (no longer per
> service); the mix is per service — הוק + דמו 100/0, דמות AI 15/100, גוש טקסט 100/40 (no longer
> 35/100); the switch gains a third setting, named accounts, beside admins and everyone. The
> paragraphs below keep the original defaults as they were approved.

From the prompt, unstruck: hidden until Meta approves the app, admins only, behind one switch
(`app_config.social_posting`); TikTok built only once a sandbox app exists — none did at approval,
so it is the next task and the Integrations section shows no TikTok card; connections belong to the
Tavnit account, not to one business; the sound is optional, plays at full volume on a silent video
and sits under a video's own audio; one sound choice covers every Instagram account picked for a
post; times are the customer's local time stored as an absolute instant, "now" is the earliest
choice; a pending post can be changed or cancelled until posting starts, and disconnecting an
account cancels its pending posts visibly; a video can be scheduled more than once and the tag
shows while any post is pending; no caption writing by AI; every Hebrew string is drafted by the
session and approved by him before merge.

From the plan, where §10 asked and he did not rule: the **AI label** `is_ai_generated=true` on
הוק + דמו and דמות AI, not on גוש טקסט; the **mix** `audio 100 / video 0` for a silent render and
`audio 35 / video 100` for one with its own sound (REASONED, one constant, judged on the first live
B post); **quota at post time defers** hourly for up to a day, then fails; a silent AAC track for A
renders is **not** added — if Meta refuses a stream-less Reel, that is its own task; the **horizon**
is 30 days and never past retention minus a day, the retention read from `app_config`;
`share_to_feed=true`; the calendar is per account across businesses; failures are told in the app
only (no email path exists — 0014 flagged it); the browser's time zone, not a pinned one; cancelled
posts are not shown on the grid; no Facebook permission is revoked on disconnect; a failed post's
"תזמון מחדש" carries the caption and sound forward; three migrations (types alone, the two tables
with RLS inline, the alert index); 45 Tavnit posts per Instagram account per rolling day as the
margin under Meta's 50; the sound picker's ~60-day User token is stored beside the Page token
because Meta documents the audio search against a User token (if the live run shows the Page token
serves it too, the column goes).

## What the live docs settled (MEASURED, 2026-10-10)

- A Page token derived from a long-lived User token has no expiration date; publishing rests on
  it. Facebook Login documents no re-exchange of a valid long-lived User token.
- `GET /ig_audio?audio_type&user_id&search_query` is a root edge, one kind per call, trending when
  the query is omitted; "returns audio that has been authorized for third party use" and "may
  vary from what appears in the native app" — the limit the picker note answers. No start offset.
- `audio_configuration={audio_id, audio_volume, video_volume}`, both volumes 0–100.
- Containers report IN_PROGRESS | FINISHED | PUBLISHED | ERROR | EXPIRED, expire after 24 hours;
  the docs disagree on the daily publish cap (100 vs 50) and name 400 container creations a day;
  publishing the same `creation_id` twice and recovering a media id from a PUBLISHED container are
  both undocumented — hence the checkpoint before and the instant after `media_publish`.
- Reel spec: MP4, moov atom front (Remotion 4.0.499 muxes with faststart), H.264, AAC, 3 s–15 min,
  ≤ 300 MB. Whether an audio track is required is unstated; the founder's own Reel proved one
  Tavnit render accepted (which service is unrecorded).
- Development mode serves role users only; "test posts" are visible only to role users and the
  docs do not say whether that reaches Instagram media. Advanced Access needs App Review and
  Business Verification, and an app Meta cannot test (no login UI) is approved only for
  `instagram_basic` and `instagram_manage_comments` — the web PRs must exist before filing.
  `business_management` is required for `me/accounts` to list Pages linked to a Meta business.
- TikTok: inbox init needs `video.upload`, carries no caption, 6 calls/min; `PULL_FROM_URL`
  needs a verified domain we do not own, so `FILE_UPLOAD` from the worker; at most 5 pending
  shares per 24 h; access token 24 h, refresh 365 days; web redirect must be https, so no
  `localhost` live test; sandbox excludes "public videos" only.

## What exists after PR 1 (MEASURED) and what does not

Schema and the three migrations (applied to production 2026-10-11 on the founder's one-push
approval, after PR #89 merged — [[production-migration-push-log]]), `secret-box.ts`, the Meta wrapper with
its DRY_RUN stub, `pipelines/social.ts` (the switch, connections, scheduling with its guards, the
publish job, the daily token check, the deletion path), the registry entries, `POST_FAILED` in the
alert kinds, and the tests — `social-publish.test.ts` replays every checkpoint (a crash after the
container, a crash inside `media_publish`, a lease reclaim, a cancel) and asserts one container and
one publish each time. **No web surface exists**: Integrations, the OAuth routes, the schedule flow,
the sound picker, the calendar, the tag and the layout's switch are PRs 2 and 3; TikTok is PR 4.
Nothing a customer can reach changed.

## Still his to rule (OPEN)

> **2026-10-11:** the AI label and the bed are ruled, and the live-test executor is a planning
> default (the box on `origin/main`, never a task branch) — [[0102-social-posting-label-mix-switch-key-2026-10-11]].
> No TikTok developer app exists (FOUNDER-REPORTED, same day).

Whether the recommendations above stand or move (the AI label per service, the 35 % bed, the
deferral, `share_to_feed`); whether a failure email is ever built; the live-test executor (the box
on the task branch, recommended, or a local worker with a non-local `WORKER_ID`); `DRY_RUN=0` on the
local web for the OAuth window; whether a TikTok sandbox app exists.

## Related

- [[0034-profile-and-settings-are-one-page]] — `/home/settings` gains חיבורים (web PR).
- [[0047-finished-renders-play-in-one-component]] — the button beside הורדה; a fifth surface.
- [[0051-the-credit-unit-and-the-three-credit-only-plans]] — no credits, every tier (decision 11).
- [[0068-prices-stand-no-free-tier-trials-by-hand]] — prices untouched (decision 12).
- [[0046-billing-ships-as-osek-patur]] §4 — the precedent: our worker owns a schedule.
- [[0037-the-worker-reports-to-sentry-the-web-apps-do-not]] — why `post_failed` rides `events`.

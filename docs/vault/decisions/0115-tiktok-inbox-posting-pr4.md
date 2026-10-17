---
type: decision
status: verified
verified: 2026-10-16
method: "Founder decisions of §2 of the task prompt 'PR 4: TikTok inbox posting' (2026-10-16, docs/claude/prompts/2026-10-16-tiktok-inbox-posting.md), each 'Not up for relitigation', with his reasons; his approval of the plan the same day 'with these changes' (five) and his explicit OKs (docs/claude/plans/2026-10-16-tiktok-inbox-posting.md §The founder's approval). TikTok's pages read live on 2026-10-16 through WebFetch by four independent readers and re-checked by three critics and a verifier (developers.tiktok.com/doc/: login-kit-web, oauth-user-access-token-management, oauth-error-handling, tiktok-api-v2-get-user-info, content-posting-api-get-started-upload-content, content-posting-api-reference-upload-video, content-posting-api-reference-get-video-status, content-posting-api-media-transfer-guide, webhooks-overview, webhooks-events, webhooks-verification, content-sharing-guidelines, add-a-sandbox, content-posting-api-reference-direct-post, tiktok-api-scopes, embed-player, getting-started-design-guidelines). MEASURED in the tree at feat/tiktok-inbox-posting: packages/core/src/providers/tiktok.ts, packages/core/src/pipelines/social.ts (the TikTok section, getPlatformAccess, assertAccountCaps, schedulePosts), packages/core/src/pipelines/social-failure-email.ts, supabase/migrations/0064, 0065; packages/core/test/tiktok.test.ts (17), social-tiktok.test.ts (27), social-failure-email.test.ts (24), migrations.test.ts (31); apps/web/test/social-connect.test.ts (36), social-schedule.test.ts (43), social-tiktok-webhook.test.ts (7) — passing 2026-10-16 on the branch after the diff review's fixes, each file in its own vitest run. The custom-domain probe: [[custom-domain-serves-storage-2026-10-16]]. No env change, no TikTok call, no deploy; 0064 and 0065 pushed 2026-10-17 on his instruction, read back before and after ([[production-migration-push-log]])."
source: founder
---

# 0115 — TikTok inbox posting (PR 4): inbox only, no caption or sound or tick, tags per platform, webhooks, a switch of its own, the console's redirect and scopes, sandbox until the audit

Tags as in [[0101-tavnit-schedules-and-posts-to-instagram-and-tiktok]]: **FOUNDER-REPORTED** (his
ruling, statement or reasoning), **MEASURED** (read in the tree, on a live page, or run),
**REASONED** (inference from what is cited), **PLANNING DEFAULT** (assumed by planning, kept at his
approval). §1–§7 are FOUNDER-REPORTED, 2026-10-16, not up for relitigation. §8 is his approval of the
plan, the same day. §9 lists the planning defaults he approved with it. They change
[[0101-tavnit-schedules-and-posts-to-instagram-and-tiktok]] (decision 4's mechanics, the "one switch"
default, the `FILE_UPLOAD` fact, "no TikTok app"), [[0102-social-posting-label-mix-switch-key-2026-10-11]]
§4 (no TikTok card), [[0107-social-posting-pr3-tick-landing-line-failure-email]] §3 (the email's
cause) and [[0108-social-posting-four-ui-fixes-after-pr3]] §1 (one tag per video), whose dated
pointers lead here.

## 1. Inbox only; direct post rejected, not deferred

TikTok gets the file in the owner's inbox; the owner finishes in TikTok — sound, caption, publish.
Direct post is **rejected**, not waiting for TikTok's audit. **His reason, on evidence:** TikTok
offers no way to attach a sound by API, and music is a must (0101 decision 2). MEASURED 2026-10-16:
[[tiktok-api-attaches-no-sound-2026-10-16]]. No direct-post code exists, not even behind a flag: the
provider wraps the inbox init alone (`providers/tiktok.ts`).

**How the file reaches TikTok** (his latitude, the plan's choice, approved): **`PULL_FROM_URL`
through `https://auth.tavnit.ai`**, not `FILE_UPLOAD`. 0101 chose `FILE_UPLOAD` because the pull
"needs a verified domain we do not own"; the tavnit.ai domain property is now verified in TikTok's
console (FOUNDER-REPORTED, 2026-10-16), and MEASURED the same day, the Supabase custom domain
`auth.tavnit.ai` serves a signed render URL with 200, `video/mp4`, no redirect
([[custom-domain-serves-storage-2026-10-16]]). TikTok's guidelines ask apps whose files are already
on their servers to pull ("do not use FILE_UPLOAD"); it mirrors Instagram's URL hand-off; no video
bytes cross the worker's lane or a Vercel function. REASONED risk, a console fix if it bites: whether
the **sandbox** honours the URL property (`url_ownership_unverified` → `platform_refused`, the code in
the detail) — _[2026-10-17: it bit, exactly so: the first live post failed with that code, and the
fix was the sandbox's own domain verification in the console, [[tiktok-inbox-live-run-2026-10-17]]]_.
A new dependency: the custom-domain add-on ([[0063-auth-custom-domain]]) is now
load-bearing for TikTok delivery.

## 2. No caption, no sound, no AI tick for TikTok

The inbox init carries only the file (MEASURED: its body is `source_info` alone); the owner adds the
rest in TikTok. The quiet AI tick controls Instagram only and is **not shown when no Instagram
account is selected**. As built: `schedulePosts` writes a TikTok row with caption `''`, no sound and
`ai_label = false` whatever the request says; an edit of a TikTok post changes its time only; the
schedule flow shows the caption, sound and tick step only when an Instagram account is picked.

## 3. Tags per platform

Today's rule — "מתוזמן" while any post waits; the terminal word once one went out and none wait; no
tag when the only post failed — now applies **per platform**, each platform its own tag with its
icon, **Instagram first**. Instagram's terminal word stays **פורסם**. TikTok's is **נשלח לטיקטוק**
on inbox delivery and **פורסם** on the published webhook. Never more than one tag per platform on a
tile. "נשלח לטיקטוק" is his word, final.

PLANNING DEFAULT, approved: with two TikTok accounts on one video, an unfinished draft
(`delivered`) outranks a posted one — it is the thing the owner still has to do.

## 4. Webhooks in this PR

Callback `https://tavnit.ai/api/social/tiktok/webhook`, registered in the production draft (and meant
to be in the sandbox — not confirmed). Handle inbox-delivered, published and authorization-removed;
verify TikTok's signature with the client secret; ignore events not handled; idempotent. **His
reason:** without them Tavnit knows only that it sent a file, and he wants the calendar to show which
drafts the owner never finished.

As built (planning defaults, approved): `post.publish.complete` is "published"; a
`publicly_available` post id gives "צפייה בפוסט" through TikTok's documented player address — **a
stopgap he approved, checked after the audit** (a sandbox post cannot be public, MEASURED on
add-a-sandbox) _[Corrected 2026-10-17: the sandbox's post was public and its row holds the post id
and the link, so the check is his look now; the claim is in
[[the-sandbox-cannot-post-publicly-2026-10-16]], falsified]_; `post.publish.failed` is **received and ignored** (his OK) — the job's own poll owns
failure, which keeps the job's one fresh upload after a retryable failure reachable; an
`authorization.removed` marks every live row of that open_id `disconnected` (it leaves חיבורים, like
ניתוק) and **fails its waiting posts at once as `connection_expired`**, so the existing notice and
failure email reach the owner the same minute; a removal created before a reconnect never undoes it
(`connected_at` moves on every connect). Signatures are accepted up to 73 h old: TikTok retries for
72 h and does not say a retry is re-signed (NOT STATED), and every write is guarded and monotonic.

## 5. A TikTok switch independent of Instagram's

Same mechanism and modes: `app_config.tiktok_posting` (admins / named / everyone, an absent row
admins only, a row that does not parse hides TikTok). **His reason:** Meta's review and TikTok's audit
will clear on different days. As built: `social_posting` became Instagram's switch (its key kept);
`getPostingAccess` means any platform; every read is filtered to the platforms the account's switches
allow; each platform's own routes open on its own switch.

## 6. Redirect, scopes, platform

Redirect `https://tavnit.ai/api/social/tiktok/callback`, exactly; scopes `user.info.basic` and
`video.upload`; Web only. **His reason:** that is what the console holds. As built, the redirect is a
constant, never derived from a request — so only tavnit.ai completes a live connect (a DRY_RUN start
lands on its own origin's callback instead).

## 7. Sandbox credentials until TikTok's audit passes, the production pair after

Connections made on sandbox credentials carry sandbox open_ids and need reconnecting after the
switch; designed so that is **a reconnect, not a data repair**. As built (REASONED from TikTok's
oauth-error-handling page: `invalid_grant` covers a refresh token "issued to another client"): after
the swap a sandbox account's refresh fails, the account turns `expired` by itself, the owner connects
again — the row restored in place if the open_id is the same, else a new row and one ניתוק of the old
`expired` one. No SQL. docs/09 §Runbook: the TikTok app has the swap.

## 8. His approval of the plan (2026-10-16): five changes

1. Every "תיבת הטיוטות" reference becomes **the inbox notification** — TikTok's doc says the owner
   must open the inbox notification to continue editing; the video is not in the Drafts folder.
   Final wording after the live run shows where it lands. The tag נשלח לטיקטוק stays.
2. The pending-cap guard counts **scheduled, publishing and delivered only**, not posted: posted
   drafts are not pending at TikTok; the 403 and the hourly deferral cover the rest.
3. The prompt and the plan are saved in the repo (`docs/claude/prompts/`, `docs/claude/plans/` —
   CONVENTIONS names no place).
4. The 65 status polls must not hold a worker lane for an hour inside one run — **MEASURED, they do
   not:** each poll returns `{kind: "reschedule", delayMs: 60000}` with its state (Instagram's
   pattern), which ends the run and frees the lane.
5. **If the sandbox refuses the silent הוק + דמו, stop and report; renders do not change.**

His OKs the same day: push 0064 and 0065 before the merge with their read-backs; the failure
email's cause becomes (account, platform, kind), amending 0107 §3; the player-URL permalink as a
stopgap; `post.publish.failed` received and ignored; each platform's icon fetched from its official
brand kit.

## 9. Planning defaults he approved with the plan

- **The failure email's cause** is (Tavnit account, platform, failure kind) — 0107 §3 amended — so
  an email never names Instagram for a TikTok failure; the 24-h fold matches the platform, and an
  email logged before PR 4 counts as Instagram's. The hide check asks the post's own switch.
- **TikTok's own constants:** 65 polls a minute apart (TikTok's pull "times out one hour after the
  download task is initiated"); a 2-h signed-URL TTL (Instagram's stays 1 h); a refresh under 10
  minutes left, under a row lock (TikTok "may" rotate the refresh token); one fresh upload after
  `internal` or `video_pull_failed`; the 5-pending guard a day either side, over-refusing only.
- **ניתוק revokes nothing at TikTok**, Instagram's reason: the grant is per app per TikTok user.
- **A daily status poll beside the webhook** for posts delivered in the last week, logged
  `source: poll`.
- **The marks:** TikTok's icon (`TikTok_Icon_Black_Circle.png`, the developer portal's logo pack)
  and Instagram's glyph (`Instagram_Glyph_Black.svg`, Meta's brand pack), unaltered files under
  `apps/web/public/brand/` — TikTok's design guidelines forbid using its logos otherwise.
- `named` stays by Tavnit user id.
- From the adversarial review of the diff (2026-10-16; four lenses, a skeptic per lens; 15
  findings survived, all fixed, none high): the publish id is written to the row again on a
  resumed run; the one fresh upload drops the failed upload's id first; an authorization removal
  is one transaction; a refresh refused for our configuration (`invalid_client`) fails the post as
  `internal_error`, never as TikTok refusing it; acknowledging failures and the settings outcome
  line follow the switches; each mark says its platform to screen readers where nothing visible
  does; an expired account dims its picture and name, never the mark; a TikTok post on its way reads
  «בשליחה לטיקטוק…» (DRAFT), not «מתפרסם…».

## Answered by the live run (2026-10-17, [[tiktok-inbox-live-run-2026-10-17]])

- TikTok's inbox **accepts a הוק + דמו file** with no audio stream (MEASURED: a `steps` post
  `delivered`); §8.5's stop did not fire.
- The sandbox **has its own client key and secret** and **its own URL-properties list**, which needed
  its own domain verification (FOUNDER-REPORTED; the first post failed with `url_ownership_unverified`,
  MEASURED).
- The webhook field: t4 passed by the founder's report; the rows cannot tell the webhook from the poll.
- Checks t1 to t6 passed (FOUNDER-REPORTED). The rows show no Service B post and no
  `connection_expired` post or email, so check t3 as worded and the waiting-post half of t5 left no row.

## Still open

- Whether the player URL opens the sandbox's public post (t7) — his look; the link exists.
- The audit itself, and the sandbox → production swap (docs/09 §Runbook).

## Related

- [[0101-tavnit-schedules-and-posts-to-instagram-and-tiktok]] — decision 4, now built.
- [[0063-auth-custom-domain]] — the host TikTok pulls from.
- [[0107-social-posting-pr3-tick-landing-line-failure-email]] — the failure email, §3 amended.
- [[0108-social-posting-four-ui-fixes-after-pr3]] — the tag, §1 now per platform.

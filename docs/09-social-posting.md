# 09 — Social posting: schedule a finished video, post it once

Decision [`0101`](vault/decisions/0101-tavnit-schedules-and-posts-to-instagram-and-tiktok.md)
(founder, 2026-10-10). Wherever a customer watches a finished render, a schedule button sits beside
הורדה; at the chosen time Tavnit publishes the video to the customer's Instagram as a Reel with a
caption and a Meta-catalogue sound, or sends it to their TikTok inbox, where the owner adds the
sound and the caption and posts it in the app. A post never goes out twice and never after it was
cancelled. Each platform sits behind its own switch until its own review passes — Meta's for
Instagram, TikTok's audit for TikTok (decision
[`0115`](vault/decisions/0115-tiktok-inbox-posting-pr4.md) §5).

What this doc covers: the data model, the life of a post, the publish job's checkpoints, the
failure kinds the customer reads, the switches, the env names, TikTok (§TikTok), and three runbooks —
the Meta app's settings, Meta's review and verification, the TikTok app. Code:
`packages/core/src/pipelines/social.ts`, `providers/meta-graph.ts`, `providers/tiktok.ts`,
`secret-box.ts`; migrations 0057–0060, 0064–0065.

**Built so far.** PR 1 (core, merged as #89): schema, the Meta wrapper, the pipeline, the publish
job, the daily token check, the deletion path. PR 2 (connect, `feat/social-posting-connect`):
decision 0102's changes to the core (the AI label per post — migration 0060, the mix per service,
the switch's `named` setting), the חיבורים section in `/home/settings`, the Instagram pre-screen,
the Facebook round trip, disconnect, Meta's deletion callback and its status page (§Connecting an
account). Then (decision [`0105`](vault/decisions/0105-instagram-stays-on-facebook-login-one-window-setup-behind-a-switch.md),
`feat/instagram-onboarding-connect`): Meta's one-window setup behind its own SQL switch, a
30-minute window, and a line of its own for every way back from Facebook (§The connect mode). After
the live run (decision [`0106`](vault/decisions/0106-instagram-connect-stays-on-todays-flow-with-a-page-first.md),
`feat/instagram-connect-page-steps`): customers stay on today's connect, and the pre-screen tells
them to link a Page first; the one-window switch stays off. PR 3 (`feat/social-posting-schedule`,
decision [`0107`](vault/decisions/0107-social-posting-pr3-tick-landing-line-failure-email.md)): the
player button, the tag, the schedule flow, the sound picker, the calendar and the post page, the
`/home` notice, and the failure email (§The schedule flow and the calendar, §The failure email).
Four UI fixes after it (`fix/social-posting-ui`, decision
[`0108`](vault/decisions/0108-social-posting-four-ui-fixes-after-pr3.md)): the "פורסם" tag, the
schedule button's colours, Tavnit's own date and time pickers, and the Instagram-only sound rows.
PR 4 (`feat/tiktok-inbox-posting`, decision
[`0115`](vault/decisions/0115-tiktok-inbox-posting-pr4.md)): TikTok — the connect, the inbox
delivery by `PULL_FROM_URL`, the webhook, a switch of its own, and the tile's tags per platform
(§TikTok). PR 4.1 (`feat/tiktok-delivery-email`, decision
[`0116`](vault/decisions/0116-tiktok-delivery-email-and-the-door.md)): the delivery email when a
TikTok video reaches the owner's inbox, the one inbox path printed everywhere, a sentence on the
TikTok-only time step, and every environment string trimmed (§The delivery email, §TikTok).
Everything a customer could reach is behind a switch.

## Data model (0057–0060, 0064–0065)

PR 4 added `social_accounts.access_token_expires_at` (TikTok's 24-h access token's end, 0065),
`scheduled_posts.delivered_at` (0065) and the status `delivered` (0064, alone in its file — TikTok
only: the video is in the owner's TikTok and waits for them to post it). TikTok uses the columns 0058
already named for it: `refresh_token_enc` + `refresh_expires_at`, `provider_container_id` = the
publish id, `provider_media_id` = TikTok's post id (kept as text: 19 digits overflow a JS number).

| table             | one row per                                                                           | notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `social_accounts` | connected platform account, owned by the **Tavnit account** (`users`), not a business | `external_id` = IG user id / TikTok open_id; `page_id`/`page_name`/`fb_user_id` (Instagram); `access_token_enc` = the **Page token** (Meta: no expiry) or TikTok's 24-h access token; `user_token_enc` = the ~60-day User token the sound search is documented against; `status` connected / expired / disconnected / deleted; one LIVE row per account (`social_accounts_live_idx`, partial unique on connected+expired)                                                                                                                                                               |
| `scheduled_posts` | video × account                                                                       | `scheduled_at` (the instant) + `timezone` (display); `caption`, `sound` (a jsonb snapshot of the picked catalogue row, Instagram only), `ai_label` (the customer's "made with AI" tick, false by default — 0060, decision 0102); `status` scheduled / publishing / delivered (TikTok only, 0064) / posted / failed / cancelled; `provider_container_id`, `provider_media_id`, `permalink`; `failure_kind` (closed set below), `failure_detail` (diagnostic, never shown), `failure_acknowledged_at`; `deferred_until` while waiting out Instagram's quota or TikTok's pending-share cap |

Both are **server-only**: RLS on, no policies, read through `getDb()` with an explicit `user_id`
filter in every route, exactly like `feedback`. The project exposes no new table to the Data API
by default (docs/08 §6A), so nothing else is needed.

**Tokens at rest.** `secret-box.ts`: AES-256-GCM under `SOCIAL_TOKEN_KEY` (32 bytes, base64),
AAD `social_accounts:<user_id>:<platform>:<external_id>`, wire format `v1.<iv>.<tag>.<ct>`.
Opened only on the worker (the publish job, the daily check) and in the web's OAuth and sound
routes. Disconnect and deletion null every `*_enc` column and keep the row. Every call made with
a token carries it in the `Authorization` header with `appsecret_proof` beside it, never in a URL;
the one exception is Meta's documented `GET /oauth/access_token`, whose client secret, code and
short-lived token ride the query string, which is why the wrapper logs the path and status only
and never the URL. Meta's own error text is scrubbed of signed URLs before it is kept anywhere.

## The life of a post

```
schedulePosts ─▶ scheduled ──(job post:<id>, run_at = scheduled_at)──▶ publishing ─▶ posted
                    │  edit / cancel allowed only here                      │
                    └──▶ cancelled                                           └──▶ failed (+ events post_failed)

TikTok:                                     publishing ─▶ delivered ─▶ posted
                                                │   (in the owner's     (TikTok: the owner
                                                │    TikTok)             posted it)
                                                └──▶ failed
```

- **Scheduling** (`schedulePosts`): the guards, then one transaction that locks the account rows
  (`FOR UPDATE`, so two schedule calls for one account serialise against the cap), writes N rows
  and N jobs under `post:<id>` with `run_at` = the instant. The queue's own `run_at` carries a post
  weeks out — no sweep table. Guards: the render belongs to the user's business (or the user is an
  admin); it is released with a file; the instant is inside the **horizon** — the earlier of 30
  days and `released_at + (retention − 2)` days, the retention in force when it is scheduled
  (`released_renders`, or `watermarked_samples` for a watermarked sample), two days so a day of
  quota deferral plus the poll budget fit before the janitor's delete; caption ≤ 2,200; a sound
  only with an Instagram account; ≤ 45 Tavnit posts per Instagram account within a day either side
  of the instant (Meta's reference pages say 50 a day, its guide 100; the job reads the account's
  live quota at post time regardless). A time change meets the same cap. TikTok (0115): caption,
  sound and the AI tick are Instagram's — a TikTok row is written with no caption, no sound and no
  tick whatever the request says; ≤ 5 TikTok posts per account within a day either side that are
  `scheduled`, `publishing` or `delivered` (TikTok's "5 pending shares within any 24-hour period";
  a posted one is no longer pending), refused as `tiktok_pending_cap` (429). An account outside the
  caller's switches is `not_found`.
- **Change / cancel** until posting starts. The load-bearing guard is the post row's
  `status = 'scheduled'`: the job's first act after a claim is the guarded move to `publishing`,
  so `scheduled` means "not started". A time change also moves the job's `run_at` guarded on
  `jobs.status = 'queued'` — that second guard only closes the instant between a claim and the
  first act (`reschedule` returns a polling job to `queued`, so it is not a "not started" signal
  on its own). Zero rows on either → `not_pending` and the transaction rolls back. A cancel leaves
  the job: it sees the cancelled row and completes as a no-op (the render handlers' resurrection
  guard). A post waiting out Instagram's quota is `publishing` with no container yet — nothing
  has reached Meta — so it can still be cancelled, though not edited.
- **Disconnect** erases every token, keeps the row, cancels the account's scheduled posts and
  returns the count. No Facebook permission is revoked (per app per Facebook user; one account
  must not disconnect the others).

## The publish job (`publish_post`, light lane)

1. Load the post; status ∉ {scheduled, publishing} → done.
2. `scheduled` → guarded `UPDATE … SET status='publishing' WHERE status='scheduled' RETURNING *`;
   zero rows → done (lost the race to a cancel). What the lock returned is what is published.
3. **A media id in the job's state → the Reel is live**: finish the row write and stop, before any
   other guard — an account that lapsed since must not turn a live post into a failure.
4. Account not `connected` → `connection_expired`. No container yet → the render must still have
   its file (`file_missing` otherwise); `GET /{ig}/content_publishing_limit`; at the cap →
   **defer**: `reschedule` 60 min, status stays `publishing`, `deferred_until` set; after 24 h →
   `quota_exhausted`.
5. Then mint a 1-hour signed URL, `POST /{ig}/media` (REELS, caption, `share_to_feed=true`,
   `is_ai_generated=true` **only when the post's own `ai_label` is ticked** — no label field at all
   otherwise (0102) — and `audio_configuration` when a sound was picked, at the service's mix
   (0102, `SOUND_VOLUMES`): הוק + דמו `audio 100 / video 0` (the render is silent), דמות AI
   `audio 15 / video 100` (the voice on top; a retired full-format A render takes this one too, for
   its voiceover), גוש טקסט `audio 100 / video 40` (the sound leads, the clip's own sound under it))
   → **checkpoint `{containerId}` before anything else**.
6. `GET /{container}?fields=status_code,status`: `IN_PROGRESS` → `reschedule` 60 s, fail
   `platform_timeout` on the 30th read (counted in polls, not wall-clock — Tavnit's budget for a
   Reel, over Meta's five-minute suggestion); `ERROR` → `sound_unavailable` when the subcode text
   names the audio (provisional: Meta puts a bare subcode in `status` and documents no
   audio-specific one — the live test records what a withdrawn sound returns), else
   `platform_refused`; `EXPIRED` (never published — Meta discards an unpublished container after
   24 h) → one fresh container, a second expiry → `platform_timeout`; **`PUBLISHED` → posted
   without calling publish** (a previous attempt's publish landed; Meta documents no way to recover
   the media id, so the row shows posted with no link); `FINISHED` → checkpoint
   `publishAttemptedAt`, `POST /{ig}/media_publish` — a transient failure there (the request may
   have landed) reschedules to **re-read the container** rather than fail, up to 5 tries — then
   **checkpoint `mediaId` the instant it returns**, permalink best-effort, posted.
7. Errors: transient → the queue's backoff with state kept; a `PostFailure` or a Meta refusal →
   failed now (`connection_expired` when the token lapsed, and the account goes `expired`); a
   missing storage object → `file_missing`; a sealed-key or credential fault → `internal_error`
   on the first attempt; the last transient attempt → `platform_timeout`, except that after a
   publish attempt the container is read once first and `PUBLISHED` wins. Every terminal failure
   writes one `events` row of kind `post_failed` (post id, platform, kind, the first 200 characters
   of the diagnostic — no customer text) that the worker's alert sweep reports to Sentry (0059
   rebuilt the partial index).
8. **The orphan sweep** (`failOrphanedPosts`, run by the reaper every ~60 s and by the daily
   check): a scheduled or publishing post whose job is dead or failed — the lease sweep's `dead`
   on a last attempt runs no handler code, nor does a box on an older build — is ended: posted
   when its state carries a media id or the container reads `PUBLISHED`, failed as
   `platform_timeout` otherwise, with the job's last error as the detail.

**Why never twice**: `media_publish` is reached only from `FINISHED` and only without a
`mediaId` in state; the step before it is a checkpoint, so a crash mid-call resumes by reading
the container, and `PUBLISHED` short-circuits. A lease reclaim replays the same path with the same
state. `SKIP LOCKED` keeps two workers off one job. `test/social-publish.test.ts` replays every
checkpoint and asserts one container and one publish each time.

**Daily** (`check_social_tokens:<day>`, beside `janitor` and `billing_renewals`): one
`GET /{ig}?fields=id,username,name,profile_picture_url` per connected account — a lapse (code
190, whose subcodes include 492 for a lost Page role; 102; 200–299) marks it `expired` so
Integrations says so before a post fails; a good answer refreshes the name and picture
(Instagram's picture links expire). The same job runs the orphan sweep.

**Meta's deletion callback** (`processMetaDataDeletion`): by `fb_user_id` — tokens and identity
fields erased, rows kept as `deleted`, pending posts cancelled, an `events` row of kind
`meta_data_deletion` holds the confirmation code the status page answers to.

## What the customer reads

| `failure_kind`        | line                                                                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connection_expired`  | החיבור לחשבון פג. התחברו מחדש בהגדרות ותזמנו שוב.                                                                                                                                                                   |
| `sound_unavailable`   | הסאונד שנבחר כבר לא זמין באינסטגרם. תזמנו שוב עם סאונד אחר.                                                                                                                                                         |
| `platform_refused`    | {platform} לא קיבלה את הסרטון. אפשר להוריד אותו ולפרסם ידנית.                                                                                                                                                       |
| `platform_timeout`    | {platform} לא סיימה לעבד את הסרטון בזמן. נסו לתזמן שוב.                                                                                                                                                             |
| `quota_exhausted`     | החשבון עבר את מכסת הפרסומים היומית של אינסטגרם במשך יממה. תזמנו שוב. TikTok (FINAL, PR 4): טיקטוק לא קיבלה את הסרטון במשך יממה, כי סרטונים קודמים שנשלחו עוד מחכים שתסיימו אותם. מסיימים אותם בטיקטוק ומתזמנים שוב. |
| `removed_on_platform` | הסרטון הוסר בטיקטוק לפני שפורסם.                                                                                                                                                                                    |
| `file_missing`        | קובץ הסרטון כבר לא שמור אצלנו.                                                                                                                                                                                      |
| `internal_error`      | תקלה אצלנו מנעה את הפרסום. נסו לתזמן שוב.                                                                                                                                                                           |

The lines ship with the web PR; `SOCIAL_FAILURE_KINDS` is the closed set they map. The row's
`failure_detail` is the diagnostic and never leaves the server: `toPostView` strips it (and the
container id) from everything a page reads, the way `toView` strips tokens from an account.

## The failure email (decision 0107)

A post that fails for good is told twice: in the app (the `/home` notice and the calendar, from the
post row) and by email to the Tavnit account's address, because the point of scheduling is not
opening the app. The email is the worker's, never the publish job's: an email problem cannot fail,
delay or retry a post, and the in-app notice is the same either way.

- **Where:** `sweepFailureEmails` in `apps/worker/src/index.ts`, every 60 s beside the alert sweep,
  one tick at a time; the rules in `pipelines/social-failure-email.ts`; the one Resend wrapper in
  `providers/resend.ts` (plain `fetch` to `POST https://api.resend.com/emails`, 10 s timeout; the
  status and Resend's error name logged, never the address, the subject or the body). `aiugc work
--once` and the web apps never run it.
- **Sender:** `תבנית <noreply@tavnit.ai>`, a constant — the auth mail's own (docs/08 §8A.2).
- **Off:** no `RESEND_API_KEY` (or an empty line), `DRY_RUN`, or a `local`/`cli` worker id against
  production (the guard `claim` uses) → no call and no row. The startup line says which, from the
  sweep's own checks (`failureEmailState`):
  `journalctl -u aiugc-worker -o cat | grep '"failure email"'` → `"failureEmail":"on"`,
  `"no_provider"` or `"local_worker"`.
- **A cause** is (Tavnit account, platform, `failure_kind`) — the platform since PR 4 (0115 §9,
  amending 0107 §3, so an email never names Instagram for a TikTok failure; an email row logged
  before PR 4 carries no platform and counts as Instagram's). One email per cause per **24 h**; a failure of
  the same cause in the 24 h after an email is folded — never emailed, on the calendar and in the
  notice. A cause goes out once its newest failure is **2 minutes** old, so posts that fail together
  share one email. Only failures from the last **24 h** are emailed.
- **The ceiling:** **20** emails per UTC day, **failure and delivery emails together** (0116;
  Resend's day resets at 00:00 UTC), leaving 80
  of the free plan's 100 a day for the sign-up and password mail. Over it, a failure still under
  24 h old goes out after midnight UTC; older ones never. `daily_quota_exceeded` from Resend pauses
  the sweep until 00:00 UTC; a network fault, a 5xx, a per-second 429 or a body that stalls pauses
  it 5 minutes; a **401 or 403** (the key is wrong, revoked or held to another domain, or the domain
  is unverified) pauses it an hour and writes **no** row — the account's fault, not the cause's, so
  the failures still go out once it is fixed, while under 24 h old.
- **Never twice:** the send carries `Idempotency-Key: post-failure/<user>/<kind>/<oldest due post
id>` — a key that does not move while the burst grows — and the log row is written after the send,
  so a retry after an ambiguous send or a failed log write is deduplicated by Resend (24 h). Resend's
  409 `invalid_idempotent_request` (the key seen with a longer list) counts as sent. A refusal of the
  message itself (a 400 or 422, a bad address) is logged and not retried.
- **The log** is `events` rows of kind `post_failure_email`: `actor_user_id` = the account, payload
  `{failureKind, platform, postIds, outcome: sent | refused, resendId | error}` — no address, no
  caption, no diagnostic. Not an alert kind, so it never reaches Sentry. No migration.
- **A hidden platform** gets no email: the sweep asks the post's own platform's switch.
- **What it says** (`social-copy.ts` `failureEmail`, DRAFT): subject «פרסום שתוזמן בתבנית נכשל» /
  «{n} פרסומים שתוזמנו בתבנית נכשלו»; which posts (the service, the business, the account, the
  planned time in the post's own zone; ten listed, the rest counted); the failure-kind line above as
  the reason and what to do — in the plural when the email lists several videos or several accounts
  (`failureEmailReason`); "ללוח הפרסומים" to `https://tavnit.ai/calendar` (no "schedule again" for a
  missing file); a line that the calendar opens after signing in (it is a 404 for anyone signed
  out — the switch's no-trace rule); and a line that more failures of the same cause in the next
  24 h show there without another email.

## The delivery email (PR 4.1, decision 0116)

A TikTok video that reaches the owner's inbox is told to the Tavnit account by email, with the path
to it inside TikTok: the owner is not in Tavnit when it lands, TikTok's own notification is easy to
miss (the founder missed it on the live run, knowing what to look for), and an unfinished video
blocks the next ones (TikTok takes five a day per account). Built as the failure email's sibling, in
`pipelines/social-delivery-email.ts`, and sharing its machinery (`social-failure-email.ts`:
`emailSweepGate`, `emailsSentToday`, `sendPostEmail`) — so the sender, the off states, the pause and
the Resend error ladder above are the same, and the worker's one 60 s tick runs the failure sweep
first, then this one, each in its own try.

- **Due:** a post with `platform = 'tiktok'` still `delivered` (a video the owner already posted
  needs no reminder), with `delivered_at` in the last **24 h**, that no earlier delivery email lists.
  `delivered_at` is written once, by the one guarded `publishing → delivered` writer that the
  webhook, the job's poll and the nets all share, so a post is due once whichever moved it. A post
  that went straight to `posted` never was `delivered` and gets none.
- **One per post, folded per sweep:** every due post of a Tavnit account goes in **one** email, oldest
  first (ten listed, the rest counted). **No 24 h cooldown** — a failure email folds a day of one
  cause; here every video is told. A batch goes out once its newest post was delivered **2 minutes**
  ago (`DELIVERY_EMAIL_QUIET_MS`, the failure email's settle time), so the email arrives about 2–3
  minutes after the video lands and videos that land together share it.
- **Never twice:** a post is told once — the log below is what is read (a `refused` row counts too);
  the send carries `Idempotency-Key: post-delivery/<user>/<oldest due post id>`, so a crash between
  the send and the log write is deduplicated by Resend (24 h), and a 409 `invalid_idempotent_request`
  counts as sent.
- **The switch:** the TikTok switch is asked at send time (`getPlatformAccess`); an account it no
  longer includes gets no email and no row. Instagram's switch is irrelevant.
- **The ceiling:** the failure email's **20 a UTC day, counted over both kinds**. Failure emails are
  swept first each tick; a held video goes out after midnight UTC while it is still unfinished and
  under 24 h old. No reserve for failures is built: a day of deliveries can use the slots a late
  failure would need.
- **The log** is `events` rows of kind `post_delivery_email`: `actor_user_id` = the account, payload
  `{platform, postIds, outcome: sent | refused, resendId | error}` — no address, no caption. Not an
  alert kind. **No migration** (`events.kind` is text).
- **What it says** (`social-copy.ts` `deliveryEmail`, DRAFT): subject «הסרטון שלכם מחכה לכם בטיקטוק» /
  «{n} סרטונים מחכים לכם בטיקטוק»; the video's line — a render has no title, so it is the failure
  email's «סרטון {service} של {business} · {account} בטיקטוק · {planned time}»; the **three-step
  path** numbered, then «שם מוסיפים סאונד וכיתוב ומפרסמים.»; one line that unfinished videos block
  new ones; a link — one video: its page, `https://tavnit.ai/calendar/<postId>` («לפרסום»); several:
  the calendar («ללוח הפרסומים»); and a line that the page opens after signing in (`/calendar/<id>`
  is a 404 for a signed-out visitor or another account, the switch's no-trace rule).
- **No "טיוטה":** no Hebrew line says it (the founder's PR 4 change 1, pinned by a test); the copy
  says «סרטון».

## The switches

Two keys since PR 4 (decision 0115 §5), independent — Meta's review and TikTok's audit clear on
different days: **`app_config.social_posting` is Instagram's switch** (it was the one switch; the key
kept its name) and **`app_config.tiktok_posting` is TikTok's**. Same three settings, same rules, an
absent row admins only for each. `getPlatformAccess(db, userId)` answers both at once;
`getPostingAccess` means "any platform" and opens the shared surfaces (the calendar, the schedule
page, the `/home` notice, the nav, the shared post routes), while every read under them is filtered
to the platforms the account's switches allow — a platform's card, accounts, posts, chips, counts
and failure emails never reach an account its switch hides. Each platform's own routes (its connect,
Instagram's sounds and pre-screen) open on its own switch alone. `instagram_connect` stays nested
under Instagram's.

`app_config.social_posting` (and, the same way, `tiktok_posting`) has three settings (decision 0102):

| value                                        | who sees the feature                                    |
| -------------------------------------------- | ------------------------------------------------------- |
| `{"access":"admins"}` — also an absent row   | admins only                                             |
| `{"access":"named","userIds":["<uuid>", …]}` | admins, plus the listed accounts (Meta's reviewer, say) |
| `{"access":"everyone"}`                      | every signed-in account                                 |

`getPlatformAccess(db, userId)` answers each platform: an admin always, else per that platform's key.
**A value that does not parse hides that platform** (admins still see it) — a typo must not turn a
customer's 404 into an error page. `getPostingAccess` answers `allowed` when any platform does; the
shared pages and routes check it (and filter what they show by platform), each platform's own routes
check that platform, and a hidden account gets a 404; with no platform allowed, the settings page
renders no Integrations section. The one exception is Meta's
data-deletion callback and its status page, which Meta calls, not a customer. Each change is one
statement in the SQL editor, no deploy.

Name an account (by its email; the row stores the id, which never changes):

```sql
insert into app_config (key, value)
select 'social_posting', jsonb_build_object('access', 'named', 'userIds', jsonb_agg(id))
  from users where email in ('reviewer@example.com')
on conflict (key) do update set value = excluded.value, updated_at = now();
```

Read it back: `select value from app_config where key = 'social_posting';` — the ids should be
one per email you named. Open it to everyone after Meta's approval:

```sql
insert into app_config (key, value) values ('social_posting', '{"access":"everyone"}'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();
```

TikTok's, the same statements under its own key — an admin needs none (an absent row already lets
admins in). Name an account for the sandbox or TikTok's reviewer:

```sql
insert into app_config (key, value)
select 'tiktok_posting', jsonb_build_object('access', 'named', 'userIds', jsonb_agg(id))
  from users where email in ('someone@example.com')
on conflict (key) do update set value = excluded.value, updated_at = now();
```

Read it back with `select value from app_config where key = 'tiktok_posting';`. Open it to everyone
after TikTok's audit passes (and the production pair is in, §Runbook: the TikTok app):

```sql
insert into app_config (key, value) values ('tiktok_posting', '{"access":"everyone"}'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();
```

## The schedule flow and the calendar (PR 3)

The approved plan's §8 and Appendix A, with 0102 and 0107. Every line a customer reads is in
`apps/web/src/lib/social-posting-ui.ts` (the new ones marked DRAFT); the failure lines and the email
are core's `social-copy.ts`, because the worker writes the email.

| surface                                                                                 | what it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RenderPlayer` (five mounts: the strip and library modals, the A, B and C finish steps) | "תזמון פרסום" beside הורדה, one row, two columns — white at rest, light grey on hover, ink text in both (`WHITE_BUTTON_CLASS`, 0108 §2) — and "מתוזמן לפרסום" / "מתוזמן ל־{n} פרסומים" under it. Fed by `GET /api/renders/[id]`'s `scheduleHref` and `pendingPosts`, which the route sends only for a released render with a file **and** an account the switch allows — absent, the player is what it was.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `RenderTile` (strip and all-videos page)                                                | The tags beside the status, one per platform with the platform's official mark, Instagram first (0108 §1, per platform since 0115 §3): grey "מתוזמן" while any of that platform's posts is `scheduled` or `publishing`; else TikTok's "נשלח לטיקטוק" while any of its posts is `delivered` (an unfinished draft outranks a posted one), else green "פורסם" once one is `posted`; nothing for failed or cancelled posts alone. The list route's `postTags`, from one grouped query by video and platform (`postCountsByRender`, `apps/web/src/lib/social.ts`) over the platforms the account's switches allow (the key is absent for an account no switch allows).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `/schedule/[renderId]`                                                                  | A page, not a modal, so the first-time connect has an address to come back to. The caller's own released video (an admin's any), then: **accounts** (multi-select; an expired one cannot be picked; none connected → "עוד אין חשבון מחובר" and "לחיבור חשבון" to `/connect/instagram?return=/schedule/<id>`) → **when** (two fields, each one button that opens its picker — a month in Tavnit's look with the days outside the range greyed and unpickable, and a 24-hour list in 5-minute steps; the same on phone and desktop, and from the keyboard, 0108 §3–4; the browser's zone, "עכשיו", the horizon checked before asking — 30 days, or the file's last day when that is sooner, worded with that date) → **caption, sound and the AI tick** (the tick last, small, muted, unticked) — **only when an Instagram account is picked** (0115 §2): with TikTok alone the flow submits from "מתי?", and whenever TikTok is picked the last step says the video goes to TikTok and is finished there by the inbox path (§TikTok); with TikTok alone the time step also says what the time is for (0116) → **"תבנית ממשיכה מכאן"**, its line per the mix. Each account shows its platform's mark; the lists follow the switches, and the no-account card links to Instagram's pre-screen, TikTok's connect, or חיבורים when both are open. `?from=<postId>` is a failed post's "תזמון מחדש": the account, caption, sound and tick carried forward. |
| the sound picker                                                                        | `GET /api/social/instagram/sounds?accountId&kind&q&after` → core's `searchInstagramSounds` → Meta's `ig_audio` with the account's **User** token (one kind per call: `original_sound` = סאונדים מרילס, `music` = מוזיקה). Trending while the search is empty; "עוד תוצאות" per group while Meta pages; ▶ plays a file in place; a row whose only link is Instagram's own page (`on_platform_audio_preview_link`, no `download_url`) keeps its place, and its button reads "האזנה באינסטגרם" and opens that page in a new tab (0108 §5); `reconnect` when the User token is gone, past its ~60 days or refused as lapsed — the post then goes without a sound. Under the list, the note with "הורדת הסרטון". The mix line follows `SOUND_VOLUMES`, with its own line for גוש טקסט.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `/calendar?month=YYYY-MM`                                                               | A Sunday-first month grid, right to left, the whole Tavnit account across its businesses; chips with the account's picture, the platform's mark and the time, grey while waiting, TikTok's own colour while `delivered` ("נשלח לטיקטוק" — the drafts the owner never finished, the reason the webhooks exist, 0115 §4), green once posted, red when failed; cancelled posts are not on it; "+N" past three a day. Below md, dots, and the chosen day's list under the grid. The month is the browser's: the page fetches `GET /api/social/posts?from&to` (at most 45 days) a day wider on each side.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `/calendar/[postId]`                                                                    | The account, the time, the caption, the sound, the video. While `scheduled`: the edit form (`PATCH /api/social/posts/[id]`, only the fields that changed) and "ביטול הפרסום" behind a confirm. A quota wait (`publishing`, no container yet) can be cancelled, not edited. Once posting started: «הפרסום כבר התחיל ואי אפשר לשנות אותו.» (409). Failed: the failure line, "תזמון מחדש", הורדה. Posted: "צפייה בפוסט" when Meta gave a permalink. A TikTok post shows no caption, sound or tick (only its time can change); delivered, it gives the path to the video inside TikTok (§TikTok); posted and public, "צפייה בפוסט" opens TikTok's player URL (§TikTok).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `/home`                                                                                 | The notice above the recent videos: «פרסום אחד נכשל» / «{n} פרסומים נכשלו» with "ללוח הפרסומים" and "הבנתי" (`POST /api/social/posts/acknowledge-failures`), and one line per expired account with posts waiting.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| the nav                                                                                 | "לוח פרסומים" in the desktop sidebar and in the account menu (below md the menu is the whole nav), only for an allowed account.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

**Why `/schedule` and `/calendar` are not under `/home`.** Every segment under `/home` sits inside the
Suspense boundary `/home/loading.tsx` opens, and a `notFound()` inside it streams the 404 page into a
response already sent as 200 — a trace (PR 2's reason for `/connect/instagram`). The two pages live
in the `app/(posting)` route group, whose layout checks the session and the switch before any
boundary and then draws the `/home` frame itself (`HomeLayout`). A hidden account and a signed-out
visitor get a real 404 status and the 404 screen, never a redirect to `/start`. **Known limit**
(found by PR 3's review, and true of `/connect/instagram` since PR 2): Next renders that 404 from the
matched route tree, so the raw HTML's RSC data names `(posting)`, `calendar` or `schedule` where an
unknown path's names `/_not-found` — a trace for someone reading the source, not for a customer; a
middleware rewrite would close it, at the cost of the switch read at the edge. The
connect's return address accepts `/schedule/<id>` and `/calendar[/<id>]` beside `/home…` and nothing
else (`socialReturnPath`).

**The refusals** (`SocialSchedulingError`, mapped by type in `api-errors.ts`): 404 for a post,
account or video that is not the caller's (or on a platform its switches hide); 409 for
`not_pending`; 429 for Instagram's daily cap and TikTok's pending cap; 422 for the rest, each with
its own line (`socialErrorLine`).

**Read on Meta's own pages 2026-10-12** (each load-bearing line re-fetched by an independent refuter):

- **A Reel with no audio stream:** not stated. The Reels spec on the IG User Media reference gives
  "Audio codec: AAC, 48khz sample rate maximum, 1 or 2 channels" and "Audio bitrate: 128kbps", and
  says neither "required" nor "optional"; no error code names a missing audio stream (the nearest,
  2207026, is "Unsupported video format"). The first live הוק + דמו post settles it (0107 §5).
- **The audio search's token:** the Audio API page asks for "A valid User access token"
  (`instagram_basic`, `instagram_content_publish`, granted through Facebook Login) and says nothing
  of a Page token. Whether the Page token serves it too is a live reading (checklist (w)).
- **`audio_configuration`:** `audio_id` required; `audio_volume` and `video_volume` optional,
  default 100 — one refuter read `audio_volume` as 1–100 in the raw page (the rendered text says
  0–100); `SOUND_VOLUMES` uses 100 and 15 for it, inside both. "Previewing a Reel with attached audio
  is not supported."
- **Page Publishing Authorization:** "An Instagram professional account connected to a Page that
  requires Page Publishing Authorization (PPA) cannot be published to until PPA has been completed";
  the container request fails ("PPA must be completed or the request will fail"); "there's no way for
  you to determine if an app user's Page requires PPA". **Meta documents no error code for it.** It
  arrives as a refusal of `POST /{ig}/media` and gets today's `platform_refused` line («אינסטגרם לא
  קיבלה את הסרטון…»); a line of its own waits for the live error's code.
- **Labelling AI video:** Meta's Community Standards (Misinformation) "require people to disclose,
  using our AI-disclosure tool, whenever they post organic content with photorealistic video or
  realistic-sounding audio that was digitally created or altered, and we may apply penalties if they
  fail to do so"; `is_ai_generated` is documented as "An optional parameter to provide a
  self-disclosure of AI usage in the post" (changelog 2026-06-22, "AI Info Label"). Whether the API
  flag counts as the in-app disclosure tool, and whether Reels honour it, is not stated. The tick's
  hint is one muted line of that rule.

URLs: `developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media`,
`…/content-publishing/`, `…/content-publishing/audio-api/`, `…/instagram-graph-api/reference/error-codes`,
`…/instagram-platform/changelog`, `transparency.meta.com/policies/community-standards/misinformation/`.

## Connecting an account (PR 2)

| surface                                     | what it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/home/settings` → **חיבורים**              | Rendered only for an allowed account. One Instagram card: each connected account with its picture, name and @handle, מחובר / פג תוקף — התחברו מחדש, ניתוק behind a confirm that counts the posts it will cancel; חיבור חשבון / הוספת חשבון lead to the pre-screen. `?social=connected\|none\|expired\|mismatch\|cancelled\|error` (with `n`, `id`) is the round trip's outcome line — each says what happened and what to do, `none`'s advice following the connect mode; `?return=` is carried through. A TikTok card after it (PR 4, 0115), each card under its own switch.                                                                                                                                                                                                                                 |
| `/connect/instagram?return=&add=1`          | Tavnit's pre-screen (what Instagram needs, what Tavnit asks for — its lines follow the connect mode and, in today's mode, `add`), then המשך → the start route. **Outside `/home` on purpose:** every `/home` segment sits inside its `loading.tsx` Suspense boundary, where a `notFound()` streams into a response already sent as 200 — here a hidden or signed-out account gets a real 404, the same page an unknown path gets.                                                                                                                                                                                                                                                                                                                                                                             |
| `GET /api/social/instagram/start`           | Writes `aiugc.social_oauth` (HttpOnly, SameSite=Lax, path `/api/social/instagram`, kept 24 h by the browser: a random state, the session's user id, the return path, the issue time) and redirects to `https://www.facebook.com/v26.0/dialog/oauth`. Today's mode: `config_id` when `META_LOGIN_CONFIG_ID` is set (it is not, in Production — founder, 2026-10-12), else the five-permission `scope`; `auth_type=rerequest` for הוספת חשבון. The one-window mode: §The connect mode. DRY_RUN skips Facebook and lands on the callback with a stub code.                                                                                                                                                                                                                                                       |
| `GET /api/social/instagram/callback`        | In order, before any exchange: a return with no code, state or error (what Meta's fragment return looks like from a server) → `error`; `error=access_denied` → `cancelled`, any other `error=` → `error`; a state it did not issue, issued to another session, or no cookie → `mismatch`; issued more than **30 minutes** ago → `expired`. Otherwise code → short-lived → long-lived User token → `me` → every Page with an Instagram professional account, all upserted in one go (`upsertInstagramConnections`, both tokens sealed; an account already live keeps its row), then the return address, or settings with the count. Zero accounts → `none`. Each refusal logs its own reason. The cookie is cleared on every outcome, and every address it sends the browser to carries a fragment of its own. |
| `POST /api/social/accounts/[id]/disconnect` | `disconnectSocialAccount`: tokens erased, the row kept, every post it can still call back cancelled — `scheduled`, or `publishing` while waiting out Instagram's quota with no container (`cancellablePost`, the same predicate the confirm counts and manual cancel uses) — and the count answered.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `POST /api/social/meta/data-deletion`       | Meta's callback, outside the switch and without a session. 400 and nothing touched unless `signed_request` verifies (HMAC-SHA256 over the encoded payload, the app secret); then `processMetaDataDeletion` — every row of that Facebook user, **disconnected ones included**, loses tokens and identity fields and becomes `deleted`, posts cancelled — and `{url, confirmation_code}` (32 hex digits: Meta documents an alphanumeric code).                                                                                                                                                                                                                                                                                                                                                                  |
| `/social/deletion/[code]`                   | The public status page that url points at (the legal pages' shell, noindex): done, or no such request.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

### The connect mode (0105)

`app_config.instagram_connect` chooses which Facebook window חיבור חשבון and הוספת חשבון open.
The founder flips it in SQL; no deploy either way. **Ruled 2026-10-12 (0106): off in production.**
The one-window setup returned a code but failed with Facebook's generic error for two of three
accounts (runbook J, [the live run](vault/facts/instagram-connect-live-run-2026-10-12.md)); the code stays, so it
can be retried with the insert below.

| value                        | the window                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| absent (the default)         | today's connect, byte for byte (the start-route row above)                                                                                                                                                                                                                                                                                      |
| `"onboarding"`               | Meta's one-window setup — convert to professional, create the Page, link it, approve — sent as Meta's own parameter set (`display=page`, `extras={"setup":{"channel":"IG_API_ONBOARDING"}}`, the five scopes; no `config_id`, no `auth_type`) with **one change: `response_type=code`**, plus `state` and `override_default_response_type=true` |
| anything that does not parse | today's connect — a typo must not break the connect                                                                                                                                                                                                                                                                                             |

Meta documents this mode **only with `response_type=token`**, which returns the tokens in the
address fragment, where page script can read them. Tavnit never builds that return (0105). Whether
Meta's window honours the code here is the live check below (runbook J). The callback is the same
for both modes; the pre-screen and the "no account" line say what the mode's window does.

```sql
-- on
insert into app_config (key, value) values ('instagram_connect', '"onboarding"'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();
-- read back: "onboarding", or no row
select value from app_config where key = 'instagram_connect';
-- off (today's connect)
delete from app_config where key = 'instagram_connect';
```

It is read only after `social_posting`'s gate, so a hidden or signed-out account still gets the
404 everywhere with the mode on.

Known residual (from the branch's adversarial review): every redirect out of the callback carries
its own fragment, but the uniform JSON 404 for a signed-out or hidden session sends no redirect. If
Meta ever answered in the fragment and the return landed without a Tavnit session (another browser,
a lapsed session), the token would stay in that tab's address bar and history. No script runs on a
JSON 404 and PostHog drops fragments, so the hard limit holds; closing it would mean changing the
uniform 404. The live check (q) treats any `#access_token` as exposed.

Every social route answers a hidden **or signed-out** account with the same JSON 404 a missing
resource gets (a 401 would say the route exists); a failed auth read stays 503. Known limit: that
JSON body differs from Next's HTML 404 for a path that does not exist, so a determined prober can
still tell an API route exists — the pages do give the real 404.

**DRY_RUN writes real rows.** A local web runs with `DRY_RUN=1` against the production database
(one Supabase project), so חיבור חשבון there "connects" the stub's חשבון לדוגמה into production
`social_accounts` (it needs `SOCIAL_TOKEN_KEY` to seal its stub tokens). Disconnect it afterwards,
or don't click it.

## Env names (names only)

| name                                        | web (Vercel Production; `apps/web/.env.local` for the local live test)                                         | box (`apps/worker/.env`)                                                                                                                                                            |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `META_APP_ID`                               | yes                                                                                                            | —                                                                                                                                                                                   |
| `META_APP_SECRET`                           | yes (code exchange, `appsecret_proof`, the deletion signature)                                                 | yes (`appsecret_proof`)                                                                                                                                                             |
| `META_LOGIN_CONFIG_ID`                      | only if the app dashboard gives Facebook Login a configuration id instead of a scope list                      | —                                                                                                                                                                                   |
| `SOCIAL_TOKEN_KEY`                          | yes                                                                                                            | yes                                                                                                                                                                                 |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | yes, both (the authorize link, the code exchange, the webhook signature — TikTok signs with the client secret) | yes, both (the refresh, the inbox upload, the status reads, the daily check) — the sandbox pair until TikTok's audit passes, then the production pair, on both sides in one sitting |
| `RESEND_API_KEY`                            | — (the web sends no mail)                                                                                      | yes — a **sending-only** key restricted to `tavnit.ai` (the failure email, 0107); absent = no email                                                                                 |

Admin needs none. Bare values, one line each, and a Vercel change reaches only deployments created
after it (vault `env-values-differ-between-the-box-and-vercel`). **Every string in the shared config
(`packages/core/src/config.ts`) is trimmed at both ends** since PR 4.1 (0116): on 2026-10-17 a Vercel
value began with a newline and TikTok refused `client_key=%0A…`. A leading or trailing space,
newline or CRLF no longer reaches a provider — Meta's, TikTok's, Resend's, Sumit's or the database's —
and a padded `DRY_RUN=1` still reads as on. It does not reach `LOG_LEVEL` (`logger.ts`) or the
`NEXT_PUBLIC_*` values the web reads directly.

**The key is generated once, into a file, and never printed** (decision 0102). The file sits
outside the repo; `wx` refuses to overwrite an existing key, because a new key makes every sealed
token unreadable and every account has to reconnect. In PowerShell on the laptop:

```powershell
node -e "const f=process.argv[1];const fs=require('fs');fs.mkdirSync(require('path').dirname(f),{recursive:true});fs.writeFileSync(f,require('crypto').randomBytes(32).toString('base64'),{flag:'wx'})" "$env:USERPROFILE\aiugc-keys\SOCIAL_TOKEN_KEY.txt"
```

Compare the three places by **fingerprint** (the first 8 hex characters of the value's SHA-256),
never by the value. On the laptop:

```powershell
node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync(process.argv[1],'utf8').trim()).digest('hex').slice(0,8))" "$env:USERPROFILE\aiugc-keys\SOCIAL_TOKEN_KEY.txt"
```

On the box, from the running process (prints a count and the fingerprint, never the value):

```bash
PID=$(systemctl show aiugc-worker -p MainPID --value)
sudo tr '\0' '\n' < /proc/$PID/environ | grep -c '^SOCIAL_TOKEN_KEY='
sudo tr '\0' '\n' < /proc/$PID/environ | sed -n 's/^SOCIAL_TOKEN_KEY=//p' | tr -d '\r\n' | sha256sum | cut -c1-8
```

Keep a copy in a password manager: losing the key means reconnecting every account, nothing worse.

**`RESEND_API_KEY` goes on the box only, and only once the box runs PR 3** (decision 0107). Its
value is never pasted into a chat, a commit or a report.

1. Resend's dashboard → **API Keys** → **Create API Key**: a name such as `worker-failure-email`,
   **Permission: Sending access**, **Domain: tavnit.ai** → Add. Resend shows the key once; copy it.
2. On the box, after PR 3 is on `origin/main`:
   `cd ~/AIUGCBackend && git pull && pnpm install`, then `nano ~/AIUGCBackend/apps/worker/.env` and
   add one line, `RESEND_API_KEY=` followed by the pasted value — one line, no quotes, no spaces.
   Ctrl-O, Enter, Ctrl-X.
3. `sudo systemctl restart aiugc-worker`.
4. Prove the process has it, printing no key (docs/07 §13's way):

```bash
PID=$(systemctl show aiugc-worker -p MainPID --value)
sudo tr '\0' '\n' < /proc/$PID/environ | grep -c '^RESEND_API_KEY=re_'
journalctl -u aiugc-worker -o cat | grep '"failure email"' | tail -1
```

**Works:** `1`, then a line with `"failureEmail":"on"`. `0` or `"no_provider"`: the line did not
reach the process (a typo in the name, a wrapped value, or no restart).

All providers honour `DRY_RUN`: a
dry-run web "connects" a sample account and a dry-run worker "publishes" to nothing.

## Runbook: the Meta app — click by click (read on Meta's pages 2026-10-11)

Everything here is done in Meta's console by the founder; the code assumes it. Read on 2026-10-11 on
Meta's own pages, one reader per gate and an independent refuter re-fetching each load-bearing line.
**MEASURED** = on Meta's page (path given under `developers.facebook.com/docs/` unless a full URL);
**UNVERIFIED** = no Meta page says it — only your dashboard or a live run shows it. Meta documents
two dashboard vintages; where both paths exist both are given.

### A. Which login dialog: a scope list or a configuration id

- MEASURED: a Business-type app gets **Facebook Login for Business** (FLfB) and cannot roll back,
  and the Instagram use case's "API setup with Facebook Login" uses it
  (`facebook-login/facebook-login-for-business`, `development/create-an-app/instagram-use-case`).
- MEASURED: for a User-access-token configuration, `config_id` replaces `scope`; `scope` is still
  accepted but Meta advises against it. Meta's own Instagram onboarding example still sends
  `scope` (`instagram-platform/instagram-api-with-facebook-login/business-login-for-instagram`).
  The code sends `config_id` when `META_LOGIN_CONFIG_ID` is set, the scope list otherwise.

1. Left menu → **Facebook Login for Business → Configurations → Create configuration** (or start
   from a template).
2. Token type **User access token** — not System-user, which needs a portfolio you fully control
   and is a token class this build does not use.
3. Permissions: `business_management`, `instagram_basic`, `instagram_content_publish`,
   `pages_read_engagement`, `pages_show_list`. Assets: Pages and Instagram accounts, if asked.
4. Copy the **Configuration ID** → `META_LOGIN_CONFIG_ID` (web only).

UNVERIFIED: whether a User-token configuration can be made while no portfolio is connected. If the
dashboard refuses, leave `META_LOGIN_CONFIG_ID` unset; the scope list is used.

### B. The links to paste

1. **Redirect URI** — left menu **Facebook Login for Business → Settings → Client OAuth Settings →
   Valid OAuth Redirect URIs**: `https://tavnit.ai/api/social/instagram/callback`, then **Check
   URI**. Keep **Web OAuth Login** on (the server builds the dialog itself), **Strict Mode** on
   (mandatory) and **Enforce HTTPS** on. The match is exact, parameters included, the state value
   excepted. MEASURED (`facebook-login/security`, `business-login-for-instagram`,
   `pages-api/create-an-app`).
   - **For a local live test** add `http://localhost:3000/api/social/instagram/callback` and press
     Check URI. UNVERIFIED whether it is accepted: no Meta page mentions localhost, and Enforce
     HTTPS requires https redirects. If it is refused, the live connect runs on tavnit.ai after
     PR 2 merges (§Live-test checklist).
2. **Data deletion** — **App settings → Basic → User data deletion**: the callback option, **Data
   Deletion Request URL** `https://tavnit.ai/api/social/meta/data-deletion` (https required). The
   FLfB Settings page carries the same field; same value if asked. To test it: remove Tavnit in
   your own Facebook settings → **Apps and websites → Removed → View → Send Request**; the link in
   the answer opens `/social/deletion/<code>`. MEASURED
   (`development/create-an-app/app-dashboard/data-deletion-callback`).
3. **Privacy policy** `https://tavnit.ai/privacy` and **Terms** `https://tavnit.ai/terms` in **App
   settings → Basic**. MEASURED: the privacy URL is required to publish, public and crawlable
   (Platform Terms, `pages-api/create-an-app`), and the privacy policy must explain how to request
   deletion (`data-deletion-callback`) — today's `/privacy` does not mention connected accounts; the
   legal pages are held, so that text is owed.
4. **App ID and App Secret**: App settings → Basic → `META_APP_ID`, `META_APP_SECRET`. Settings →
   Advanced → **Require App Secret** may stay on: every call sends `appsecret_proof`.

### C. Remove `instagram_manage_messages` before review

MEASURED: requesting a permission the app does not use gets the submission refused
(`instagram-platform/app-review`); `instagram_manage_messages` comes from the use case's messaging
set, not its content set (`instagram-use-case`); everything but `public_profile` can be removed
except what a use case requires (`graph-api/overview/access-levels`). The code never requests it
(`INSTAGRAM_SCOPES`, `providers/meta-graph.ts`).

1. Dashboard → **Customize the "Manage messaging and content on Instagram" use case → Permissions
   and features** → `instagram_manage_messages` → **Remove**.
2. If it will not go there: **App Review → Permissions and Features** → its trash-can icon.

UNVERIFIED: whether your dashboard allows it (likely — it is not in the content set).

### D. What "published" and "Ready for testing" mean today

- MEASURED: Business-type apps have no Development/Live modes; access levels alone decide who can
  grant a permission (`development/create-an-app/app-dashboard/app-types`, `development/release`).
- MEASURED: Standard Access permissions can be requested only from people with a role on the app or
  on a portfolio that claimed it; Standard Access is enough only for your own or managed Instagram
  accounts (`graph-api/overview/access-levels`, `instagram-platform/overview`).
- MEASURED: "Ready for testing" = you can test calls that need the permission and complete App
  Review's testing requirements; "Ready for live mode" = approved in App Review
  (`development/create-an-app/facebook-login-use-case`). REASONED: your seven are Standard Access —
  only role users (you) can connect. The refuter's caveat: those definitions sit on a page written
  for apps with a Live mode.
- UNVERIFIED: whether an app published without a verified business stays published. No page says it
  is unpublished; the documented effect is that until it is connected to a verified business, users
  of other businesses cannot grant permissions (`development/release`), and role users need no
  Business Verification (`development/release/business-verification`).

### E. Connecting a business portfolio to the existing app

MEASURED (`development/release/business-verification`, `development/create-an-app/transfer-an-app`,
`development/build-and-test/app-roles`). Creating the portfolio is yours alone.

1. You need **Administrator** on the app and **Admin (full control)** of the portfolio; the
   portfolio need not be verified yet, and it can be connected at any time.
2. The path, by dashboard vintage: **Review → Verification** in the left menu (use-case apps —
   REASONED to be yours, from "published" plus "Ready for testing"), or **App settings → Basic →
   Verification → Start Verification**. With no portfolio on your account the flow offers to create
   one (or business.facebook.com → the dropdown below Home → **Create a business portfolio**).
3. Once connected, the app's roles are managed in Business Manager, not the dashboard's Roles panel.
4. To change it later: Verification → **Remove** (opens Business Settings → Apps with the app
   selected → Remove) → Start Verification with the new one; Administrator on the app and on the old
   business. Do **not** use "+ business portfolio" under "Business portfolio ownership": that is an
   ownership claim that cannot be reversed.

### F. Business Verification

MEASURED (Meta business help 2058515294227817, 159334372093366, 1095661473946872, 587323819101032).

1. **Meta Business Suite → Settings → Security Center → Start verification** (full control needed).
   The dashboard's Start Verification only connects the app; verification finishes in Business
   Manager. Security Center shows **Start verification** or **Ineligible for verification** — the
   first real answer to the עוסק פטור question.
2. The form: legal name, address, phone and website, **exactly** as registered. The website must
   load over HTTPS (tavnit.ai's `/privacy` already names the operator and address — keep the form
   identical). No matching record → "My business isn't listed" → upload documents. Confirmation by
   email, phone, SMS, WhatsApp or domain (meta tag or DNS).
3. Documents: certificate or articles of incorporation; **a business registration or licence
   document**; **a government-issued business tax document** (a tax certificate — self-filed is
   refused); a business bank statement; a utility bill for address and phone only. Unexpired,
   issued by the authority; **Hebrew is supported**; cover ID numbers Meta does not need. A failed
   check can be appealed with a government ID.
4. Eligibility: a legal entity registered with local authorities, with an official phone or mailing
   address.
5. **עוסק פטור: UNVERIFIED.** No Meta page mentions sole traders, unincorporated businesses or
   Israel. REASONED: an עוסק פטור's registration with the Tax Authority is a government-issued,
   Hebrew business tax or registration document carrying the legal name and address — the closest
   accepted type. Whether Meta counts a sole trader as "registered with local authorities" only
   Security Center (step 1) shows.

Changing a verified business's legal name, phone or website later means verifying again.

### G. Access verification (Tech Provider)

MEASURED (`development/release/access-verification`, `development/release/tech-providers`).

- Required of a business whose app other businesses use with a listed permission. Five of your
  seven are listed: `business_management`, `instagram_basic`, `instagram_content_publish`,
  `pages_read_engagement`, `pages_show_list` (not `instagram_manage_messages`, not
  `public_profile`). REASONED: Tavnit is a Tech Provider (it uses other businesses' data to serve
  them). The Instagram use case asks "Yes, I'm a Tech Provider" — yes.
- After Business Verification, with the business unrestricted: **App Dashboard → Basics →
  Verifications → Access verification** (or the link Meta emails when you request Advanced Access):
  a business admin describes how Tavnit uses other businesses' data. Independent of App Review —
  each permission still needs Advanced Access.
- Role users bypass the check; for anyone else an unverified business's calls fail with error 100.
  A decision in about five days (Meta's page; not refuter-checked).

### H. App Review, per permission

MEASURED (`instagram-platform/app-review`, `app-review/submission-guide`, `permissions`).

- Serving accounts you do not own needs Advanced Access: App Review **and** Business Verification;
  review cannot complete before verification.
- Start: **App Review → Requests → Edit** (the Instagram guide), or **App Review → Permissions and
  Features** (the general guide).
- App settings checked: the 1024×1024 icon, the privacy URL, a business email, the category, App
  Purpose **Clients**.
- Per permission: how Tavnit uses it, **one screen recording** (English UI or captions, 1080p, no
  audio, from logged-out through Tavnit's own sign-in to the use), agreement to its allowed usage,
  and **one successful API call within the 30 days before submitting** (from the app or the Graph
  API Explorer). Dependencies go in the same submission.

| permission                  | what Meta's recording asks for                                                       | Tavnit's use                                             |
| --------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `instagram_basic`           | the full Facebook login, granting access, selecting the Instagram account            | the account's id, username, name, picture                |
| `instagram_content_publish` | creating a post and publishing it (Meta's example is a photo — a Reel is UNVERIFIED) | publishing the Reel — **PR 3**                           |
| `pages_show_list`           | the user's Pages connected to the app                                                | finding the Pages that carry an Instagram account        |
| `pages_read_engagement`     | a Page's post content shown in the app                                               | a dependency of `instagram_content_publish`              |
| `business_management`       | ads data in Meta's example; as a dependency, name the main permission                | `me/accounts` returns business-linked Pages only with it |

- UNVERIFIED: Meta's permissions reference lists `pages_read_user_content` as a dependency of
  `instagram_basic`. If the review form asks for it, it must be added to the use case and to
  `INSTAGRAM_SCOPES` (a code change) and called once before filing.
- UNVERIFIED: a user whose Page role comes through Business Manager may also need `ads_management`
  and `ads_read` (the content-publishing page).
- Then the data-handling questions (after verification), **Submit**, the Platform Onboarding Terms.
  An FLfB app with Advanced Access stays under Ongoing Review.
- Filing waits for PR 3: `instagram_content_publish`'s recording shows a post being published.

### I. Giving Meta's reviewer access

MEASURED (`app-review/submission-guide`, `instagram-platform/app-review`, and by analogy Meta's
Instagram Messaging review page).

1. A Tavnit account for the reviewer with **email and password** (not Google), **non-admin** (yours
   to create). Name it in the switch with the `named` SQL in §The switch. **Never** give the
   reviewer an admin account: an admin can open every customer's business (0102 §3).
2. Give it a finished video on a business it owns (for PR 3's schedule flow).
3. **Provide verification details**: platform **Website**; step by step from tavnit.ai's sign-in to
   הגדרות → חיבורים → חיבור חשבון → Facebook's window → the account in the list (→ PR 3's
   schedule); **Credentials**: that account's email and password. The "users sign in with a Meta
   login" radio — REASONED **No** (Tavnit's sign-in is email or Google; Facebook only connects).
4. Reviewers use their own Facebook accounts and need no role. Never submit your personal Facebook
   credentials, and never a fake account — that, or a reviewer who cannot get in, rejects the whole
   submission. UNVERIFIED: whether the reviewer brings a Page-linked professional Instagram account.
5. The app URL must be public, not localhost (Meta's App Review FAQ; not refuter-checked): the
   review runs on tavnit.ai, with PR 2 and PR 3 deployed and the reviewer named.

### J. "הוספת חשבון", Facebook's "previously linked" screen, and the one-window setup

Rewritten 2026-10-12 from the founder's live run (decision 0105). **FOUNDER-REPORTED**, today's
mode, the scope list (`META_LOGIN_CONFIG_ID` is not set in Production):

- **חיבור חשבון** connected Shira on tavnit.ai as admin, with its picture and name.
- **הוספת חשבון** → Facebook showed "Continue as…? You've previously linked Tavnit", with **Edit
  settings** and **Continue**, and no Page list. **Continue** brought back Shira only — because the
  second account, Omri, has no Facebook Page. His previous settings were already "all current and
  future", so nothing was left unticked.
- **Edit settings** → Pages, then Businesses, then Instagram accounts, each preset to "all current
  and future" → a review screen telling the user Tavnit can "manage everything in the portfolio" →
  "connected". Tavnit then showed «החיבור לאינסטגרם לא הושלם. נסו שוב.» and Shira stayed connected.
  He may have been in Facebook's window for more than ten minutes.
- Signing into Instagram as another account in the same browser changed nothing.
- Omri became a Business account on 2026-10-12 through Instagram's own flow. It has no Page; none is
  to be created for it by anyone but him.

What follows (REASONED): `auth_type=rerequest` re-asks only for declined permissions
(`facebook-login/guides/advanced/manual-flow`) and did not bring the Page list back. Facebook's own
**Edit settings** does, but it can bring a new Instagram account back only once that account has its
own linked Page. So the add pre-screen (today's mode) opens with the Page requirement, and only then
says to press Edit settings and check that the new Page and account are ticked (his ruling at
Stop 1). Facebook's **Settings & privacy → Settings → Business Integrations → Tavnit → View and
Edit** (https://www.facebook.com/help/405094243235242) reaches the same asset list from outside the
dialog.

**The red line.** The state cookie lived 10 minutes in the browser; an absent cookie fell on the one
failure line. That fits his Edit-settings walk but is REASONED until his Vercel log lines for that
callback are read: the message text, and the **names** of the query parameters (never their
values). The callback now allows 30 minutes, keeps the cookie a day so a late return reads as late,
and logs each refusal's reason.

**The one-window setup.** MEASURED on Meta's pages on 2026-10-12 (four readers, each load-bearing
line re-fetched by an independent refuter):

- `instagram-platform/instagram-api-with-facebook-login/business-login-for-instagram`: the mode lets
  a user convert to a professional account, create a Page and connect it "in a single window".
  Six parameters, "All parameters are required": `client_id`, `display=page`, the `extras`,
  `redirect_uri`, `response_type=token`, `scope`. The tokens (`access_token`, `long_lived_token`)
  come back in the **fragment**. The page never mentions `state`, `config_id`, a `code` or a
  server-side exchange. It advises showing the button only to users certain not to have onboarded.
  Its example scope leaves out `business_management`, and the page does not say why.
- The mode was announced as a beta (`messenger-platform/changelog`, 2022-05-19). No later
  general-availability note was found.
- `facebook-login/guides/advanced/manual-flow`: `code` returns in the query, `token` in the
  fragment. `facebook-login/facebook-login-for-business`: User tokens use the "implicit grant by
  default" but "can support authorization code grant". `override_default_response_type` is
  documented only for the JS SDK.
- `graph-api/changelog/non-versioned-changes/dec-5-2012`: a code must be exchanged "within 10
  minutes of their creation", and only once. Time spent in the window does not age it.
- `instagram-platform/content-publishing`: a Page that requires Page Publishing Authorization cannot
  be published to until it is done, and the app cannot tell in advance — a PR 3 risk for a Page made
  in the window.

How Tavnit calls it: §The connect mode — Meta's parameter set with `response_type=code`, never the
fragment return.

**The live run, 2026-10-12, switch on** (vault `facts/instagram-connect-live-run-2026-10-12`; the
database MEASURED, the window FOUNDER-REPORTED):

- **The code is honoured.** Omri connected through the window, and production writes a row only
  after a server-side code exchange — so Meta answered `?code=` in the query.
- **The window appears** for a profile that already linked Tavnit, with its own Instagram account
  picker, the switch-to-professional flow and Page creation.
- **A Page created in the window comes back** from `me/accounts` on the same return (Omri's, with
  Meta's default name; its first creation attempt errored back to Tavnit, the second offered the
  Page already made).
- **It failed for two of three accounts:** Yael (professional, no Page) the moment it was picked,
  before any password, even as the active account on instagram.com; tavnit.ai (personal; the
  conversion worked) the moment the password went in. Facebook's "Sorry, something went wrong. We're
  working on getting this fixed as soon as we can." — inside Meta's window, never back to Tavnit.
  REASONED: both are in the same Accounts Center as the Facebook profile running the window, Omri is
  not. The one public report (a Meta forum thread, about three years old) matches: only with this
  mode, some accounts and not others, console error GraphQL 1850019, no answer from Meta.
- **Still unknown:** whether `business_management` is needed on either route.

**Today's flow, switch off, same day:** Yael, once a Page was linked to it by hand in Instagram,
connected "so quick and seamless" — in Facebook's window he pressed confirm (continue), not Edit
settings. **The ruling (0106):** customers get today's flow, with the Page linked first; the switch
stays off and its code stays.

The Graph API version in the code, `v26.0`, is the latest on Meta's changelog (introduced
2026-07-29); the manual-flow page's example still prints v25.0.

## TikTok (PR 4, decision 0115)

TikTok is **inbox only**: Tavnit sends the file and nothing else, and the owner opens TikTok's
notification, adds the sound and the caption, and posts it. Direct post is rejected, not deferred —
TikTok offers no way to attach a sound by API (vault
[`tiktok-api-attaches-no-sound-2026-10-16`](vault/facts/tiktok-api-attaches-no-sound-2026-10-16.md)),
and music is a must (0101 decision 2). The founder's approval (2026-10-16): no customer-facing line
names a Drafts folder — it is TikTok's inbox notification. The live run of 2026-10-17 showed where it
lands, and the words are fixed (0116): **TikTok → the Inbox tab (תיבת דואר נכנס) → System
Notifications (התראות מערכת) → the notification "Your content from Tavnit is ready" → tap → TikTok's
editor** (FOUNDER-REPORTED; the notification's Hebrew wording was not observed, so its English title
is quoted and each tab carries both names, since owners run TikTok in either language). One source —
`TIKTOK_INBOX_PATH` in `social-copy.ts` — printed in four places: the TikTok card's lead, the note
shown whenever TikTok is picked in the schedule flow, the delivered line on the post page, and the
delivery email (§The delivery email). The TikTok-only time step also says what the time is for: the
video and a reminder email arrive then, the sound, caption and posting are TikTok's, and עכשיו sends
it right away; the mixed step does not (its video lands when the Reel goes live).

**Read on TikTok's pages 2026-10-16** (developers.tiktok.com/doc/…: login-kit-web,
oauth-user-access-token-management, oauth-error-handling, tiktok-api-v2-get-user-info,
content-posting-api-get-started-upload-content, content-posting-api-reference-upload-video,
content-posting-api-reference-get-video-status, content-posting-api-media-transfer-guide,
webhooks-overview, webhooks-events, webhooks-verification, content-sharing-guidelines,
add-a-sandbox, embed-player). MEASURED where a page says it; NOT STATED where none does.

- **Login Kit for Web**: `https://www.tiktok.com/v2/auth/authorize/` with `client_key`,
  `response_type=code`, a comma-separated `scope`, `redirect_uri` (registered, https, static,
  exact), `state`; **no PKCE on web**. The callback brings `code`, the granted `scopes` and `state`,
  or `error` and `error_description`. TikTok lets the owner switch a scope off. The code's lifetime:
  NOT STATED.
- **Tokens**: `POST https://open.tiktokapis.com/v2/oauth/token/`, form-encoded, with the client
  secret — server-side only. Access token 24 h, refresh token 365 days; a refresh "may" return a
  different refresh token, which "must" be used from then on. OAuth errors are a flat
  `{error, error_description, log_id}` with no HTTP status stated; `invalid_grant` covers a refresh
  token "issued to another client".
- **Inbox upload**: `POST /v2/post/publish/inbox/video/init/`, body `source_info` only (no caption,
  no sound, no AI label), 6 a minute per token, **at most 5 pending shares in any 24 h** (403
  `spam_risk_too_many_pending_share`). `PULL_FROM_URL` needs an https URL on a verified domain or
  URL prefix; "URLs that return HTTP 3xx are considered invalid"; the download "times out one hour
  after the download task is initiated". Domain verification covers subdomains.
- **Status**: `POST /v2/post/publish/status/fetch/`, 30 a minute: `PROCESSING_DOWNLOAD` →
  `SEND_TO_USER_INBOX` (in the owner's TikTok) → `PUBLISH_COMPLETE` (the owner posted it) or
  `FAILED` with a `fail_reason` (`internal` retryable). `publicaly_available_post_id` (TikTok's
  spelling) is an int64 list, only for a public post. How long a publish id stays readable: NOT STATED.
- **Webhooks**: one callback per app; reply 200 at once; retries for 72 h; at least once. The body is
  `{client_key, event, create_time, user_openid, content}` with `content` a JSON **string**. Events:
  `post.publish.inbox_delivered`, `.complete`, `.failed`, `.publicly_available` (with `post_id`; not
  for non-public posts), `.no_longer_publicaly_available`, `authorization.removed` (`reason` 0–5,
  the token already revoked). `TikTok-Signature: t=<seconds>,s=<hex>`, HMAC-SHA256 of `"<t>.<raw
body>"` under the client secret. The timestamp tolerance and whether a retry is re-signed: NOT
  STATED. Whether a sandbox has its own key, secret or webhook: NOT STATED.
- **Guidelines**: no brand name, logo or watermark "on or in any content which is shared to
  TikTok" — Tavnit's renders carry none (the dormant "AIUGC" overlay is never set). TikTok's own
  marks only from its logo pack (the tile uses its icon file unaltered).

**The flow.** חיבורים → the TikTok card → `GET /api/social/tiktok/start` (TikTok's switch; state in
`aiugc.tiktok_oauth`, HttpOnly, SameSite=Lax, path `/api/social/tiktok`; `disable_auto_auth=1` so
TikTok always shows which account; DRY_RUN lands on its own origin's callback) → TikTok → `GET
/api/social/tiktok/callback` (the Instagram ladder — cancelled, error, mismatch, expired — plus
**scope** when `video.upload` was switched off, each its own line with `?p=tiktok`; then the code
exchange, the profile, `upsertTiktokConnection`: both tokens sealed, both expiries, `connected_at`
moved to now on every connect). Tokens never reach the browser.

**Tokens on the worker.** `tiktokToken` refreshes when under 10 minutes remain, inside a
transaction holding `SELECT … FOR UPDATE` on the account row and re-reading after the lock, and
stores every value TikTok returns (rotation-safe). A lapse (`invalid_grant`, `access_token_invalid`,
`scope_not_authorized`, a missing token) marks the account `expired` — the existing pill and notice.
Any other refusal of the token endpoint (`invalid_client` — a key and secret that do not match) is
our configuration: the post fails as `internal_error`, never as TikTok refusing the video, and the
account stays connected.

**The transfer: `PULL_FROM_URL` through `https://auth.tavnit.ai`.** The Supabase custom domain
(0063) fronts Storage: a signed render URL fetched through it answers 200 `video/mp4` with no
redirect, exactly as on the `supabase.co` host (vault
[`custom-domain-serves-storage-2026-10-16`](vault/facts/custom-domain-serves-storage-2026-10-16.md)),
and the tavnit.ai domain property verified in TikTok's console covers the subdomain. The worker
mints the signed URL as Instagram's job does (TikTok's own TTL, 2 h — Instagram's stays 1 h) and
swaps its origin (`tiktokPullUrl`); the signature is host-independent. No video bytes cross the
worker's lane or a Vercel function, and it is what TikTok's guidelines ask of files already on the
app's servers. **A dependency:** deleting the custom domain breaks TikTok delivery (vault 0063's
Rollback says so since PR 4).

**The publish job's TikTok run** (`publishTiktok`, `handlePublishPost` dispatches to it; the
Instagram run is untouched):

1. The account must be `connected` with a fresh token (else `connection_expired`).
2. No publish id yet: a post waiting out the cap first claims its row back (`deferred_until` cleared
   where the post is still `publishing` — a cancel that landed in the wait wins and nothing reaches
   TikTok); the render must keep its file (`file_missing`); init → **checkpoint `{publishId}` before
   anything else**, then `provider_container_id` (written again on a resumed run when the write
   after the checkpoint was lost — the webhook and the daily poll find the post by it). A 403 pending cap → wait hourly
   (`deferred_until`, cancellable), `quota_exhausted` after a day; a 401 → `connection_expired`;
   another refusal (a ban, `url_ownership_unverified`) → `platform_refused` with TikTok's code in
   the detail; 429, 5xx or the network → the queue's retry (an ambiguous init may leave a spare
   video in the owner's TikTok — accepted over a lost post; a checkpointed id is never initiated
   again).
3. Every run re-reads the row: anything but `publishing` → done (a webhook got there first). Then
   one status read, each poll its own run 60 s apart (a reschedule, so the lane is free between
   them), at most **65** (TikTok's pull hour, with room): `PROCESSING_*` → again;
   `SEND_TO_USER_INBOX` → **`delivered`**; `PUBLISH_COMPLETE` → posted; `FAILED` → `auth_removed` is
   `connection_expired`, `internal` or `video_pull_failed` get **one** fresh upload (the failed upload's id is dropped
   first, so a cap wait after it stays cancellable) and then `platform_timeout` / `platform_refused`, anything else `platform_refused`; 65 polls →
   `platform_timeout`.
4. The nets: the last attempt and the orphan sweep read the status for a checkpointed publish id
   before calling a TikTok post failed (delivered or posted wins).

**The webhook** (`POST /api/social/tiktok/webhook`, outside the switches, no session — Meta's deletion
route is the precedent). The raw body is read before parsing; no or a bad signature → 401, nothing
touched; the secret missing → 503; a processing fault → 500 (TikTok retries). Timestamps are
accepted from 5 minutes ahead to 73 hours old: TikTok retries for 72 h and does not say it re-signs,
and every write is guarded and monotonic, so a replay changes nothing. Ids are read from the raw
text (a 19-digit id overflows a JS number). Handled (`processTiktokEvent`):

- `post.publish.inbox_delivered` → `publishing → delivered`;
- `post.publish.complete` → `publishing | delivered → posted` — the tile's **פורסם**;
- `post.publish.publicly_available` → the post id and `https://www.tiktok.com/player/v1/<id>`
  (TikTok's documented player address — a stopgap the founder approved; the sandbox's public post of
  2026-10-17 has one, so whether it opens is his look now, t7) → "צפייה בפוסט";
  `no_longer_publicaly_available` clears that link;
- `authorization.removed` → every live row of that open_id connected before the event (under any
  Tavnit account) becomes `disconnected` — it leaves חיבורים, like ניתוק — with its tokens erased,
  and its posts still waiting (`scheduled`, or `publishing` with no upload) **fail now as
  `connection_expired`**: the notice and the failure email reach the owner at once. A row
  reconnected after the event keeps its connection (`connected_at` moved on reconnect). Both halves run
  in one transaction, so a fault rolls the disconnect back and TikTok's retry replays all of it;
- everything else → 200, nothing written — `post.publish.failed` too: the job's poll owns failure
  (the webhook would otherwise race the job's one fresh upload), and the nets cover a dead job.

**Daily** (`check_social_tokens`): each connected TikTok account gets a fresh token (a refresh keeps
TikTok's rotation alive; a lapse → `expired`) and its profile (the avatar link expires); then every
TikTok post `delivered` in the last 7 days gets one status read — `PUBLISH_COMPLETE` → posted, logged
`source: poll`, so a live run tells which path fired.

**ניתוק** works as for Instagram (tokens erased, waiting posts cancelled); nothing is revoked at
TikTok (`/v2/oauth/revoke/` would end the grant for every Tavnit row on that TikTok user).

## Runbook: the TikTok app

**The console as the founder reported it (FOUNDER-REPORTED, 2026-10-14…16).** Developer app
"Tavnit": a production **draft** saved 2026-10-16 with a placeholder demo video, not submitted.
Domain property `tavnit.ai` verified by DNS TXT at Namecheap. Platform Web `https://tavnit.ai`;
Terms `/terms`; Privacy `/privacy`. Products: **Login Kit** (Web, redirect
`https://tavnit.ai/api/social/tiktok/callback`), **Content Posting API** with Upload on and Direct
Post off, **Webhooks** (callback `https://tavnit.ai/api/social/tiktok/webhook`). Scopes
`user.info.basic`, `video.upload`. One sandbox cloned from the draft, with one target user.

**What the live run showed (2026-10-17; vault
[`tiktok-inbox-live-run-2026-10-17`](vault/facts/tiktok-inbox-live-run-2026-10-17.md)).** The three
questions TikTok's pages left open, answered by the founder (FOUNDER-REPORTED): the sandbox has its
own client key and secret (the sandbox pair is on Vercel Production and on the box); the sandbox
keeps **its own URL-properties list** and needed **its own domain verification**; and checks t1–t6
passed, the box running the PR 4 code with the failure email on. The database agrees (MEASURED): the
first TikTok post, at 23:10 UTC on the 16th (02:10 on the 17th in Israel), `failed` as
`platform_refused` with TikTok's `403 url_ownership_unverified` — the refusal the plan named as the
live risk — and its failure email went at 23:12; the next two reached the inbox (23:25 and 23:30,
`delivered_at` seconds after). The post finished in TikTok's editor was public (MEASURED: its row
holds the post id and the player link, which TikTok gives only for a public post).

**Placing the pair (each its own OK; values never in a chat, a commit or a report).**

1. In the TikTok console, the **sandbox**'s Client key and Client secret.
2. Vercel → the web project → Settings → Environment Variables → Production: `TIKTOK_CLIENT_KEY`,
   `TIKTOK_CLIENT_SECRET`, one line each, then redeploy (a Vercel change reaches only deployments
   created after it).
3. The box: `nano ~/AIUGCBackend/apps/worker/.env`, the same two lines, then
   `sudo systemctl restart aiugc-worker`. Prove it without printing a value:

```bash
PID=$(systemctl show aiugc-worker -p MainPID --value)
sudo tr '\0' '\n' < /proc/$PID/environ | grep -c '^TIKTOK_CLIENT_\(KEY\|SECRET\)='
```

**Works:** `2`.

**Sandbox → production (after TikTok's audit passes).** One sitting, both sides:

1. Schedule nothing to TikTok across the swap; let every waiting TikTok post go out first.
2. Replace both values with the **production** pair on Vercel (redeploy) and on the box (restart),
   as above. A sandbox token now fails its refresh with `invalid_grant` ("issued to another
   client"), so every sandbox-connected account turns **פג תוקף** by itself at its next use or the
   next daily check — no SQL.
3. Each owner presses חיבור חשבון on the TikTok card. If production keeps the sandbox's open_id the
   row is restored in place; if not, a new row appears and the old **פג תוקף** row is removed with
   ניתוק. Either way it is a reconnect, not a data repair (0115 §7).
4. The webhook now verifies with the production secret; a sandbox-signed retry still in flight gets
   401 and is dropped after TikTok's 72 h.
5. `tiktok_posting` to `everyone` (§The switches) when the founder says so.

**Recording the review demo in the sandbox (TikTok asks for the complete flow, recorded in the
sandbox, the scopes used, up to 5 videos of up to 50 MB).** With the sandbox pair placed and the
target user's TikTok app on a phone beside the screen:

1. Show tavnit.ai's footer with Terms and Privacy, then sign in.
2. הגדרות → חיבורים → the TikTok card → **חיבור חשבון** → TikTok's authorisation page with both
   scopes → approve → back on חיבורים with the account listed (its name and picture).
3. A released video → **תזמון פרסום** → pick the TikTok account (its mark beside it) → **עכשיו** →
   **תזמון** — the sentence on what the time is for and the note with the inbox path.
4. On the phone: TikTok → Inbox → System Notifications → the notification → the video in TikTok's editor → add a sound and a
   caption → post.
5. Back in Tavnit: the tile reads **נשלח לטיקטוק** and then **פורסם**; the calendar's chip the same.
6. ניתוק on the account (or TikTok's Settings → Security → Manage app permissions → remove Tavnit) →
   the account leaves חיבורים.

## Live-test checklist (each line its own OK)

**PR 4 — TikTok, in the sandbox.** On tavnit.ai after PR 4 merges and deploys, the box on
`origin/main`, the sandbox pair placed (§Runbook: the TikTok app), the sandbox's target user. Before
the merge: ~~`db push` of **0064** and **0065** with their read-backs~~ **done 2026-10-17**, read back
before and after (vault `production-migration-push-log`) (the 0060 rule — the build names
the new columns in every read).

- (t1) connect → the TikTok card lists the account with its name and picture; read back
  `select platform, status, access_token_enc is not null, access_token_expires_at > now() from
social_accounts where platform = 'tiktok';` → `tiktok | connected | t | t`.
- (t2) schedule a **הוק + דמו** (its file has no audio stream) **now** to the TikTok account → within
  minutes TikTok's notification on the phone and the video in TikTok's editor; the tile reads
  **נשלח לטיקטוק**. **If TikTok refuses the silent file** (the chip red with «טיקטוק לא קיבלה את
  הסרטון…», `file_format_check_failed` in the post's detail): **stop and report** — renders do not
  change (founder, 2026-10-16).
- (t3) the same with a voiced render (דמות AI) — the video arrives with its own sound.
- (t4) post one from TikTok's editor → the tile reads **פורסם**; the web's log shows
  `tiktok webhook: post.publish.complete applied (source: webhook)` (Vercel's runtime logs), not the
  worker's `source: poll`.
- (t5) schedule one for an hour ahead, then remove Tavnit in TikTok (Settings → Security → Manage app
  permissions) → the account leaves חיבורים; the waiting post is red at once with «החיבור לחשבון פג.
  התחברו מחדש בהגדרות ותזמנו שוב.»; `/home` shows «פרסום אחד נכשל»; within about three minutes an
  email «פרסום שתוזמן בתבנית נכשל» (needs `RESEND_API_KEY` on the box). Then reconnect.
- (t6) _insurance:_ `select count(*) from video_renders where watermarked;` → `0` (TikTok forbids a
  mark on shared content).
- (t7) _with a public post:_ "צפייה בפוסט" opens TikTok's player for the post. The sandbox's public
  post of 2026-10-17 has its link (MEASURED); that it opens is **not yet reported** (his look).
- (t8) _PR 4.1, the delivery email, after the box runs it:_ schedule one TikTok video about five minutes
  ahead, TikTok alone — the time step shows the sentence on what the time is for; at the time TikTok's
  notification arrives and within about 2–3 minutes **one** email «הסרטון שלכם מחכה לכם בטיקטוק» with
  the video's line, the account, the three steps and a «לפרסום» button that opens the post page
  (signed in; the chip reads נשלח לטיקטוק). Two videos at once → one email «2 סרטונים מחכים לכם
  בטיקטוק» linking to the calendar. A video posted in TikTok before the email → none. **Broken:** no
  email after ten minutes (`journalctl -u aiugc-worker -o cat | grep 'delivery email'`), a second
  email for the same video, or a link that is a 404 while signed in. An unfinished video from before
  the deploy, delivered within the last 24 h, rides in the first email — expected.
- Leave the sandbox connected for the review demo (§Runbook).

**PR 2 — connecting.** The box is not involved.

- (a) ~~the `db push` of **0060** (`scheduled_posts.ai_label`)~~ **done 2026-10-11**, before PR 2
  merged (the 0039 rule: the code names the column in every post read), read back before and after
  (vault `production-migration-push-log`);
- (b) `SOCIAL_TOKEN_KEY` placed — the laptop file into Vercel Production, the box and
  `apps/web/.env.local`, the fingerprints compared — plus `META_APP_ID`, `META_APP_SECRET` (and
  `META_LOGIN_CONFIG_ID` if runbook A gave one) in `apps/web/.env.local` and Vercel Production;
- (c) the redirect URIs and the deletion URL in the Meta app (runbook B);
- (d) where the connect runs: if Check URI accepts the localhost URI, `DRY_RUN=0` in
  `apps/web/.env.local` for the window and `pnpm dev`; if it refuses, on tavnit.ai after PR 2
  merges and deploys (the switch hides it from customers);
- (e) connect your Instagram through Facebook's window → the account appears with its picture and
  name;
- (f) הוספת חשבון → does Facebook show the Page list again (runbook J)? **Run 2026-10-12 on
  tavnit.ai (FOUNDER-REPORTED):** no — "previously linked" with Continue / Edit settings; Continue
  returned Shira only (Omri has no Page); Edit settings ended on Tavnit's failure line (runbook J);
- (g) ניתוק → the count shown, the row's tokens read back null; **not yet run** — now (u) below;
- (h) a return address: open `/connect/instagram?return=/home/renders`, continue → you land on
  `/home/renders`; **not yet run** — now (v) below;
- (i) `DRY_RUN` back to 1.

**The one-window setup (0105).** On tavnit.ai after `feat/instagram-onboarding-connect` merges and
deploys; the box is not involved. Each its own OK.

- (q) the mode on (§The connect mode's SQL, read back `"onboarding"`), then **Omri**: הוספת חשבון →
  Meta's window → convert if asked, create the Page, link it, approve → Omri listed with its
  picture. Note what the window showed at each step, and whether the address it returned to
  carried `?code=` or `#access_token`. **If `#access_token`: stop** — remove Tavnit under
  Facebook's Business Integrations (treat that token as exposed) and send the callback's log line;
  **run 2026-10-12: Omri connected on the second try, by a code; Yael and tavnit.ai failed inside
  Meta's window (runbook J)**;
- (r) **Shira** is still listed once; **run 2026-10-12: yes** (three live rows, each once);
- (s) the mode off (the `delete`), then הוספת חשבון → **Edit settings** → tick → the "connected"
  line, not a failure; **run 2026-10-12, with a Page linked by hand: Yael connected with confirm
  alone, no Edit settings**;
- (t) _optional — the test covers it:_ start, wait 31 minutes in Facebook's window, finish → the
  "more than half an hour" line;
- (u) ניתוק on one account → the confirm's count, the done line, and the row's tokens read back null
  (`select access_token_enc is null, user_token_enc is null, status from social_accounts where id = '<id>';`
  → `t | t | disconnected`); **run 2026-10-12 on Shira: tokens null, `disconnected`, row kept (the
  confirm's count not reported)**;
- (v) `/connect/instagram?return=/home/renders` → המשך → finish → you land on `/home/renders`.

**PR 3 — posting.** On tavnit.ai, with the box on `origin/main` after PR 3 merges, never a task
branch (0102 planning default). Each line its own OK; the order is decision 0107's.

- **Before any of it:** PR 3 merged and its Vercel Production deploy "Ready"; the box pulled
  (`cd ~/AIUGCBackend && git pull && pnpm install && sudo systemctl restart aiugc-worker`, then
  `journalctl -u aiugc-worker -o cat | grep '"worker started"' | tail -1` shows today's time).
- (k) **the first live post — a הוק + דמו with a trending sound, now, to one account.** Open a
  released הוק + דמו video (the home strip or כל היצירות) → **תזמון פרסום** → tick one account →
  המשך → **עכשיו** → המשך → a caption → under פופולריים pick a sound → **תזמון**. **Works:** within a
  few minutes the calendar's chip turns green (פורסם); open it → **צפייה בפוסט**; in a logged-out
  (private) window the Reel plays with the caption and the sound from its first second (this also
  answers (j): whether a post made under Standard Access is public). **Broken:** the chip turns red
  with «אינסטגרם לא קיבלה את הסרטון…» — **stop and report**: Meta refused a stream-less file, and a
  silent audio track is its own task (0101).
- (l) a post **a few minutes ahead to two accounts** (tick both, today, now + 5 minutes) → two chips
  at that time, both green.
- (l2) a **גוש טקסט** post with a sound, to judge the levels (the sound leads, the clip's own sound
  under it at 40 — 0102 §2). A דמות AI post (the voice over the sound at 15) when convenient.
- (n) **a pending post changed, then cancelled:** schedule one for tomorrow; open it from לוח
  פרסומים; move its time and change the caption → **שמירה** → «השינויים נשמרו.»; then **ביטול
  הפרסום** → **כן, לבטל** → «הפרסום בוטל.»; it leaves the grid and never posts.
- (v) **the first-time path returns to the video:** open
  `https://tavnit.ai/connect/instagram?return=/schedule/<a released render's id>` → המשך → confirm in
  Facebook's window → you land back on that video's תזמון פרסום, the accounts listed. (A Tavnit
  account with nothing connected sees the same path from "לחיבור חשבון" on the schedule page.)
- (u) **a disconnect with a pending post shows the count:** schedule a post for tomorrow on one
  account → הגדרות → חיבורים → **ניתוק** on it → the confirm reads «פרסום מתוזמן אחד לחשבון הזה
  יבוטל.» → the done line → the post is gone from the calendar. Reconnect the account after.
- (w) _report only:_ whether Meta's `ig_audio` answers the **Page** token too — if it does, the User
  token column can go (0101). A read, no post. Since PR 4 it is a step of yours, not code
  (only Vercel and the box hold `META_APP_SECRET`, and a one-off read earns no command):
  developers.facebook.com → Tools → **Graph API Explorer** → your Meta app → **User or Page** →
  "Get Page Access Token" for the Page linked to the Instagram account (Explorer has the Page's
  `instagram_basic` and `instagram_content_publish` grants from your login) → GET
  `ig_audio?audio_type=music&user_id=<the Instagram account's id>` → **Submit**. **A list of
  sounds:** the Page token serves the search. **An error** (note its `code`, never the token): it
  does not. Report which.
- (m) two readings the docs do not give, recorded in the vault when seen: the container `status`
  Meta returns for a withdrawn `audio_id` (the `sound_unavailable` match is provisional until then)
  and the error `media_publish` returns when the account's quota filled between the limit read and
  the publish (a terminal `platform_refused` today; with the code known it joins the deferral path).
- (o) **the forced failure, last — the notice and the email.** `RESEND_API_KEY` placed on the box
  first (§Env names) and the startup line saying `"failureEmail":"on"`. Schedule a post 10 minutes
  ahead; remove Tavnit under Facebook's Settings → Business integrations; let the time pass.
  **Works:** the chip is red with «החיבור לחשבון פג. התחברו מחדש בהגדרות ותזמנו שוב.»; `/home` shows
  «פרסום אחד נכשל»; within about three minutes of the failure an email reaches the Tavnit account's
  address, subject «פרסום שתוזמן בתבנית נכשל», with the post, the same line and a link to the
  calendar. Then reconnect. **Broken:** no email after ten minutes — `journalctl -u aiugc-worker -o
cat | grep 'failure email' | tail -5` says why (off, paused, refused), and the notice must still be
  there.

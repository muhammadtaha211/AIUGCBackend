# 09 — Social posting: schedule a finished video, post it once

Decision [`0101`](vault/decisions/0101-tavnit-schedules-and-posts-to-instagram-and-tiktok.md)
(founder, 2026-10-10). Wherever a customer watches a finished render, a schedule button sits beside
הורדה; at the chosen time Tavnit publishes the video to the customer's Instagram as a Reel with a
caption and a Meta-catalogue sound, or sends it to their TikTok inbox. A post never goes out twice
and never after it was cancelled. Hidden behind one switch until Meta approves the app.

What this doc covers: the data model, the life of a post, the publish job's checkpoints, the
failure kinds the customer reads, the switch, the env names, and three runbooks — the Meta app's
settings, Meta's review and verification, the TikTok app. Code: `packages/core/src/pipelines/social.ts`,
`providers/meta-graph.ts`, `secret-box.ts`; migrations 0057–0059.

**Built so far (PR 1, core only):** schema, the Meta wrapper, the pipeline, the publish job, the
daily token check, the deletion path, tests. **Not yet built:** every web surface (Integrations,
the OAuth routes, the schedule flow, the sound picker, the calendar, the tag, the switch in the
layout — PRs 2 and 3) and TikTok (PR 4, once a sandbox app exists). Nothing a customer can reach
exists yet.

## Data model (0057–0059)

| table             | one row per                                                                           | notes                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `social_accounts` | connected platform account, owned by the **Tavnit account** (`users`), not a business | `external_id` = IG user id / TikTok open_id; `page_id`/`page_name`/`fb_user_id` (Instagram); `access_token_enc` = the **Page token** (Meta: no expiry) or TikTok's 24-h access token; `user_token_enc` = the ~60-day User token the sound search is documented against; `status` connected / expired / disconnected / deleted; one LIVE row per account (`social_accounts_live_idx`, partial unique on connected+expired)        |
| `scheduled_posts` | video × account                                                                       | `scheduled_at` (the instant) + `timezone` (display); `caption`, `sound` (a jsonb snapshot of the picked catalogue row, Instagram only); `status` scheduled / publishing / posted / failed / cancelled; `provider_container_id`, `provider_media_id`, `permalink`; `failure_kind` (closed set below), `failure_detail` (diagnostic, never shown), `failure_acknowledged_at`; `deferred_until` while waiting out Instagram's quota |

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
  live quota at post time regardless). A time change meets the same cap. TikTok's inbox cap
  arrives with its connect route (PR 4).
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
   `is_ai_generated=true` for services a and b, `audio_configuration` when a sound was picked: the
   silent steps format at `audio 100 / video 0`, a דמות AI, a גוש טקסט or a retired full-format A
   render at `audio 35 / video 100`) → **checkpoint `{containerId}` before anything else**.
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

| `failure_kind`        | line                                                                 |
| --------------------- | -------------------------------------------------------------------- |
| `connection_expired`  | החיבור לחשבון פג. התחברו מחדש בהגדרות ותזמנו שוב.                    |
| `sound_unavailable`   | הסאונד שנבחר כבר לא זמין באינסטגרם. תזמנו שוב עם סאונד אחר.          |
| `platform_refused`    | {platform} לא קיבלה את הסרטון. אפשר להוריד אותו ולפרסם ידנית.        |
| `platform_timeout`    | {platform} לא סיימה לעבד את הסרטון בזמן. נסו לתזמן שוב.              |
| `quota_exhausted`     | החשבון עבר את מכסת הפרסומים היומית של אינסטגרם במשך יממה. תזמנו שוב. |
| `removed_on_platform` | הסרטון הוסר בטיקטוק לפני שפורסם.                                     |
| `file_missing`        | קובץ הסרטון כבר לא שמור אצלנו.                                       |
| `internal_error`      | תקלה אצלנו מנעה את הפרסום. נסו לתזמן שוב.                            |

The lines ship with the web PR; `SOCIAL_FAILURE_KINDS` is the closed set they map. The row's
`failure_detail` is the diagnostic and never leaves the server: `toPostView` strips it (and the
container id) from everything a page reads, the way `toView` strips tokens from an account.

## The switch

`app_config.social_posting` = `{"access":"admins"}` (the default when the row is absent —
`getConfigValueOr`) or `{"access":"everyone"}`. `getPostingAccess(db, userId)` answers
`allowed` for an admin always, else per the key. Every page and route the web PRs add checks it
and answers 404 to a hidden customer. Turning it on after Meta's approval is one INSERT, no deploy:

```sql
insert into app_config (key, value) values ('social_posting', '{"access":"everyone"}'::jsonb);
```

## Env names (names only)

| name                                        | web (Vercel Production; `apps/web/.env.local` for the local live test)                    | box (`apps/worker/.env`) |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------ |
| `META_APP_ID`                               | yes                                                                                       | —                        |
| `META_APP_SECRET`                           | yes (code exchange, `appsecret_proof`, the deletion signature)                            | yes (`appsecret_proof`)  |
| `META_LOGIN_CONFIG_ID`                      | only if the app dashboard gives Facebook Login a configuration id instead of a scope list | —                        |
| `SOCIAL_TOKEN_KEY`                          | yes                                                                                       | yes                      |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | when TikTok is built                                                                      | when TikTok is built     |

Admin needs none. Bare values, one line each, and a Vercel change reaches only deployments created
after it (vault `env-values-differ-between-the-box-and-vercel`). Generate the key once:
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` — and never paste
it anywhere a report or a shell history can read it back. All providers honour `DRY_RUN`: a
dry-run web "connects" a sample account and a dry-run worker "publishes" to nothing.

## Runbook: the Meta app's settings

Everything here is done in Meta's developer console by the founder; the code assumes it.

1. **Use case** "Manage messaging & content on Instagram", setup **Facebook Login** (not Instagram
   Login — one setup per app). The bundle it adds and the code requests: `business_management`,
   `instagram_basic`, `instagram_content_publish`, `pages_read_engagement`, `pages_show_list`.
   `business_management` is what makes `GET /me/accounts` return Pages linked to a Meta business
   (Graph API changelog v17.0, "User Accounts").
2. **Facebook Login → Settings → Valid OAuth Redirect URIs**: `https://tavnit.ai/api/social/instagram/callback`
   and, for the local live test while the app is in Development mode,
   `http://localhost:3000/api/social/instagram/callback`. If the dashboard offers Facebook Login
   **configurations**, create one with the five permissions and put its id in `META_LOGIN_CONFIG_ID`.
3. **Settings → Basic**: App ID and App Secret (→ `META_APP_ID`, `META_APP_SECRET`), Privacy
   Policy URL `https://tavnit.ai/privacy`, Terms URL `https://tavnit.ai/terms`, **User Data
   Deletion** = callback URL `https://tavnit.ai/api/social/meta/data-deletion` (required before
   Live mode; it fires only when a user removes the app AND clicks "Send Request"), a 1024×1024
   icon without Meta marks, category, contact email. Settings → Advanced: **Require App Secret** may
   stay on — every call sends `appsecret_proof`.
4. **Roles**: while the app is in Development mode only administrators, developers and testers can
   grant permissions, and only their own Instagram accounts can be connected. Meta's app-modes page
   says Development-mode "test posts" are visible only to role users; whether that reaches
   Instagram media is unstated — the live checklist's first step is a logged-out look at the Reel
   you published from the Explorer.
5. **Pages**: every Instagram professional account to connect needs its own Facebook Page (one Page
   carries one account), and the Facebook user needs admin-equivalent tasks on it. The Page need
   not be published.

## Runbook: Meta's App Review and Business Verification

Needed before any customer who is not a role user can connect. Advanced Access for the five
permissions, then the app to Live, then `social_posting` to `everyone`.

- **Before filing**: the web PRs must be live — Meta's "Private apps" rule says an app it cannot
  test (no user interface, or the login flow not implemented) is approved only for
  `instagram_basic` and `instagram_manage_comments`.
- **Per permission**: a usage description in its own words (no copy-paste), a **screen recording**
  (1080p or better, no audio) of a user granting it and the app using it, and **at least one
  successful API call with that permission within the 30 days before submission** — the live test
  provides those for all five.
- **App settings Meta checks**: the Privacy URL, the icon, the category, App Purpose = "Clients",
  the primary contact, the User Data Deletion URL (above).
- **Reviewer access**: instructions to reach the flow — a test customer account on `tavnit.ai`,
  never your own credentials. The feature is hidden from non-admins until approval, so the
  instructions must name an admin-role test account or the switch is flipped for the review window.
- **Business Verification** when prompted (documents of the business), then the data-handling
  questions.
- **After approval**: switch the app to Live, then the INSERT above. Record the dates in the vault.

## Runbook: the TikTok app (not built — the next task)

What TikTok's docs (read 2026-10-10) say it will take, so the console work can start before the
code:

- Create the app at developers.tiktok.com: icon, a name that does not reference social-media
  companies, category, a user-visible description, platform Web with the official website URL,
  **Terms and Privacy URLs visible on the site without opening a menu**, products **Login Kit**
  and **Content Posting API (Upload)**, scopes `user.info.basic` and `video.upload` (inbox drafts;
  `video.publish` is direct post — out of scope by decision 4).
- **Redirect URI**: https only, exact match — `https://tavnit.ai/api/social/tiktok/callback`. No
  `localhost`: TikTok's live test runs on the deployed origin.
- **Sandbox**: up to 10 target accounts you own (added with their credentials; up to an hour to
  appear). "Sandbox mode does not offer access to Content Posting API for public videos"; an inbox
  draft is not a public video, so the inbox path should work there — a live run shows it.
- **Transfer method**: `FILE_UPLOAD` from the worker (`PULL_FROM_URL` needs a verified domain we
  do not own). Chunks 5–64 MB, a file under 5 MB uploaded whole; `upload_url` valid one hour;
  `init` 6 requests/min per token; `status/fetch` 30/min.
- **Caps**: at most **5 pending shares per 24 h** per account (`spam_risk_too_many_pending_share`);
  the schedule guard mirrors it.
- **Tokens**: access 24 h, refresh 365 days, refresh may return a new refresh token (store it).
- **Review**: demo videos (≤5, ≤50 MB) of the complete flow **recorded in sandbox**, only the
  scopes used.

## Live-test checklist (each line its own OK)

(a) `db push` of 0057–0059 after `migration list` and `db push --dry-run`; (b) the env names
above into `apps/web/.env.local` and the box; (c) the box checked out on the web PR's branch and
restarted; (d) `DRY_RUN=0` in `apps/web/.env.local` for the window and the localhost redirect URI
in the Meta app; (e) a logged-out look at the Explorer-published Reel; (f) connect Instagram;
(g) the first live post: an **A render** with a sound — Meta's handling of a stream-less MP4 is
unstated in its docs; (h) a B render with a sound, to judge the 35 % bed; (h2) two readings the docs
do not give, recorded in the vault when seen: the container `status` Meta returns for a withdrawn
`audio_id` (the `sound_unavailable` match is provisional until then) and the error code
`media_publish` returns when the account's quota filled between the limit read and the publish (it
is a terminal `platform_refused` today; with the code known it joins the deferral path); (i) edit one pending
post's time and cancel another; (j) the forced failure, last: remove Tavnit under Facebook's
Business integrations, let a pending post run, see `connection_expired`, reconnect; (k) `DRY_RUN`
back to 1, the box back on `origin/main` after merge.

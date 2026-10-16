# PR 4 — TikTok inbox posting: plan

**Approved 2026-10-16 with five changes, folded in below** (see "The founder's approval").

Branch `feat/tiktok-inbox-posting` (from `origin/main` a63edb4). The prompt is saved to
`docs/claude/prompts/2026-10-16-tiktok-inbox-posting.md` and this plan to
`docs/claude/plans/2026-10-16-tiktok-inbox-posting.md` (CONVENTIONS names no place; the root
`prompts/` folder is the pipeline's versioned Claude prompts). Reviewed before approval: three
critics (TikTok contract, correctness/security, scope/simplicity) and a verifier; 20 confirmed
findings are folded in.

## The founder's approval (2026-10-16)

"Approved, with these changes":

1. Every "תיבת הטיוטות" reference becomes the **inbox notification** — TikTok's doc says the owner
   must open the inbox notification to continue editing; the video is not in the Drafts folder.
   Final wording after the live run shows where it lands. The tag נשלח לטיקטוק stays.
2. The pending-cap guard counts **scheduled, publishing and delivered only**, not posted (posted
   drafts are not pending at TikTok); the 403 and the hourly deferral cover the rest.
3. Prompt and plan saved in the repo (docs/claude/…).
4. Confirm the 65 polls don't hold a worker lane for an hour inside one job run — **confirmed:**
   each poll returns `{kind: "reschedule", delayMs: 60_000}` with its state (Instagram's pattern,
   social.ts:1269), which ends the run and frees the lane; the queue re-claims the job a minute
   later with `jobs.state`.
5. If the sandbox refuses the silent הוק + דמו, **stop and report**; renders do not change.

OK granted: push 0064 and 0065 before merge with the read-backs; the failure email's cause becomes
(account, platform, kind), amending 0107 §3; the player-URL permalink as a stopgap, checked after
the audit; `post.publish.failed` received and ignored; each platform's icon fetched from its
official brand kit. "Everything else as planned. Go."

## Context

Instagram posting (PRs 1–3, #89–#96) is live behind `app_config.social_posting`. TikTok was always
PR 4 (0101 decision 4, 0102 §4), blocked on a TikTok app that now exists (your console work,
2026-10-16). Goal: a user inside a new TikTok switch connects a TikTok account, picks it alone or
beside Instagram accounts when scheduling, the worker hands the file to TikTok's **inbox** at the
scheduled time, the owner finishes in TikTok, and the tile and calendar show **נשלח לטיקטוק** on
delivery and **פורסם** when TikTok's webhook says the owner posted.

## §3, answered (MEASURED unless marked)

| Item                              | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `platform` accepts `tiktok`       | Yes — enum `social_platform ('instagram','tiktok')` (0057:28). No migration for it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Live index with an open_id        | `social_accounts_live_idx (user_id, platform, external_id) WHERE status IN ('connected','expired')` (0058:86-88), per Tavnit user — one open_id can be live under two Tavnit users; the webhook updates every match.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Migration still needed            | **Yes**: nothing stores the 24 h access-token expiry; `scheduled_post_status` has no "delivered".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Picker with mixed platforms       | Shows no platform; caption, sound picker and AI tick render for every pick; core writes caption and `ai_label` onto TikTok rows (social.ts:647,650). All change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Tag rule                          | Web: `postTag()` `lib/social-posting-ui.ts:37` ← `postCountsByRender` `lib/social.ts:41-64` (no platform) → `home/render-tile.tsx`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Worker → file                     | `video_renders.file_path` → `getStorage().signedUrl(path, 3600)` on the `SUPABASE_URL` host (social.ts:1227). Nothing on tavnit.ai serves bytes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Tavnit mark on renders            | **No — not a stop.** Only a dormant "AIUGC" overlay drawn when `video_renders.watermarked`, which no code sets (`overlays.tsx:31-123`). A read-only count is in your steps as insurance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Env names                         | docs/09:379 already plans `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` (web + box); the one shared schema `packages/core/src/config.ts` has neither yet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Switch                            | `app_config.social_posting`, zod admins/named/everyone, absent = admins; `named` lists Tavnit **user ids** (social.ts:116-157).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Box / `RESEND_API_KEY`            | Box ran ≥ d41eae6 on 2026-10-14 (state-of-play:1041); no runtime file changed since. Resend key on the box: **not reported** — your step.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Sandbox webhook field             | Only you can confirm; TikTok's pages don't say whether a sandbox has its own key, secret or webhook.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| TikTok contract (read 2026-10-16) | Authorize `https://www.tiktok.com/v2/auth/authorize/` (client_key, response_type=code, comma scopes, redirect_uri, state — **no PKCE on web**). `POST /v2/oauth/token/` exchange + refresh: access 24 h, refresh 365 d, refresh token "may be different… must use the newly-returned"; OAuth errors are a flat `{error, error_description, log_id}`, `invalid_grant` covers a token "issued to another client". Inbox init `POST /v2/post/publish/inbox/video/init/`, body `source_info` only, 6/min. Status `POST /v2/post/publish/status/fetch/` 30/min: PROCESSING_* → SEND_TO_USER_INBOX → PUBLISH_COMPLETE / FAILED. **≤5 pending shares per 24 h** (403 `spam_risk_too_many_pending_share`), pending = drafts the owner hasn't finished. PULL download times out 1 h after init; 3xx is invalid. Webhooks `post.publish.inbox_delivered`, `.complete`, `.failed`, `.publicly_available` (`post_id`, public posts only), `.no_longer_publicaly_available`, `authorization.removed` (reason 0–5, token already revoked); `content` is a JSON **string**; `TikTok-Signature: t=…,s=…` = HMAC-SHA256(client_secret, `"{t}.{raw body}"`); reply 200, retries 72 h, at-least-once. NOT STATED: code lifetime, signature encoding (example is 64 hex), timestamp tolerance, publish_id lifetime, whether a silent MP4 (הוק + דמו has no audio stream) is accepted. |

No stop fired. Your decisions change four older lines, each getting a dated pointer: 0108 §1 (one
tag per video), "one switch" (docs/09:7,223; 0101:71; 0107 §3), 0101:117's `FILE_UPLOAD` premise,
and "no TikTok app / no TikTok card" (0101:138, 0102 §4, state-of-play).

## Design

### 1. Data — two migrations

- **0064_scheduled_post_status_delivered.sql**: `ALTER TYPE scheduled_post_status ADD VALUE IF NOT
EXISTS 'delivered' AFTER 'publishing'`, alone in its file (0061's rule). TikTok goes
  `scheduled → publishing → delivered → posted`; Instagram never uses `delivered`.
- **0065_tiktok_token_expiry_and_delivery.sql**: `social_accounts.access_token_expires_at
timestamptz`, `scheduled_posts.delivered_at timestamptz`. No index (tables of hundreds of rows).
- Reused as 0058 documented: `external_id` = open_id, `access_token_enc`, `refresh_token_enc` +
  `refresh_expires_at` ("TikTok only"), `provider_container_id` = publish_id, `provider_media_id`
  = TikTok `post_id` (stored as **text** — 19-digit ids exceed JS numbers), `permalink`.
- `PORTABLE_MIGRATIONS`, pins in `migrations.test.ts`, `db/schema.ts`. **Push before merge**
  (0060's rule: drizzle selects every column). `db push --dry-run` in the report; nothing applied
  without your OK.

### 2. The switch — `app_config.tiktok_posting`, independent

- Same schema and modes, absent = admins, unparseable = hidden. `social_posting` becomes
  **Instagram's** switch in the docs (key unchanged, no data change).
- Core `getPlatformAccess(db, userId) → {instagram, tiktok}`; `getPostingAccess` stays and means
  "any platform", so the shared surfaces (calendar, schedule page, notice, nav, shared post routes)
  open for a TikTok-only user unchanged.
- Platform gates: Instagram card, pre-screen, start/callback/sounds → `instagram`; TikTok card,
  start/callback → `tiktok`. **One `platforms` argument filters every read in core**:
  `listSocialAccounts`, `listScheduledPosts`/`getScheduledPostItem`, `getScheduledPost` (so PATCH
  and cancel), `postingNotices`, `pendingPostsByRender`, `disconnectSocialAccount`,
  `schedulePosts`; plus the web's `postCountsByRender`. A hidden platform's post or account reads
  as not found. Failure email checks the post's own platform. One switch-matrix test per surface.

### 3. Provider — `packages/core/src/providers/tiktok.ts` (mirrors `meta-graph.ts`)

`TiktokProvider`; `HttpTiktok`, deterministic `DryRunTiktok`, `setTiktokProvider` /
`getTiktokProvider`. Calls: `exchangeCode`, `refresh`, `userInfo` (`open_id,display_name,avatar_url`),
`initInboxPull(videoUrl)`, `publishStatus`. 20 s timeout; no retries in the provider.

- Content-Posting/user-info errors (`error.code` + HTTP): network, 5xx, 429, `rate_limit_exceeded`,
  `internal_error` → `TransientError`; else `TiktokApiError extends PermanentError`.
- OAuth endpoint: read the **flat body `error`** whatever the HTTP status; `server_error`,
  `temporarily_unavailable` → transient; `invalid_grant` → lapse (covers the sandbox→production
  swap: a sandbox token is "issued to another client"); else non-lapse refusal.
- `isTiktokTokenLapse`: `invalid_grant`, `access_token_invalid`, `scope_not_authorized`.
- `publicaly_available_post_id` taken as text from the raw body. Logs method/path/status only —
  never tokens, never the signed URL's query (it is a bearer token for the file). Credentials read
  at use. Pure `verifyTiktokSignature` (hex, length check before `timingSafeEqual`). No library.

### 4. Connect and tokens

- **חיבורים** gains a **טיקטוק** card after אינסטגרם, each card under its own switch; the card's
  lead line explains inbox → finish in TikTok; its button goes straight to the start route.
- `GET /api/social/tiktok/start`: `requirePlatformUser('tiktok')`; `?return=` through
  `socialReturnPath` into the existing HttpOnly state cookie (`social-oauth.ts`, parametrised by
  path); authorize URL with the constant redirect `https://tavnit.ai/api/social/tiktok/callback`,
  scopes `user.info.basic,video.upload`, `disable_auto_auth=1` (TikTok always shows which account).
  DRY_RUN → the **same-origin** callback with `code=dry_run` (so local walks and harnesses work).
- `GET /api/social/tiktok/callback`: Instagram's outcome ladder (cancelled / error / mismatch /
  expired / connected; own lines; fragment; cookie cleared) plus **scope** (owner switched off
  `video.upload` → nothing stored). Then `exchangeCode` → `userInfo` → core
  `upsertTiktokConnection` (seal both tokens, both expiries, and **`connected_at = now()` on every
  connect**, so a late `authorization.removed` retry can't undo a reconnect).
- Freshness: core `tiktokAccessToken(db, accountId)` refreshes when < 10 min remain, inside a
  transaction with `SELECT … FOR UPDATE`, re-reading after the lock, storing every returned value
  (rotation-safe). A lapse marks the account `expired` (the existing pill and notice).
- **Sandbox → production** (your decision: a reconnect, not a repair): after the pair swaps,
  sandbox refresh tokens answer `invalid_grant` → accounts turn `expired` on their own at first use
  or the daily check → the owner connects again from חיבורים. If production open_ids equal the
  sandbox ones, that updates the row in place; if they differ, it adds a row and the old `expired`
  one is removed with ניתוק. No SQL either way. Runbook: swap the pair on Vercel and the box in one
  sitting, schedule nothing across it.
- ניתוק as today; like Instagram nothing is revoked at TikTok (`/v2/oauth/revoke/` would kill the
  grant for every Tavnit row on that TikTok user).

### 5. Scheduling

- `schedulePosts`: TikTok rows get `caption=''`, `sound=null`, `ai_label=false` whatever the body
  says; caption limit and sound rule stay Instagram's; accounts outside the allowed platforms →
  `not_found`.
- Pending-share guard: `assertAccountCaps` refuses the 6th TikTok post per account within a day
  either side (scheduled/publishing/delivered only — a posted draft is no longer pending at
  TikTok; the 403 and the hourly deferral cover the rest), code
  `tiktok_pending_cap` (429). Moves of time meet it too. `updateScheduledPost` on TikTok: time only.

### 6. The publish job — `handlePublishPost` dispatches TikTok to `publishTiktok` (Instagram code untouched)

**Transfer: `PULL_FROM_URL` through `https://auth.tavnit.ai`.** Why:

- MEASURED 2026-10-16: `auth.tavnit.ai` (the Supabase custom domain, 0063) fronts Supabase Storage
  — a GET for a missing public object answered storage's own `NoSuchKey` JSON, no redirect.
  tavnit.ai's verified domain property covers subdomains (media-transfer guide). A signed URL's
  token is host-independent, so the worker mints it as for Instagram and swaps the origin.
- It is what TikTok's guidelines ask for files already on our servers, it mirrors Instagram's URL
  hand-off (init → poll), and no video bytes cross the worker's light lane or a Vercel function.
- TikTok-only `TIKTOK_PULL_URL_TTL_SECONDS = 7200` (> TikTok's 1 h download window); Instagram's
  3600 constant untouched.
- **Proven first**: a read-only probe mints a signed URL for one released render and GETs it via
  auth.tavnit.ai — prints status, content-type and Location only, never the URL. 200 + video/mp4 +
  no Location, or I fall back to `FILE_UPLOAD` and say so.
- New dependency, recorded as a dated pointer under 0063's Rollback: deleting the custom domain
  breaks TikTok delivery — switch to FILE_UPLOAD first. Live risk (console, not code): whether the
  sandbox honours the URL property (`url_ownership_unverified` → `platform_refused` with the code
  in the detail).

Flow (state `{publishId, polls, deferredSince, reinitiated}`):

1. Re-read the row: anything but `publishing` → done (a webhook got there first). Account
   connected + fresh token, else `connection_expired`.
2. No `publishId`: on a deferred re-run, first **claim the row** (`set deferred_until = null where
status='publishing' returning id`; none → done — closes the cancel-during-init race). Render
   file (else `file_missing`) → signed URL → `init` → **checkpoint `publishId`**, then
   `provider_container_id`. 403 pending cap → defer hourly up to 24 h, then `quota_exhausted`.
   401 → `connection_expired`. Other 4xx → `platform_refused`. 429/5xx/network → transient retry
   (an ambiguous init may leave a spare draft — accepted; never re-init after a checkpointed id).
3. Poll `status/fetch` every 60 s, **≤ 65 polls** (covers TikTok's 1 h pull): PROCESSING_* →
   again; SEND_TO_USER_INBOX → `delivered` (`publishing → delivered`, `delivered_at`);
   PUBLISH_COMPLETE → posted; FAILED: `auth_removed` → connection_expired; `internal` or
   `video_pull_failed` → one fresh init, then platform_timeout / platform_refused; else
   platform_refused. 65 polls → platform_timeout.

- One TikTok posted writer, guarded `publishing|delivered → posted`, used by the job, webhook,
  daily poll and nets. `failPostOnTerminal` gains a `TiktokApiError` branch; the last-attempt and
  orphan nets read `status/fetch` for a checkpointed publish_id before failing a TikTok post.

### 7. Webhook — `POST /api/social/tiktok/webhook`

No session, no switch (Meta's deletion route is the precedent). Raw body before parsing;
secret missing → 503; bad/missing signature → 401; timestamp accepted from 5 min ahead to 73 h old
(TikTok retries 72 h and doesn't say it re-signs; every write below is guarded and monotonic, so a
replay changes nothing). `content` parsed again; `publish_id`/`post_id` taken as **digit strings
from the raw content** before `JSON.parse`. Processing fault → 500 (TikTok retries). Handled:

- `post.publish.inbox_delivered` → `publishing → delivered`.
- `post.publish.complete` → `publishing|delivered → posted` — **פורסם**.
- `post.publish.publicly_available` → store `post_id`, permalink
  `https://www.tiktok.com/player/v1/{post_id}` (TikTok's documented player URL) → "צפייה בפוסט";
  `no_longer_publicaly_available` clears that permalink (matching id). The sandbox can't make
  public posts, so the link is checked after the audit.
- `authorization.removed` → rows with that open_id, `connected|expired`, `connected_at` before the
  event → `disconnected`, tokens erased; their waiting posts **fail now as `connection_expired`**,
  so the notice and the email reach the owner the same minute.
- Everything else → 200, nothing written — including `post.publish.failed`: the job's poll owns
  failure (it would otherwise race the job's one retry), and the nets cover a dead job.

### 8. Daily check

`check_social_tokens` adds TikTok accounts: fresh token + `userInfo` (name, expiring avatar link;
a lapse → `expired`). Then TikTok posts `delivered` within 7 days get one `status/fetch` each:
PUBLISH_COMPLETE → posted (logged `source: poll`, so the live run tells webhook from poll).

### 9. Failure email (0107 §3) — a change to his rule, flagged

Cause becomes (user, **platform**, kind); `logEmail` records the platform; the 24 h cooldown/fold
matches it (older rows count as Instagram); the hide check asks the post's own switch. TikTok
wording for `quota_exhausted`, singular **and** plural. Send-key format unchanged.

### 10. Screens

- **Tiles**: counts by (render, platform); wire `postTag` → `postTags: {platform, tag}[]`,
  Instagram first, one chip per platform with its icon. Per platform: מתוזמן while any waits; else
  TikTok **נשלח לטיקטוק** while any draft is delivered, else **פורסם** once any is posted;
  Instagram unchanged; no chip when its only posts failed or were cancelled. (Two TikTok accounts:
  an unfinished draft outranks a posted one — it's the thing to act on.)
- **Icons**: each platform's official mark from its brand kit, unaltered, inline SVG (TikTok's
  design guidelines forbid redrawn logos). I'll ask before downloading each file; origin recorded
  in docs/09.
- **Schedule flow**: icon on each account; lists filtered by switch. Caption + sound + AI tick only
  when an Instagram account is picked; TikTok-only submits from "מתי?". Whenever TikTok is picked,
  the last step says the draft lands in TikTok's inbox and is finished there (TikTok asks apps to
  say so). Done line per mix. The no-account card links per the user's switches.
- **Calendar**: `delivered` chip with its own colour and label; icon on chips.
- **Post page**: TikTok shows no caption/sound/tick; time edit and cancel as today; delivered →
  finish-in-TikTok line; permalink → "צפייה בפוסט"; deferred → TikTok's pending label.

DRAFT strings (yours to approve at review; FINAL = your words). Approval change 1: no line names
a Drafts folder — the owner opens TikTok's inbox notification; final wording after the live run
shows where the video lands.

- Card: «טיקטוק»; lead «תבנית שולחת את הסרטון לטיקטוק, ובאפליקציה מגיעה התראה. פותחים אותה, מוסיפים סאונד וכיתוב ומפרסמים.»
- Outcomes: «החלון של טיקטוק נסגר בלי אישור, ולא חובר שום חשבון. אפשר להתחיל שוב בכל זמן.» / «טיקטוק לא השלימה את החיבור, ולא חובר שום חשבון. נסו שוב בעוד כמה דקות.» / «החזרה מטיקטוק לא תאמה את החיבור שהתחיל כאן. התחילו שוב מההגדרות.» / «עברה יותר מחצי שעה מאז שנפתח החלון של טיקטוק. התחילו שוב.» / scope «כדי לשלוח סרטונים לטיקטוק צריך לאשר גם את ההרשאה להעלאת סרטונים. התחברו שוב ואשרו את שתיהן.»
- No-account: TikTok only «מחברים חשבון טיקטוק, וחוזרים לכאן לתזמן את הסרטון.»; both «מחברים חשבון אינסטגרם או טיקטוק בהגדרות, וחוזרים לכאן לתזמן את הסרטון.»
- With TikTok picked: caption label «כיתוב (אינסטגרם)»; note «לטיקטוק נשלח רק הסרטון. כשמגיעה ההתראה מטיקטוק, פותחים אותה, מוסיפים סאונד וכיתוב ומפרסמים.»
- Done: TikTok only «הסרטון יישלח לטיקטוק ב־{date} בשעה {time}. אפשר לשנות או לבטל בלוח הפרסומים עד שהשליחה מתחילה.»; mixed «הסרטון יפורסם באינסטגרם ויישלח לטיקטוק ב־{date} בשעה {time}. אפשר לשנות או לבטל בלוח הפרסומים עד שהפרסום מתחיל.»
- Tag/status **נשלח לטיקטוק** (FINAL). Deferred «ממתין שטיקטוק תקבל עוד סרטונים לחשבון». Refusal `tiktok_pending_cap` «לחשבון הטיקטוק הזה כבר מתוזמנות 5 טיוטות סביב המועד הזה, המקסימום של טיקטוק. בחרו מועד אחר.»
- Post page, delivered: «הסרטון נשלח לטיקטוק. פותחים את ההתראה מטיקטוק באפליקציה, מוסיפים סאונד וכיתוב ומפרסמים.»
- Failure `quota_exhausted` TikTok: one «טיקטוק לא קיבלה את הסרטון במשך יממה, כי סרטונים קודמים שנשלחו עוד מחכים שתסיימו אותם. מסיימים אותם בטיקטוק ומתזמנים שוב.»; several, the same for «החשבונות».
- Icon labels «אינסטגרם», «טיקטוק».

## Critical files

Core: `db/schema.ts`, `config.ts` (+2 names), `providers/tiktok.ts` (new),
`pipelines/social.ts` (access, platform filters, caps, schedule, dispatch, nets, daily check),
`pipelines/social-tiktok.ts` (new: upsert, token freshness, publish, events),
`pipelines/social-failure-email.ts`, `social-copy.ts`, `index.ts`; migrations 0064, 0065;
`.env.example`. Web: `lib/social.ts`, `lib/social-oauth.ts`, `lib/social-ui.ts`,
`lib/social-posting-ui.ts`, `lib/social-paths.ts`, `lib/social-posting.ts`, `lib/api-errors.ts`,
`api/social/tiktok/{start,callback,webhook}/route.ts` (new), Instagram routes (gate),
`api/social/posts/**`, `api/renders/[id]`, `api/businesses/[businessId]/renders`,
`home/settings/{page,social-accounts}.tsx`, `home/page.tsx`, `(posting)/schedule/[renderId]/*`,
`(posting)/calendar/**`, `home/render-tile.tsx`, `renders-strip.tsx`, `renders-library.tsx`,
`components/ui/icons.tsx`. Tests: new `packages/core/test/{tiktok,social-tiktok}.test.ts`,
`FakeTiktok` in `test/helpers/social.ts`; extended `social-{accounts,scheduling,publish,failure-email}`,
`migrations`; web `social-connect`, `social-schedule`, new `social-tiktok-webhook`, `analytics`
(mask counts), `auth-user` if a page is added.

## Build order

1. Save prompt + plan. The signed-URL probe (read-only) settles §6.
2. Core: migrations + schema + config → provider + tests → `social-tiktok.ts` + social.ts + tests
   (crash/resume at each checkpoint, webhook-before-poll, deferred claim vs cancel, rotation under
   lock, replayed removal after reconnect, 19-digit ids, OAuth flat errors, switch matrix, caps,
   email fold per platform).
3. Web, serially: wire types + routes + gates + webhook, then screens + strings; tests typechecked
   as I go, vitest only through `test-runner` (one at a time — parallel vitest OOMs this machine).
   Screenshots from a fetch-mock harness (no production rows), deleted after with `apps/web/.next`.
4. Docs/vault, state-of-play.
5. Gate via `test-runner`; adversarial review workflow on the diff (races, contract, webhook and
   token security, switch leaks, Hebrew/RTL) → fixes → gate. `db push --dry-run`. Commit,
   `pnpm repo-map` (alone as `chore: repo-map`), push, PR via the API (no gh). Stop for your OK.

## Docs and vault

- docs/09: a TikTok section replacing "not built" (flow, data, switch, transfer + its dependency,
  webhook, env names on Vercel **and** the box, sandbox → production runbook, your console state as
  FOUNDER-REPORTED, the review-demo steps, live checklist); "one switch" lines rewritten.
- **0115** (one note, numbered sections like 0107/0108 — CONVENTIONS asks one claim per note, not
  one note per decision): your seven decisions with options and reasons, plus the planning defaults
  you approve here (transfer method, tag outranking, revoke fails waiting posts, the email cause).
  Facts: `tiktok-api-attaches-no-sound-2026-10-16.md` (your URLs and fields, re-read today) and
  `custom-domain-serves-storage-2026-10-16.md` (the probe). Dated pointers on 0101, 0102, 0107,
  0108 and 0063 (rollback). state-of-play: the PR, your external state (Meta + TikTok,
  FOUNDER-REPORTED 2026-10-14…16), queue, owed actions.

## After merge — each its own OK

1. `db push` 0064+0065 **before** merge; read-backs: `select enumlabel from pg_enum where
enumtypid='public.scheduled_post_status'::regtype order by enumsortorder` (delivered after
   publishing) and an `information_schema.columns` check for the two columns. Then merge.
2. Env: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` (sandbox pair) on Vercel production and in
   `apps/worker/.env` on the box. Box: pull, install, restart (**the report's Next step opens with
   this**); confirm `"failureEmail":"on"` (Resend key).
3. Switch: you're admin, so an absent row already includes you. To add another account:
   `insert into app_config (key, value) select 'tiktok_posting', jsonb_build_object('access','named','userIds', jsonb_agg(id)) from users where email in ('…') on conflict (key) do update set value = excluded.value, updated_at = now();`
   read back with `select value from app_config where key='tiktok_posting';`.
4. Live, sandbox target user: connect → listed → schedule a הוק + דמו (silent file) and a voiced
   render → inbox notifications in TikTok (if the sandbox refuses the silent הוק + דמו: **stop and
   report**, renders unchanged) → tiles נשלח לטיקטוק → post one in TikTok → tile פורסם (log
   says `webhook`) → schedule one more, revoke in TikTok → account leaves the list, that post fails
   at once with the notice and email → reconnect. Insurance: `select count(*) from video_renders
where watermarked` = 0. I gather the code-side evidence (logs, read-only SQL); you do the phone
   steps. Sandbox left connected, with the demo step list in docs/09.
5. Instagram: (k) and (o) as docs/09 words them, on tavnit.ai; (w) in Graph API Explorer (`ig_audio`
   with the Page token: ok or refused) — no new code for a one-off read.

## Differences from the prompt / assumptions

- 0107 §3's cause (account, kind) becomes (account, platform, kind) — needs your OK.
- "Shows disconnected" after a revoke = the account leaves חיבורים (status `disconnected`, as with
  ניתוק); its waiting posts fail with the reconnect line and email instead of vanishing.
- `post.publish.failed` is received and ignored (the job owns failure) — your list didn't include it.
- No revoke on ניתוק (Instagram's reason). A daily status poll backs the webhook.
- After the sandbox→production swap, a changed open_id means one ניתוק of the old row.
- The player-URL permalink is checked after the audit (sandbox posts can't be public).
- `named` stays by Tavnit user id. "claude/" read as `~/.claude/`.

## Owed outside the code

Privacy page text (what Tavnit receives from TikTok — open_id, display name, avatar, tokens — why,
how to disconnect/revoke, deletion), reported not edited. TikTok review demo recorded in sandbox
(steps in docs/09); Submit for review is yours.

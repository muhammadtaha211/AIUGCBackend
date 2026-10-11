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

**Built so far.** PR 1 (core, merged as #89): schema, the Meta wrapper, the pipeline, the publish
job, the daily token check, the deletion path. PR 2 (connect, `feat/social-posting-connect`):
decision 0102's changes to the core (the AI label per post — migration 0060, the mix per service,
the switch's `named` setting), the חיבורים section in `/home/settings`, the Instagram pre-screen,
the Facebook round trip, disconnect, Meta's deletion callback and its status page (§Connecting an
account). **Not yet built:** the schedule flow, the player button, the sound picker, the calendar,
the tag, the `/home` notice (PR 3) and TikTok (PR 4, once a sandbox app exists). Everything a
customer could reach is behind the switch.

## Data model (0057–0060)

| table             | one row per                                                                           | notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `social_accounts` | connected platform account, owned by the **Tavnit account** (`users`), not a business | `external_id` = IG user id / TikTok open_id; `page_id`/`page_name`/`fb_user_id` (Instagram); `access_token_enc` = the **Page token** (Meta: no expiry) or TikTok's 24-h access token; `user_token_enc` = the ~60-day User token the sound search is documented against; `status` connected / expired / disconnected / deleted; one LIVE row per account (`social_accounts_live_idx`, partial unique on connected+expired)                                                                                                 |
| `scheduled_posts` | video × account                                                                       | `scheduled_at` (the instant) + `timezone` (display); `caption`, `sound` (a jsonb snapshot of the picked catalogue row, Instagram only), `ai_label` (the customer's "made with AI" tick, false by default — 0060, decision 0102); `status` scheduled / publishing / posted / failed / cancelled; `provider_container_id`, `provider_media_id`, `permalink`; `failure_kind` (closed set below), `failure_detail` (diagnostic, never shown), `failure_acknowledged_at`; `deferred_until` while waiting out Instagram's quota |

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

`app_config.social_posting` has three settings (decision 0102):

| value                                        | who sees the feature                                    |
| -------------------------------------------- | ------------------------------------------------------- |
| `{"access":"admins"}` — also an absent row   | admins only                                             |
| `{"access":"named","userIds":["<uuid>", …]}` | admins, plus the listed accounts (Meta's reviewer, say) |
| `{"access":"everyone"}`                      | every signed-in account                                 |

`getPostingAccess(db, userId)` answers `allowed` for an admin always, else per the key. **A value
that does not parse hides the feature** (admins still see it) — a typo must not turn a customer's
404 into an error page. Every page and route the web PRs add checks it and answers 404 to a hidden
account; the settings page renders no Integrations section. The one exception is Meta's
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

## Connecting an account (PR 2)

| surface                                     | what it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/home/settings` → **חיבורים**              | Rendered only for an allowed account. One Instagram card: each connected account with its picture, name and @handle, מחובר / פג תוקף — התחברו מחדש, ניתוק behind a confirm that counts the posts it will cancel; חיבור חשבון / הוספת חשבון lead to the pre-screen. `?social=connected\|none\|error` (with `n`, `id`) is the round trip's outcome line; `?return=` is carried through. No TikTok card (0102).                                                                                 |
| `/connect/instagram?return=&add=1`          | Tavnit's pre-screen (what Instagram needs, what Tavnit asks for), then המשך → the start route. **Outside `/home` on purpose:** every `/home` segment sits inside its `loading.tsx` Suspense boundary, where a `notFound()` streams into a response already sent as 200 — here a hidden or signed-out account gets a real 404, the same page an unknown path gets.                                                                                                                            |
| `GET /api/social/instagram/start`           | Writes `aiugc.social_oauth` (HttpOnly, SameSite=Lax, path `/api/social/instagram`, 10 min: a random state, the session's user id, the return path) and redirects to `https://www.facebook.com/v26.0/dialog/oauth` with `config_id` when `META_LOGIN_CONFIG_ID` is set, else the five-permission `scope`; `auth_type=rerequest` for הוספת חשבון. DRY_RUN skips Facebook and lands on the callback with a stub code.                                                                           |
| `GET /api/social/instagram/callback`        | Refuses a state it did not issue or issued to another session, before any exchange; `error=` (the window closed or refused) → the failure line. Otherwise code → short-lived → long-lived User token → `me` → every Page with an Instagram professional account, all upserted in one go (`upsertInstagramConnections`, both tokens sealed), then the return address, or settings with the count. Zero accounts → the "no professional account" line. The cookie is cleared on every outcome. |
| `POST /api/social/accounts/[id]/disconnect` | `disconnectSocialAccount`: tokens erased, the row kept, every post it can still call back cancelled — `scheduled`, or `publishing` while waiting out Instagram's quota with no container (`cancellablePost`, the same predicate the confirm counts and manual cancel uses) — and the count answered.                                                                                                                                                                                         |
| `POST /api/social/meta/data-deletion`       | Meta's callback, outside the switch and without a session. 400 and nothing touched unless `signed_request` verifies (HMAC-SHA256 over the encoded payload, the app secret); then `processMetaDataDeletion` — every row of that Facebook user, **disconnected ones included**, loses tokens and identity fields and becomes `deleted`, posts cancelled — and `{url, confirmation_code}` (32 hex digits: Meta documents an alphanumeric code).                                                 |
| `/social/deletion/[code]`                   | The public status page that url points at (the legal pages' shell, noindex): done, or no such request.                                                                                                                                                                                                                                                                                                                                                                                       |

Every social route answers a hidden **or signed-out** account with the same JSON 404 a missing
resource gets (a 401 would say the route exists); a failed auth read stays 503. Known limit: that
JSON body differs from Next's HTML 404 for a path that does not exist, so a determined prober can
still tell an API route exists — the pages do give the real 404.

**DRY_RUN writes real rows.** A local web runs with `DRY_RUN=1` against the production database
(one Supabase project), so חיבור חשבון there "connects" the stub's חשבון לדוגמה into production
`social_accounts` (it needs `SOCIAL_TOKEN_KEY` to seal its stub tokens). Disconnect it afterwards,
or don't click it.

## Env names (names only)

| name                                        | web (Vercel Production; `apps/web/.env.local` for the local live test)                    | box (`apps/worker/.env`) |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------ |
| `META_APP_ID`                               | yes                                                                                       | —                        |
| `META_APP_SECRET`                           | yes (code exchange, `appsecret_proof`, the deletion signature)                            | yes (`appsecret_proof`)  |
| `META_LOGIN_CONFIG_ID`                      | only if the app dashboard gives Facebook Login a configuration id instead of a scope list | —                        |
| `SOCIAL_TOKEN_KEY`                          | yes                                                                                       | yes                      |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | when TikTok is built                                                                      | when TikTok is built     |

Admin needs none. Bare values, one line each, and a Vercel change reaches only deployments created
after it (vault `env-values-differ-between-the-box-and-vercel`).

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

### J. "הוספת חשבון" and Facebook's Page list

- MEASURED: `auth_type=rerequest` re-asks for permissions the user **declined**; no Meta page ties
  it, or any `auth_type`, to the Page or Instagram-account picker
  (`facebook-login/guides/advanced/manual-flow`, the `FB.login` reference). The documented way for a
  user to change which Pages an app reaches is Facebook's own **Settings & privacy → Settings →
  Business Integrations → Tavnit → View and Edit** → tick the Page → Save
  (https://www.facebook.com/help/405094243235242); `me/accounts` then returns it.
- The code sends rerequest. **Whether Facebook's window shows the Page list again is a live check.**
  If it does not, the fallbacks are that Business Integrations path (one more pre-screen line — a
  Hebrew string to approve) and Meta's Instagram onboarding parameter
  `extras={"setup":{"channel":"IG_API_ONBOARDING"}}` from its own example — both UNVERIFIED.

The Graph API version in the code, `v26.0`, is the latest on Meta's changelog (introduced
2026-07-29); the manual-flow page's example still prints v25.0.

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
- (f) הוספת חשבון → does Facebook show the Page list again (runbook J)?
- (g) ניתוק → the count shown, the row's tokens read back null;
- (h) a return address: open `/connect/instagram?return=/home/renders`, continue → you land on
  `/home/renders`;
- (i) `DRY_RUN` back to 1.

**PR 3 — posting.** The box on `origin/main` after PR 3 merges, never a task branch (0102 planning
default).

- (j) a logged-out look at the Reel you published from the Explorer (whether role-user posts are
  public under Standard Access is unstated);
- (k) the first live post: an **A render** with a sound — Meta's handling of a stream-less MP4 is
  unstated in its docs;
- (l) a B render (the voice over the sound at 15) and a C render (the sound over the clip at 40),
  to judge the mix (0102);
- (m) two readings the docs do not give, recorded in the vault when seen: the container `status`
  Meta returns for a withdrawn `audio_id` (the `sound_unavailable` match is provisional until then)
  and the error `media_publish` returns when the account's quota filled between the limit read and
  the publish (a terminal `platform_refused` today; with the code known it joins the deferral path);
- (n) edit one pending post's time and cancel another;
- (o) the forced failure, last: remove Tavnit under Facebook's Business Integrations, let a pending
  post run, see `connection_expired`, reconnect;
- (p) `DRY_RUN` back to 1.

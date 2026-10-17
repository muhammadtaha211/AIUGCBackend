# PR 4.1 — the TikTok delivery email and the door: plan

Branch `feat/tiktok-delivery-email`, cut from `origin/main` (`f11ff04`, which carries PR 4 and the
0064/0065 push). The prompt is saved to `docs/claude/prompts/2026-10-17-tiktok-delivery-email.md`
and this plan to `docs/claude/plans/2026-10-17-tiktok-delivery-email.md` (both as PR 4 did).
Nothing is built, pushed or run live until you approve. The previous plan in this file (PR 4) is
done; this replaces it.

## Context

On the live run of 2026-10-17 TikTok's own notification was easy to miss, and a missed draft keeps
blocking new ones (TikTok takes five unfinished uploads per account per day). The one channel Tavnit
has to the owner outside the app is email. So: one email when a TikTok video reaches the inbox, the
same inbox path named everywhere Tavnit talks about it, a sentence on the TikTok-only time step, and
a trim on every environment string so a pasted newline can't break a provider key again.

MEASURED today (read-only SELECT on production, 2026-10-17, no token column read): two TikTok
accounts (one connected with its expiry, one disconnected); three TikTok posts — one `failed`
(`platform_refused`, scheduled 23:10 UTC on the 16th, its failure email sent 23:12 UTC), one still
**`delivered`** (23:25 UTC — a draft nobody finished, exactly the case this PR is for), one `posted`
with a post id **and a permalink** (23:30 UTC).

## Your five "unverified" items, answered

| Item                          | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Did the PR 4 close-out land?  | **No.** PR #107 is merged (`f11ff04`), but state-of-play still says "OPEN", docs/09 §Runbook still says the sandbox URL property is "not confirmed", 0115 §Still open lists the silent-file and URL-property questions, no live-run fact note exists, the TikTok strings still say DRAFT. Done first, as its own commit (below).                                                                                                         |
| Email log and a migration     | **No migration.** The log is `events` rows; `events.kind` is plain `text`. A new kind `post_delivery_email`, payload `{platform, postIds, outcome, resendId \| error}` — no address, no body, same as the failure email.                                                                                                                                                                                                                 |
| Post page URL                 | `https://tavnit.ai/calendar/{postId}` — route `(posting)/calendar/[postId]/page.tsx`. It opens only signed in as the post's owner, with the TikTok switch on; anyone else (signed out included) gets the same 404 the calendar gives, by design. The email says so in one line, as the failure email does, and a test pins that the email's path matches an existing route (the failure email once linked to a page that did not exist). |
| Resend ceiling                | `FAILURE_EMAIL_DAILY_CEILING = 20` per UTC day, counted from `events` rows of kind `post_failure_email` with `outcome = sent`. The count becomes "sent rows of **either** kind", so a delivery email spends the same 20; `heldByCeiling` is a per-sweep counter and gets a delivery twin. Failure emails are sent first in every tick.                                                                                                   |
| Schedule-page strings by pick | Instagram-only: caption step labelled «כיתוב», its own done line, no TikTok text. TikTok-only: the time step submits (no caption step), shows the inbox note, TikTok done line. Mixed: time step → caption step labelled «כיתוב (אינסטגרם)» → inbox note above submit → mixed done line. The new time sentence is gated on `mix.tiktok && !mix.instagram`, in the time step only.                                                        |

**One contradiction with the repo, reported, not improvised:** docs/09 (§t7, "after the audit, with a
public post") and the comment on `tiktokPermalink` say a sandbox post can't be public. The `posted`
row above has a post id and a permalink, i.e. the sandbox sent `publicly_available`, and you report
the post was public. Corrected in the close-out; t7 (does «צפייה בפוסט» open the player?) is then
your look now, not after the audit.

## Commit order

0. **Close-out of PR 4** (docs + one code comment, no behaviour). docs/09: the runbook paragraph —
   the sandbox keeps its own URL-properties list and needed its own domain verification
   (FOUNDER-REPORTED), t1–t6 passed 2026-10-17 (FOUNDER-REPORTED), the sandbox pair is on Vercel
   Production and the box, the box runs the PR 4 code with the failure email on, the post from the
   TikTok editor was public (with the MEASURED rows above), t7 corrected. New fact note
   `facts/tiktok-inbox-live-run-2026-10-17.md` (shaped like `instagram-connect-live-run-2026-10-12`:
   MEASURED columns, FOUNDER-REPORTED window, the exact read-only query). 0115: "Still open"
   resolved, a dated pointer. state-of-play: #107 MERGED, the live run, the sandbox state, the box.
   The `tiktokPermalink` comment corrected. If a vault note carried the "sandbox can't be public"
   claim, it moves to `falsified/` per CONVENTIONS.
   **One call of yours:** the TikTok strings were left DRAFT "for approval at PR review" and you
   merged. I'll mark them FINAL "approved by merge, 2026-10-17" — say so if that is not what you meant.
   The four strings this PR rewrites stay DRAFT.
1. Prompt and plan saved under `docs/claude/`.
2. **The trim** (`packages/core/src/config.ts`). One `const envString = z.string().trim().optional()`
   used by every string key; `WORKER_ID` keeps its default; `DRY_RUN` trims before its `=== "1"`
   (a stray newline can no longer silently turn dry-run off). `envSchema` exported so a test
   iterates `envSchema.shape` — a **new** key that skips the trim fails the test. Core test:
   leading/trailing spaces, `\n`, `\r\n`, tabs on each Meta, TikTok, Resend and database key.
   Not in scope, reported: `LOG_LEVEL` (logger.ts) and the `NEXT_PUBLIC_*` reads in `apps/web` don't
   go through this config.
3. **The delivery email** (core + worker, below).
4. **The path and the four places** (web + shared copy, below).
5. Docs/09, decision 0116, state-of-play.
6. Gate through `test-runner` (the seven commands); adversarial review workflow on the diff (races,
   once-per-post, ceiling and pause, switch leaks, Hebrew/RTL, the refactor); fixes; gate again;
   `pnpm repo-map` as its own commit; push; PR via the API (no gh). Stop for your merge OK.

## The delivery email

**Where.** The worker's sweep, never the publish job or the web (the failure email's rule: an email
fault can't touch a post). New `packages/core/src/pipelines/social-delivery-email.ts` with
`sweepPostDeliveryEmails(db, {workerId, now})`; the worker's existing 60 s `sweepFailureEmails` tick
calls the failure sweep, then this one, inside the same one-tick-at-a-time guard
(`apps/worker/src/index.ts`).

**What is shared (the one change to the failure email file).** The Resend ladder (idempotent-replay
409 counts as sent; 401/403 pauses an hour with no row; daily quota pauses to 00:00 UTC; a retryable
fault pauses 5 min; a refusal is logged and not retried), the pause state, the on/off state and the
ceiling count move into exported helpers in `social-failure-email.ts` (`sendPostEmail`,
`emailPaused`, `emailsSentToday`). The failure loop calls them. Behaviour-preserving, pinned by the
existing 24 tests, which stay untouched and green. Duplicating the ladder would have been the worse
option; I'm flagging it because it edits the failure path.

**Which posts, and "never twice".** A post is due when: `platform = 'tiktok'`, `status = 'delivered'`
(still unfinished — if the owner already posted it, an email would be noise), `delivered_at` within
the last 24 h, and no `post_delivery_email` row (`sent` **or** `refused`) already lists its id
(rows read for the last 48 h; the row is the "first transition" guard). `delivered_at` is written once,
by the one guarded `publishing → delivered` writer that the webhook, the job's poll and the nets all
share, so whichever moved the post, there is one sweep outcome. The log row is written after the
send; Resend's idempotency key (`post-delivery/{user}/{oldest due post id}`, 24 h) covers a crash
between the two.

**Fold.** One email per Tavnit account per sweep, listing every due post (ten shown, the rest
counted), oldest first, the id breaking ties. **No 24 h cooldown** (unlike failures): every delivered
post gets its email, a burst shares one. A post is held until the **newest** due post is 2 minutes
old (the failure email's settle time) so drafts that land together share one email — so the email
arrives about 2–3 minutes after the draft lands. One constant (`DELIVERY_EMAIL_QUIET_MS`); lower it
if you'd rather have it faster and risk a split burst.

**Switch, ceiling, off.** The TikTok switch (`getPlatformAccess(db, userId).tiktok`) is asked at send
time; a user it hides gets no email and no row. Same 20/day, shared with failure emails. A draft held
by the ceiling goes out after midnight UTC while still under 24 h old and unfinished. No key, dry
run, or a local worker against production → no call, no row (the same `failureEmailState`).

**Content** (`social-copy.ts`, pure, shared; the page it links to is below). The video's "name": renders
have no title, so it is the failure email's own line — «סרטון הוק + דמו של {business} · @{account}
בטיקטוק · {planned time in the post's zone}». One draft → the CTA goes to its post page
(`/calendar/{id}`); several → to the calendar (`/calendar`), the list names each. The path is a
numbered three-step list in the email and the same three phrases joined by arrows elsewhere (one
source constant).

## The path and the four places

One source in `social-copy.ts` (the web already imports it through `@aiugc/core/social-copy`):

- `תיבת דואר נכנס (Inbox)` ← `התראות מערכת (System Notifications)` ← `ההתראה “Your content from Tavnit is ready”`
  — each English chunk bidi-isolated (the file's existing `isolate`), the arrow joined line used on
  screen, the same three phrases numbered in the email. The notification's Hebrew wording was not
  observed, so the English is quoted and nothing else is invented.
- Shared finish line: «כדי להשלים אותו, בטיקטוק פותחים: {PATH}. מוסיפים סאונד וכיתוב ומפרסמים.»

The four places (all DRAFT):

1. **TikTok card lead** (`lib/social-ui.ts` `TIKTOK_CARD_LEAD`): «תבנית שולחת את הסרטון לטיקטוק. {finish line}»
2. **Schedule note** whenever TikTok is picked (`TIKTOK_INBOX_NOTE`): «לטיקטוק נשלח רק הסרטון. {finish line}»
3. **Post page, delivered** (`TIKTOK_DELIVERED_LINE`): «הסרטון נשלח לטיקטוק. {finish line}»
4. **The email** (below).

**The TikTok-only time step** (new, `mix.tiktok && !mix.instagram`, under the fields):
«במועד שבחרתם הסרטון מגיע לטיקטוק, ואליכם מגיע מייל תזכורת. הסאונד, הכיתוב והפרסום נעשים בטיקטוק. ״עכשיו״ שולח את הסרטון מיד.»
Scheduling itself is untouched (your reasoning in §2 stands); the mixed step gets no new sentence.

**The email (DRAFT, subject and body).**

- Subject: «הסרטון שלכם מחכה לכם בטיקטוק» / «{n} סרטונים מחכים לכם בטיקטוק».
- Opening: «הסרטון הזה הגיע לטיקטוק:» / «{n} הסרטונים האלה הגיעו לטיקטוק:» — then the bullet lines.
- «כדי להשלים אותו, בטיקטוק פותחים:» (plural «אותם») then 1. «תיבת דואר נכנס (Inbox)» 2. «התראות מערכת
  (System Notifications)» 3. «ההתראה “Your content from Tavnit is ready”. לוחצים עליה ונפתח העורך של טיקטוק.»
  then «שם מוסיפים סאונד וכיתוב ומפרסמים.»
- «סרטון שלא הושלם בטיקטוק חוסם שליחה של סרטונים חדשים לאותו חשבון, ולכן כדאי להשלים אותו.» (plural form for several)
- Link: «הפרסום בתבנית:» + button «לפרסום» (several: «כל הפרסומים בלוח הפרסומים:» + «ללוח הפרסומים»), then
  «הדף נפתח אחרי כניסה לחשבון בתבנית.» and the signature «תבנית».

**Hebrew rule held:** no Hebrew line uses «טיוטה»/«טיוטות». Your PR 4 change 1 forbids a Drafts
folder, and `social-schedule.test.ts:1001` already fails any TikTok line matching `טיוט|Drafts?`. "Draft"
in your prompt is English shorthand; the copy says «סרטון», as before.

## Tests (each file in its own vitest run; the gate through `test-runner`)

- Core `social-delivery-email.test.ts` (new): one email per post for **webhook-then-poll** and
  **poll-then-webhook** (driven through `processTiktokEvent` and the publish job against `FakeTiktok`);
  a second sweep sends nothing; fold of several drafts across accounts into one email (ten-line cap,
  oldest first); the 2-minute settle; posted/failed/cancelled/older-than-24 h/Instagram posts get none;
  a `refused` row is never retried; the **ceiling** (a mix of failure and delivery rows reaching 20 holds
  the delivery, counts `heldByCeiling`, and releases after UTC midnight); the **switch** (TikTok off →
  no email, no row; Instagram's switch irrelevant); pause on 401, replay on 409; no key/dry run/local
  worker. The email's text and HTML carry the path verbatim, the link, the escaped names, the plural
  forms, and no `טיוט`.
- Core `config.test.ts` (new): the trim, over `envSchema.shape`.
- Core `social-failure-email.test.ts`: untouched, must stay green (the refactor's proof).
- Web `social-schedule.test.ts` / `social-connect.test.ts` (extended): the path appears in the three
  web places; the time sentence renders for TikTok-only and for neither Instagram-only nor mixed; the
  existing no-`טיוט` guard still holds; a test that `/calendar/{id}` exists as a route.
- Screenshots (throwaway fetch-mock harness page, headless Chrome over CDP, deleted after with
  `apps/web/.next`; nothing written to production): the four copy places at 717 px and 375 px, plus
  the delivery email's HTML rendered the same way. The **received** email screenshot comes from your
  run after the merge.

## Docs and vault

docs/09: a "delivery email" section beside the failure email (rules, constants, log, off states),
the switch/ceiling lines, §TikTok (the path, the time step), checklist **t8** (the email), t7 corrected.
Decision **0116** (your six decisions with options and reasons: the email and why only email; why
scheduling stays and not "send everything now"; the trim; the "not now" list), dated pointers on 0115
and 0107. state-of-play: the PR, the owed items, the named next steps — **reminder after a day,
per-user email preferences, Instagram's deauthorize callback** — left as such.

## After merge — each its own OK

Box: `cd ~/AIUGCBackend && git pull && pnpm install && sudo systemctl restart aiugc-worker` (this
**opens the report's Next step**: the sweep runs on the box). Vercel deploys the copy by the merge. No
migration, no env change. Then: you schedule one TikTok video a few minutes ahead and receive one email
with the path, the account, the video line and a working link; the four copy places read as decided; two
deliveries in one sweep fold. **Heads-up:** the unfinished draft from the live run (delivered 23:25 UTC on
the 16th) is still `delivered`; if the worker restarts before 23:25 UTC on the 17th it counts as due and
rides in the first email (or gets its own) — expected, not a bug.

## What differs from, or needs a word on, your prompt

- The failure email file gets a behaviour-preserving extraction (shared send ladder) — the one edit to
  code that isn't new.
- The ceiling is shared as you said; failures go first each tick, but delivery can still use days'
  slots before a late failure (no reserve built — say if you want one).
- The email lags the draft by the 2-minute settle (above).
- "The video's name" is the service-and-business line; renders have no title.
- The sandbox did produce a public post — the repo's "can't" claim is corrected, and t7 is yours now.
- Owed, **reported and not edited** (legal pages held): `/privacy` §"שליחת מיילים" names only the
  sign-up and password mails (and still lacks the failure email). The sentence owed for this one:
  «כשסרטון שתוזמן מגיע לתיבת הדואר הנכנס של טיקטוק, תבנית שולחת לכתובת האימייל של החשבון מייל שמציין את
  שם הסרטון, את שם חשבון הטיקטוק כפי שקיבלנו אותו מטיקטוק וקישור לדף הפרסום; המייל נשלח דרך Resend, ובמערכת
  נשמר רק תיעוד של השליחה (מזהי הפרסומים והתוצאה), בלי הכתובת ובלי תוכן המייל.»

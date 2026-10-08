---
type: defect
status: verified
verified: 2026-09-29
method: 'Read-only, 2026-09-29, worktree docs/slim-claude-md at 6859fd4, Git Bash: MSYS_NO_PATHCONV=1 git grep -n "/openers" -- apps packages (without MSYS_NO_PATHCONV=1 Git Bash rewrites the leading-slash argument into a Windows path and the grep silently returns nothing); git grep -n "vo-script" -- apps packages; git grep -n "voScript" -- apps packages; git grep -n "StepAScript" -- apps packages; git grep -nw "OpenerClip" -- apps packages; git grep -n "personaOpeners" -- apps packages; git grep -n "generateVoScript" -- apps packages; git grep -n "generate_copy" -- apps packages; git log -S StepAScript --oneline -- apps/web/src/components/a-wizard/a-wizard.tsx; MSYS_NO_PATHCONV=1 git log -S "/openers" --oneline -- apps packages; grep -n -i "debit|credit" over copy.ts and the vo-script route; git log on both route files (2c66d6f, 21b7557, 10da873); plus reading both route files, apps/web/src/lib/api.ts, apps/web/src/middleware.ts, apps/web/next.config.ts, apps/web/src/lib/service-a.ts, service-b.ts, service-b-ui.ts, api-errors.ts, the scripts/[id]/audio and a-sets/steps routes, packages/core/src/pipelines/copy.ts, tts.ts, sets.ts, businesses.ts, packages/core/src/handlers.ts, storage.ts, db/index.ts, budget.ts, providers/anthropic.ts, apps/cli/src/index.ts, and docs/02, docs/04 and docs/06. Neither route was called; no DB was read.'
source: code
---

# Two retired formats still have a live web route each, and no client calls either

The tree said in several places that the retired Service A "full" format
([[0020-service-a-is-hook-and-steps-only]]) and the retired Service B opener format
([[0023-hook-is-a-remotion-animation-opener-clips-retired]]) are "reachable only from the CLI".
The **renders** are. Two web routes that **feed** those formats are not: each is deployed,
answers any signed-in account, and has no caller left in the UI.

Founder ruling, 2026-09-29, in the task prompt for branch `docs/slim-claude-md`: "Reachable only
from the CLI" becomes "no customer-facing path"; write this note; "Don't remove them." The routes
stay; this note is the record.

## 1. `GET /api/personas/[personaId]/openers`

`apps/web/src/app/api/personas/[personaId]/openers/route.ts` — added in `10da873` (2026-09-05),
unchanged since.

**MEASURED, by reading:**

- **Method.** `GET` only (`route.ts:22`).
- **Auth.** `requireUser()` (`route.ts:27-28`): 401 without a session, 503 when the auth read
  fails (`apps/web/src/lib/api.ts:45-49`). **No ownership check**, on purpose — the route's own
  comment calls opener clips catalog data like `/api/personas` (`route.ts:18-20`). A non-UUID id,
  or a missing or inactive persona, is a 404 (`route.ts:31`, `34-39`).
- **Reads.** `personas` (`route.ts:34-38`), the persona's `persona_images` (`41-51`), and every
  `opener_clips` row joined through them (`56-70`), filtered by `personaOpeners` to the active clips
  of the persona's current selfie (`route.ts:74`; `apps/web/src/lib/service-b.ts:133-140`). It
  mints one signed Storage URL per clip with a 3600s TTL (`route.ts:79`; `api.ts:22`; Supabase
  `createSignedUrl` at `packages/core/src/storage.ts:236`). The DB handle is the direct
  `DATABASE_URL` client (`packages/core/src/db/index.ts:22-28`), so RLS is not in play — the
  route's own checks are the whole gate.
- **Writes, spend.** None. No paid-provider call.
- **Callers.** None. `MSYS_NO_PATHCONV=1 git grep -n "/openers" -- apps packages` returns one line,
  a comment (`apps/web/src/lib/service-b-ui.ts:238`). The last client fetch was deleted from
  `apps/web/src/components/b-wizard/step-effect.tsx` in `aa63777` (2026-09-06), the commit that
  shipped [[0024-hook-effect-is-a-render-param-the-customer-picks]].

## 2. `POST /api/businesses/[businessId]/vo-script`

`apps/web/src/app/api/businesses/[businessId]/vo-script/route.ts` — from `2c66d6f` (2026-08-03);
last changed in `21b7557` (2026-09-23, AUTHZ-12).

**MEASURED, by reading:**

- **Method.** `POST` only (`route.ts:18`).
- **Auth and ownership.** `requireUser()` (`route.ts:23-24`), then `requireBusiness` (`28-29`):
  the business must be the caller's, or the caller must be an admin — 404 for a non-UUID or
  missing business, 403 otherwise (`api.ts:58-78`). The body is parsed at `route.ts:37-38`
  against `voScriptRequestSchema` (`apps/web/src/lib/service-a.ts:90-97`: `demoId` and
  `personaId` UUIDs, at most 12 advantages of at most 200 chars, optional `hookLineText` of at
  most 200). The demo must belong to the business (`route.ts:40-48`). `personaId` is not checked
  by the route; `generateVoScript` looks it up with no `active` filter
  (`packages/core/src/pipelines/copy.ts:291-298`).
- **Caps.** `assertAccountBudget(db, "llm_tokens", businessId)` then
  `assertBudget(db, "llm_tokens")` (`route.ts:34-35`), both before the body is parsed. An
  admin-role owner skips the per-account cap (`packages/core/src/budget.ts:87`); the platform cap
  has no bypass. Cap values were not re-measured here — [[token-and-money-budgets]] holds them,
  last verified 2026-08-23. The two residuals in [[authz-12-synchronous-copy-routes-uncapped]]
  (a concurrent burst overshoots; N accounts sum past the platform window) apply to this route
  unchanged.
- **Spend.** Yes, unless `DRY_RUN` (`copy.ts:326`). One Anthropic call per request:
  `generateVoScript` → `callClaude` with prompt `vo_script` (`copy.ts:338-341`) →
  `generateObject`, `claude-sonnet-4-6` (`claude-sonnet-5-5` since the switch,
  [[0093-every-claude-call-runs-on-sonnet-5-5]]), `max_tokens` 4096
  (`packages/core/src/providers/anthropic.ts:14`, `47-48`), on a client built with the SDK's
  defaults (`anthropic.ts:22`). The prompt is on disk (`prompts/vo_script/v1.md`–`v9.md`). Usage
  is recorded against the business (`copy.ts:33-39`).
- **Credits.** None debited. `grep -n -i "debit\|credit"` over `copy.ts` and the route returns
  one unrelated comment (`copy.ts:665`).
- **Reads, writes.** Reads the business questionnaire (throws without one, `copy.ts:284`;
  `packages/core/src/pipelines/businesses.ts:224-230`), the demo, which must be `ready`
  (`copy.ts:285`, `722-729`), the persona, and `words_per_second`. Writes one `scripts` row,
  `kind: "vo_script"`, carrying the `demoId` (`copy.ts:359-364`).
- **Callers.** None mounted. `git grep -n "vo-script" -- apps packages` finds one client call,
  `apps/web/src/components/a-wizard/step-script.tsx:82`, inside `StepAScript`;
  `git grep -n "StepAScript" -- apps packages` finds only that file (`:11`, `:38`, `:54`).
  `a-wizard.tsx` stopped importing it in `b404482` (2026-08-21, Phase 8a), so the component is
  orphaned. Every other hit is a test (`apps/web/test/authz-12-llm-caps.test.ts`,
  `apps/web/test/service-a.test.ts`) or a comment (`apps/web/src/lib/api-errors.ts:93`). Outside
  HTTP, `generateVoScript` is called by `aiugc copy vo` (`apps/cli/src/index.ts:546`) and by the
  `generate_copy` job handler (`packages/core/src/handlers.ts:45`), which nothing enqueues —
  `git grep -n generate_copy` finds only its registry entry (`handlers.ts:73`) and comments.

**REASONED, by reading, not exercised — how far the row it writes travels:**

- `requestAudio` accepts `kind: "vo_script"` (`packages/core/src/pipelines/tts.ts:45`), and
  `POST /api/scripts/[id]/audio` calls it for any script the caller owns
  (`apps/web/src/app/api/scripts/[id]/audio/route.ts:16-19`). That enqueues `synth_tts` —
  ElevenLabs, never debited (`tts.ts:60`), capped by `audio_preview_daily_limit` (`tts.ts:76`) and
  the per-account `tts_chars` ceiling (`tts.ts:94`). `synth_tts` runs the Service A length fit on
  any script with a `demoId` (`tts.ts:262-281`), so a web-made `vo_script` gets it.
- It stops there. `planAOutro` runs only in `createSet`'s non-steps branch and in `quoteASet`
  (`packages/core/src/pipelines/sets.ts:315-317`, `355`, `889`), and the one web set route
  hard-codes `format: "steps"`
  (`apps/web/src/app/api/businesses/[businessId]/a-sets/steps/route.ts:89`). The "full" render
  itself is CLI-only.

## Middleware

It neither gates nor exposes either route. The matcher covers `/api/*`
(`apps/web/src/middleware.ts:157-160`); on those paths middleware only refreshes the session and
returns the pass-through response — its redirects act on `/home`, `/` and `/start` alone
(`middleware.ts:126-154`). `apps/web/next.config.ts` has no rewrites, redirects or headers. Both
routes answer at their paths on the deployed web app to any signed-in account that sends a
hand-built request.

## The text this contradicted

At `6859fd4`. CLAUDE.md and `.claude/rules/service-b.md` were reworded to "no customer-facing path"
in the same branch; the rest is listed, not changed.

| Where                                         | Claim                                                                                    | Holds?                                                                                                                                                                                             |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md:9` (reworded)                      | "full" format reachable only from the CLI's `format: "full"`                             | The render, yes. Its script step is also `POST /vo-script`.                                                                                                                                        |
| `CLAUDE.md:10` (reworded)                     | opener format reachable only from the CLI's `render-b --opener`                          | The render, yes. `GET /openers` still lists the clips.                                                                                                                                             |
| `.claude/rules/service-b.md` (reworded)       | same as `CLAUDE.md:10`                                                                   | Same.                                                                                                                                                                                              |
| `0020-…:5`, `:25-27`                          | "full" reachable only from the CLI; "Nothing customer-facing can reach the retired path" | True of the UI and of the render; the HTTP route `POST /vo-script` still answers a hand-built request.                                                                                             |
| `apps/web/src/lib/service-b.ts:123-124`       | `personaOpeners`: the CLI's `render-b --opener` is the last caller                       | No. Its only non-test caller is the openers route (`route.ts:12`, `74`); the CLI cannot import `apps/web`, and `render-b --opener` takes a clip id directly (`apps/cli/src/index.ts:980`, `1013`). |
| `apps/web/src/lib/service-b-ui.ts:237-238`    | `OpenerClip`: the openers route is its last caller                                       | No. The route builds its objects inline (`route.ts:75-82`) and never imports it; `git grep -nw OpenerClip` finds only the declaration (`:239`).                                                    |
| `packages/core/src/pipelines/sets.ts:56`      | `"full"`: CLI-reachable only                                                             | Yes — the web passes `"steps"` (`a-sets/steps/route.ts:89`).                                                                                                                                       |
| `packages/core/src/pipelines/sets.ts:109`     | `openerClipId`: CLI-only                                                                 | Yes — the web render route never passes it (`service-b.ts:36`).                                                                                                                                    |
| `docs/02-jobs.md:103-104`                     | the length fit and `planAOutro` are reachable only from the CLI's `format: "full"`       | `planAOutro`, yes. The length fit, by reading, no (above).                                                                                                                                         |
| `docs/04-integrations.md:68-69`               | `generateVoScript` reads `words_per_second` only from the CLI's retired path             | No — and `docs/04-integrations.md:105-107` names `/vo-script` among the reachable callers of `generateVoScript`.                                                                                   |
| `docs/04-integrations.md:281`, `:422`, `:443` | the avatar outro, `RenderServiceAProps` and the `ServiceA` composition are CLI-only      | Yes — all behind `format: "full"`.                                                                                                                                                                 |
| `docs/06-cli-first.md:25-27`                  | the voiced-variant commands: nothing customer-facing reaches them                        | True of the UI; `aiugc copy vo`’s function is also behind `POST /vo-script`, which still answers a hand-built request.                                                                             |

[[0023-hook-is-a-remotion-animation-opener-clips-retired]] makes no such claim; it says only
that the code stays in the tree until a task removes it (`0023:38-39`).

## Blast radius

REASONED. No UI reaches either route, so no customer gets there by accident; it takes a
hand-built request from a signed-in account.

- `GET /openers`: no spend, no write. It lists, and signs for an hour, whatever active
  `opener_clips` rows exist for a persona's selfie — to any signed-in account. That was its
  intended scope while the format was live.
- `POST /vo-script`: one un-debited Sonnet call per request, bounded only by the two
  `llm_tokens` caps and their AUTHZ-12 residuals, plus a `vo_script` row the audio route will
  voice (un-debited ElevenLabs, capped). The cost is the founder's.

"No customer-facing path" is true of the UI, not of the HTTP surface: both routes answer a
signed-in customer's request.

## Not measured

- Whether `opener_clips` holds any active rows in production. With none, the openers route
  returns `{"openers": []}`.
- Whether either route has been called in production.
- The current `daily_caps` values.

## Fix shape

Founder ruling: leave both routes. Deleting them belongs to the unscheduled removal task that
[[0020-service-a-is-hook-and-steps-only]] (`0020:27-28`) and
[[0023-hook-is-a-remotion-animation-opener-clips-retired]] (`0023:73-74`) already name. Until
then, the wording in the table above is what changes.

## Related

- [[0020-service-a-is-hook-and-steps-only]], [[0023-hook-is-a-remotion-animation-opener-clips-retired]],
  [[0024-hook-effect-is-a-render-param-the-customer-picks]] — the retirements.
- [[authz-12-synchronous-copy-routes-uncapped]] — the fix that put the caps on `/vo-script`, and
  its two residuals.
- [[token-and-money-budgets]] — the cap values (verified 2026-08-23; re-measure before quoting).

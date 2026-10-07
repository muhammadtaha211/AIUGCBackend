---
type: decision
status: verified
verified: 2026-10-07
method: 'Founder decisions from the planning chat of 2026-10-07, recorded from that day''s task prompt ("Claude Code prompt: גוש טקסט (Service C), phase 1"), which states them as decided and not up for relitigation; the reasons are his. Phase 1 built on branch feat/service-c-text-block from origin/main 2a503a4 the same day — what exists is MEASURED in that tree: packages/core/src/pipelines/text-blocks.ts, packages/core/src/text-block.ts, packages/core/src/pipelines/copy.ts (generateTextBlocks), packages/remotion/src/ServiceC.tsx, apps/admin/src/app/(admin)/text-blocks/**, apps/admin/src/app/api/admin/text-blocks/**, supabase/migrations/0051_service_c_enums.sql and 0052_text_block_clips.sql, prompts/text_block/v1.md. No production query, no paid call for this note. Amended 2026-10-07: ruling 7 (the conditional push approval) from the planning chat of 2026-10-07/08, relayed by the phase 1b task prompt; the push measured by `supabase migration list` / `db push --dry-run` before and the read-only packages/core/.work/readback-0051-0052.ts at both ends.'
source: founder
---

# 0089 — Service C, גוש טקסט, exists; it is built before the hand-test reports; two phases with a stop between them

Five of the fourteen decisions the founder made on 2026-10-07, the ones about whether and when.
The format itself is [[0090-text-block-format-clip-once-with-its-own-sound]], the texts are
[[0091-text-block-texts-ten-skeletons-truth-rules-free-edit]], and the Service B tests that
closed the talking revamp are [[0092-service-b-revamp-tests-overlay-and-resync-routes-are-dead]].
Every claim carries one tag: **FOUNDER-REPORTED** (his statement or reasoning, not checkable
here), **MEASURED** (read in the tree), **REASONED** (inference from what is cited).

## 1. Service C exists and is called גוש טקסט

A banked clip under one Hebrew text block, no voice. **FOUNDER-REPORTED, the reasons:** he
wanted the format; it has no per-ad provider cost; and the talking revamp of Service B is closed
(0092). **The alternative weighed** was continuing that revamp — the seven tests in 0092 are what
closed it.

**MEASURED, what "exists" means in the tree after phase 1:** a third `service_kind` value `c`
(0051), its own bank table `text_block_clips` (0052), a prompt `text_block@v1`, a `ServiceC`
Remotion composition, a render creator `createTextBlockRender`, and two admin pages
(`/text-blocks`, `/text-blocks/new`) with six routes under `/api/admin/text-blocks`. Service A and Service B BEHAVIOUR is unchanged; the shared code that changed, besides the three places that
had to learn a third value (the `render_video` dispatch and release line in `pipelines/renders.ts`,
and the web library's `SERVICE_LABELS` / `RenderRow.service`): the one `loadFont` call now fetches a
second Heebo weight on every render, A and B included (a failed 500 fetch fails an A or B render
the same transient, retried way a failed 800 fetch always did — `docs/07-worker-box.md` §8);
`normalizeHookClip`'s body moved into a private `normalizeStoredClip` with the same signature and
behaviour; `assertContentPolicy` is exported from `pipelines/sets.ts`; the admin hook editor
gained an optional `children` prop and `readVideoMetadata` is exported.

## 2. It is built before the hand test reports

This reverses "hand test before any build" (chat of 2026-10-04/05, never in the vault).
**FOUNDER-REPORTED, the reasons:** no new paid service, no per-ad provider cost, and phase 1 is
how the test posts get made. **REASONED:** the clip is founder-made offline, the text is one
Anthropic call per batch at the existing copy rate, and the render is the existing Remotion
box, so the build adds no provider.

## 3. Two phases with a stop between them

Phase 1 (this note): admin-only — register clips, generate texts, edit, render, download. Phase
2: the customer wizard, credits, the dashboard card — a separate prompt, not started.
**FOUNDER-REPORTED, the reason:** his own posts decide whether opening it to customers is worth
building.

**MEASURED, how phase 1 keeps non-admins out:** every page and route lives in `apps/admin`,
whose middleware denies by default and whose every route calls `requireAdmin`
(`apps/admin/test/admin.test.ts` walks the API dir; `apps/admin/test/text-blocks-access.test.ts`
drives each new route with no session and with a customer session and asserts the 403). And
`createTextBlockRender` refuses a business that is not admin-owned, so a free render for a
customer is impossible by construction while no credit key exists.

**REASONED, what phase 2 still needs:** a web wizard over the same three core functions
(`generateTextBlocks`, `updateScriptText` + `textBlockTextError`, `createTextBlockRender`); the
credit key below, seeded before its schema key per `.claude/rules/migrations.md` rule 9, and the
quote/debit in place of the admin-only guard; a customer listing of active clips plus a SELECT
policy on `text_block_clips` (phase 1 leaves it RLS-on, no policies); the dashboard card; the
customer edit route; and the landing, `/pricing` and the legal pages (decision 5 below).

## 4. Price, for phase 2 only: 25 credits flat, under its own key

**FOUNDER-REPORTED.** Recorded; nothing built. **MEASURED:** `credit_costs` is a closed zod object
(`packages/core/src/pricing.ts`), so the key does not exist yet and no quote path reads one;
phase 1 charges nothing because `createTextBlockRender` never calls `quoteContext`.

## 5. Landing, `/pricing` and the legal pages stay as they are until after phase 2

**FOUNDER-REPORTED.** **MEASURED:** none of `apps/web/src/app/page.tsx`, `/pricing`, `/terms`,
`/privacy` changed on the branch.

## Where it lives

- `packages/core/src/text-block.ts` — the vocabulary and the burn check; `pipelines/text-blocks.ts`
  — the render creator; `pipelines/copy.ts` `generateTextBlocks`; `pipelines/bank.ts`
  `normalizeTextBlockClip` + the `normalize_text_block_clip` job.
- `packages/remotion/src/ServiceC.tsx`, `text-fit.ts` (`fitParagraphFontSize`, `TEXT_BLOCK_FONT`),
  `render.ts` `renderServiceC`.
- `apps/admin/src/app/(admin)/text-blocks/**`, `apps/admin/src/app/api/admin/text-blocks/**`,
  `apps/admin/src/lib/text-blocks.ts`.
- `prompts/text_block/v1.md`; migrations 0051, 0052.

## Amended 2026-10-07 (founder, planning chat of 2026-10-07/08, relayed by the phase 1b task prompt)

**FOUNDER-REPORTED, ruling 7: the migration push is approved, on conditions.** His words: "I
approve the spend and the pushes and everything after all the important things you mentioned are
confirmed". The task prompt named the conditions: 0052 turns row-level security on for
`text_block_clips`, `migration list` shows the remote at 0050, `db push --dry-run` lists exactly
0051 and 0052, and the test gate is green.

**MEASURED, 2026-10-07:**

- **The conditions held.** RLS is read in the file. The list showed 0000–0050 local == remote,
  with 0051 and 0052 local only. The dry run named exactly those two. The full seven-command gate
  was green on the pushed tree, 9f043be.
- **The push.** 0051 and 0052 were applied together by `db push`, and the ledger now holds 53 rows,
  0000–0052.
- **The read-back.** `service_kind` reads a, b, c, and `script_kind` ends with `text_block`.
  `text_block_clips` has 8 columns and 3 constraints, RLS on, 0 policies and 0 rows. The full
  record is the push log and `scripts/verify-migration-ledger.sql` §RESULTS, the 2026-10-07 entry.
- **What is still owed.** Production now holds the schema phase 1 runs on. The merge and the box
  pull and restart are the founder's; nothing on `main` reads the new values or table, so the
  order is safe.

## Related

- [[0090-text-block-format-clip-once-with-its-own-sound]] — the format.
- [[0091-text-block-texts-ten-skeletons-truth-rules-free-edit]] — the texts.
- [[0092-service-b-revamp-tests-overlay-and-resync-routes-are-dead]] — why Service B's revamp is closed.
- [[0036-auto-release-b-is-always-on]] — the release line a C render joins the A side of.
- [[0073-hook-text-colour-is-set-per-clip-by-the-founder]] — the colour vocabulary the bank reuses.
- [[production-migration-push-log]] — the 0051–0052 push, with its conditions.

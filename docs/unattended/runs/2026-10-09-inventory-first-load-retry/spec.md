# The inventory list offers «נסו שוב» when its first load fails

Branch type: fix Slug: inventory-first-load-retry

## 1. Goal

When the wizard's steps screen fails to load the inventory list for the first time, the customer sees the error line with a «נסו שוב» button. Clicking it requests the inventory again, and a success opens the list as if the first load had worked. Today the only way out is reloading the page.

This is also the first unattended cloud run. The fix is small on purpose, so the run exercises the protocol end to end.

## 2. Decided

1. Fix what the defect note describes and nothing more: show the existing retry button when nothing has loaded, wired to re-run the inventory request.
   - **Reason (planning's):** the note names this as the fix, and it is the smallest change.
2. No Hebrew string is added or reworded. The button reuses «נסו שוב» and the error line stays as it is.
   - **Reason (planning's):** Hebrew copy is the founder's to approve, and reusing existing strings needs no approval.
3. A retry happens only on the customer's click. No automatic retry and no backoff.
   - **Reason (planning's):** a failing server should not be hit in a loop.
4. The new retry behaves like the retries this screen already has for thumbnails and step cards.
   - **Reason (planning's):** one screen, one behaviour.
5. No new test tooling. If apps/web has no way to render a component and click it, do not add one: put the decision in a pure function beside the existing wizard helpers and test that. The click wiring is then mine to check (List 2).
   - **Reason (planning's):** no dependency changes in the first trial.
6. This is the first cloud run, so record what you observe. `log.md` gets a section "## First-run checklist" with one line per item of `docs/unattended/runbook.md`'s first-run list that a session can see for itself: items 1–4 and 6–10, each line starting `- Item N:`. Items 5, 11 and 12 are mine. Repeat the section in the closing report.
   - **Reason (planning's):** those claims come from the docs and are proven nowhere yet.

## 3. Unverified: confirm first

- The defect is still on main: in `apps/web/src/components/a-wizard/state-picker.tsx` the error block renders the «נסו שוב» button only when `inventory !== null`, and the effect that loads the inventory runs once per demo. From `docs/vault/defects/the-inventory-first-load-failure-has-no-retry-button.md`, read at 2fc4fe7 on 2026-10-02; PR #79 and others have merged since.
- A failed thumbnail page and a failed step-card fetch each show a «נסו שוב» button today (`state-picker.tsx`, `step-plan.tsx`). Same note.
- apps/web's existing tests can cover this fix without a new dependency, either by rendering the component or through pure helpers as `apps/web/test/service-a-ui.test.ts` does. If only pure helpers are possible, decision 5 applies and this is not a stop.

## 4. Limits

- Only `apps/web` and `docs/`. Nothing in `packages/`, the worker, `prompts/`, migrations or dependencies.
- The analysis route and its error body are not changed.
- The thumbnail and step-card retries are not changed.
- No new loading or error design beyond what this screen already shows.
- In the vault, only the defect note and what CLAUDE.md requires at end of task.

## 5. Acceptance criteria

### List 1: a command or test proves it

- **C1.** When the first inventory load has failed and nothing is loaded, the screen offers the «נסו שוב» retry. Proof: a new test, named in the plan, asserts it; `pnpm --filter @aiugc/web exec vitest run --fileParallelism=false <that file>` passes, and `log.md` holds the same command failing on the commit before the fix.
- **C2.** The retry re-runs the inventory request, and a success after it leaves the list shown with no error line. Proof: a new test at the deepest level the existing test setup reaches, named in the plan; the same command passes, and `log.md` holds it failing before the fix.
- **C3.** The retries that already existed behave as before. Proof: `git diff origin/main...HEAD --numstat -- apps/web/test` shows 0 deleted lines for every test file that existed on main.
- **C4.** No Hebrew string is added or reworded in the app. Proof: `git diff origin/main...HEAD -- apps/web/src | LC_ALL=C.UTF-8 grep -P '^\+(?!\+\+).*[\x{0590}-\x{05FF}]'` prints nothing, or every line it prints is an existing string moved unchanged, matched in `log.md` to the removed line it came from.
- **C5.** The change stays inside its limits. Proof: `git diff origin/main...HEAD --name-only` lists only paths under `apps/web/` and `docs/`.
- **C6.** The defect note records the fix. Proof: `grep -n "FIXED" docs/vault/defects/the-inventory-first-load-failure-has-no-retry-button.md` shows a dated FIXED section.
- **C7.** The first-run observations are recorded. Proof: `grep -c "^- Item " docs/unattended/runs/*-inventory-first-load-retry/log.md` prints 9.

### List 2: only you can judge it

- In a browser, with the inventory request blocked in DevTools, the steps screen shows the error line with «נסו שוב», placed and styled like the screen's other retry. Unblocking and clicking loads the list.
- The same at 375 px wide.

## 6. Paid-check cap: ₪0

No paid call in this run.

## 7. Shipping

- Migration: none.
- Box restart: none. The change is confined to `apps/web` (vault 0039).
- Anything else on your side: none. Vercel deploys web on the merge.

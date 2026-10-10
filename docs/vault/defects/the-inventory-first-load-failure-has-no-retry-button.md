---
type: defect
status: verified
verified: 2026-10-10
method: "MERGE (2026-10-10): `git log origin/main` shows 7f381e8, 'Merge pull request #85 from muhammadtaha211/claude/inventory-first-load-retry-kv24q9'; FOUNDER-REPORTED merged the same day. FIX (2026-10-09, on claude/inventory-first-load-retry-kv24q9 at 2ee3961): `pnpm --filter @aiugc/web exec vitest run --fileParallelism=false test/inventory-retry.test.ts` 2 failed on b72a9be (main's source) and 2 passed on 2ee3961; read after prettier: inventoryRetry at apps/web/src/lib/service-a-ui.ts:907, and in state-picker.tsx inventoryNonce :86, the effect's setError(null) :162, its deps [demoId, inventoryNonce] :187, the ungated button's routed click :249. ORIGINAL FINDING (2026-10-02, unchanged below): Read in apps/web/src/components/a-wizard/state-picker.tsx on feat/steps-fixed-2s-clips at 2fc4fe7: the error block renders the «נסו שוב» button only when `inventory !== null` (its comment: 'only an inventory failure (nothing loaded at all) keeps close-and-reopen'), and the mount effect that loads the inventory runs once per demo. apps/web/src/components/a-wizard/step-plan.tsx renders a «נסו שוב» button for a failed step-card fetch. apps/web/src/lib/api-errors.ts answers an unmapped error with 500 and GENERIC_ERROR. Not reproduced in a browser."
source: code
---

# A failed first load of the inventory list shows an error and no retry button

## FIXED 2026-10-09 on branch `claude/inventory-first-load-retry-kv24q9` (`2ee3961`); MERGED as PR #85 (`7f381e8`, 2026-10-10)

The fix is the one this note named (below). It is the first unattended cloud run's
(`docs/unattended/runs/2026-10-09-inventory-first-load-retry/`).

- **The button:** the error line's «נסו שוב» now renders with every error
  (`apps/web/src/components/a-wizard/state-picker.tsx:240-255`). Its click is decided by
  `inventoryRetry` (`apps/web/src/lib/service-a-ui.ts:907`). Once the list is in, it re-requests
  the missing thumbs, as before. With nothing loaded, it bumps `inventoryNonce` (`:86`).
- **The request:** the inventory effect is keyed on `[demoId, inventoryNonce]` (`:187`) and clears
  the error when it runs (`:162`). The loading spinner shows while the retry runs, and a success
  leaves no error line. It is the same shape as the step cards' retry in `step-plan.tsx`.
- **Copy:** no Hebrew string changed. The error line is as it was, including
  `INVENTORY_ERROR`'s «…רעננו את העמוד ונסו שוב.» above the in-place retry; the founder said to
  leave it (2026-10-09).
- **Proof:** `pnpm --filter @aiugc/web exec vitest run --fileParallelism=false
test/inventory-retry.test.ts` fails 2 of 2 on `b72a9be` (main's source) and passes 2 of 2 on
  `2ee3961`. apps/web has no DOM test setup, so the test pins the decision as a pure function and
  the wiring by reading the source. The click itself is **not reproduced in a browser**; that is
  the founder's check.

What follows is the defect as it stood on 2026-10-02.

Found 2026-10-02, answering the founder's confirmation before he merged PR #79. **NOT FIXED** then (fixed 2026-10-09, above).
Older than that build. **REASONED from the code, not reproduced.**

## What happens

- The wizard's steps screen makes three kinds of request to the analysis route: the inventory list
  (once, when the panel mounts), a page of thumbnails, and the step cards.
- When a read fails on the server (a database error), the route answers 500 with
  «משהו השתבש. נסו שוב בעוד רגע.».
- A failed thumbnail page and failed step cards each show a «נסו שוב» button.
- A failed inventory list shows only the error line. Nothing re-requests it; the customer has to
  reload the page.

## Why it matters more since 2026-10-02

The inventory request now also reads the analysis's footage instants, and a failure of that read
fails the request (it used to be absent; in the first cut of the 2 s build it fell back to clips
placed without instants, which the save would not have stored). One more query that can fail the
first load.

An analysis with **no** footage row is not a failure: its inventory opens, with every clip
starting at its moment.

## The fix, when wanted

Show the same button when nothing has loaded, wired to re-run the inventory request.

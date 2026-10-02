---
type: defect
status: verified
verified: 2026-10-02
method: "Read in apps/web/src/components/a-wizard/state-picker.tsx on feat/steps-fixed-2s-clips at 2fc4fe7: the error block renders the «נסו שוב» button only when `inventory !== null` (its comment: 'only an inventory failure (nothing loaded at all) keeps close-and-reopen'), and the mount effect that loads the inventory runs once per demo. apps/web/src/components/a-wizard/step-plan.tsx renders a «נסו שוב» button for a failed step-card fetch. apps/web/src/lib/api-errors.ts answers an unmapped error with 500 and GENERIC_ERROR. Not reproduced in a browser."
source: code
---

# A failed first load of the inventory list shows an error and no retry button

Found 2026-10-02, answering the founder's confirmation before he merged PR #79. **NOT FIXED.**
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

---
type: decision
status: verified
verified: 2026-10-15
method: "Founder request in chat, 2026-10-15, after PR #105 merged: 'in /plan it looks good but make the tiles all on the same row, not in a 2x2 formation; make the tiles smaller until you can do so'. MEASURED on branch feat/plan-row-of-four (from origin/main 41bdc37): apps/web/src/components/plans/plan-cards.tsx (the `compact` flag, the app grid); apps/web/test/pricing-intro-card.test.ts; headless Chrome against the dev server at localhost:3000 through a throwaway harness page with the /home shell's geometry (a w-64 sidebar from md, the pane zoomed 0.95, the plan page's max-w-5xl px-6 container) mounting the real PlanManager behind a mocked subscription read, at 1024, 1280, 1366, 1600, 1920 and 375 px; removed before commit."
source: founder
supersedes: "[[0113-the-intro-card-on-the-plan-page-estimates-and-prices-one-shekel-less]] §1 'two by two from lg at every width'"
---

# 0114 — `/home/plan`'s cards in one row of four, each a size down

**FOUNDER-REPORTED, 2026-10-15:** when the intro card shows on `/home/plan`, the four cards sit in
one row, not two by two. The tiles get smaller until they fit. He gave no reason.

**MEASURED, as built:** in the app, with the intro card, the row is `lg:grid-cols-4` with `gap-4`,
and every card is drawn `compact`:

- padding `p-4`;
- the name `text-base`;
- the price `text-3xl`, its line `text-[13px]` and kept on one line;
- the rate `text-lg`;
- the estimate `text-[13px]`;
- `md` buttons.

Nothing else changes: `/pricing`, and `/home/plan` for an account without the card (three across),
keep today's sizes.

**MEASURED, the fit** (the pane is capped at `max-w-5xl`, so a card is the same width from 1280 up):

| Window  | Rows | Card width | Price on one line | Anything outside its card | Sideways scroll |
| ------- | ---- | ---------- | ----------------- | ------------------------- | --------------- |
| 1024 px | 1    | 169 px     | yes               | no                        | none            |
| 1280 px | 1    | 220 px     | yes               | no                        | none            |
| 1366 px | 1    | 220 px     | yes               | no                        | none            |
| 1600 px | 1    | 220 px     | yes               | no                        | none            |
| 1920 px | 1    | 220 px     | yes               | no                        | none            |

Below `lg` the row is a single column (the phone layout, and the 768–1023 px band with the sidebar).
There, at 375 px, the cards are the same compact size, full width.

**REASONED, one cosmetic edge:** at 1024–1279 px the intro card's `150 קרדיטים, בתוקף 30 יום`
wraps its last word onto a second line. From 1280 px it is one line.

## Related

[[0113-the-intro-card-on-the-plan-page-estimates-and-prices-one-shekel-less]] ·
[[0112-pricing-names-three-services-and-shows-the-intro-card]] ·
[[0011-dashboard-content-renders-at-95-percent]]

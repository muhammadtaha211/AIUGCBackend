---
type: decision
status: verified
verified: 2026-09-08
method: "founder decision in the task brief, 2026-09-08; code under apps/web/src/app/home/settings/"
source: founder
---

# 0034 — פרופיל and הגדרות open the same page: `/home/settings`

## The decision

The account menu (`ProfileMenuItems` in `apps/web/src/app/home/sidebar.tsx`) had two inert rows,
פרופיל and הגדרות. The founder's call: both go to ONE page, `/home/settings`, which holds

- **החשבון** — the email and a sign-out button;
- **העסקים שלי** — one card per business the user owns (all of them, not only the switcher's
  selection), each with an inline, single-form questionnaire editor: business name, category,
  product name and kind, what it does, link, up to 8 benefits, wow, audience, tone. Save is a
  PATCH to `/api/businesses/[businessId]` — the first web route that UPDATES a questionnaire.
  Until 2026-09-08 only `POST /api/onboarding/complete` existed, and it creates.

## Options

1. Two pages — a profile page for the account, a settings page for the businesses.
2. One page with both sections (chosen).

The brief recorded the decision, not a reason. What the page holds explains the shape: the account
block is one line and a button, so a page of its own would be nearly empty.

## What the route does NOT accept

`demo_notes`. `businessPatchRequestSchema` (`apps/web/src/lib/settings.ts`) omits the key from the
questionnaire shape, and zod strips keys it does not know — so the payload reaching core's
`setQuestionnaire` has no `demo_notes`, which is the exact condition under which it keeps the
stored ones (`packages/core/src/pipelines/businesses.ts`). An explicit `demo_notes: []` from a
client would otherwise erase the customer's answered moments. Pinned by
`apps/web/test/settings.test.ts`; the core half by `packages/core/test/demo-step-plans.test.ts`
("a questionnaire resubmit without demo_notes keeps them").

## Related

- The page reads `businesses` through Drizzle/`getDb()` with an explicit `owner_user_id` filter,
  not supabase-js — [[data-api-surface-is-two-tables]] is unchanged (same two tables, same six
  supabase-js call sites).
- Renaming the SELECTED business calls `router.refresh()` once so the switcher shows the new
  name. The refresh hazard in `balance-context.tsx` is a wizard hazard; this page is not a wizard.
- Not built, by the brief: delete-business, editing `demo_notes`, any new column or migration.
- The four category cards' copy moved from the wizard's first step into `BUSINESS_TYPE_OPTIONS`
  (`apps/web/src/lib/onboarding.ts`) so the editor and the wizard cannot drift.

_(Pointer 2026-10-11: the founder decided on 2026-10-10 that this page also holds **חיבורים**, the
Integrations section — connected Instagram (and later TikTok) accounts with connect, add another
and disconnect — between the plan row and העסקים שלי. Decision
[[0101-tavnit-schedules-and-posts-to-instagram-and-tiktok]]; the section itself lands in that
task's web PR, not yet in the tree.)_

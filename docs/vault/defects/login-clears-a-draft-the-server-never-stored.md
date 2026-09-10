---
type: defect
status: verified
verified: 2026-09-03
method: "code read at 23a06e1 — apps/web/src/app/login/login-form.tsx:35-49: `loadDraft()` at :37, POST at :40-44, `if (response.ok) clearDraft()` at :45. apps/web/src/app/api/onboarding/complete/route.ts:69-89: the owner guard at :71-80 returns `{ok:true, businessId}` at :78 before `setQuestionnaire` at :89 is ever called. NOT reproduced: no account with an existing business was driven through the flow."
source: code
---

# Signing in wipes a wizard draft the server threw away

## FIXED 2026-09-10 (`4252201`, with its vault edits backed out in `b6b3dd4`)

**The rule that landed is the defect CLASS, not this corner of it: never clear on a response you
cannot interpret.** Everything else follows from that.

`POST /api/onboarding/complete` now discriminates. Every 200 carries `stored`:
`route.ts:100` returns `{ ok: true, businessId, stored: false }` from the existing-owner guard
(`:91-102`) — before `setQuestionnaire` — and `:113` returns `stored: true` after the create path
writes at `:111`. The two used to be indistinguishable, which is the whole defect. The 400s
(`:65`, `:69`) carry no `stored` key at all.

The decision moved out of the component into `apps/web/src/lib/onboarding.ts` so it could be
unit-tested — there is no DOM here to render a component in. `postParkedDraft` (`:242-260`) is where
`clearDraft()` now lives, at `:254`, reached **only** through the strict predicate `draftWasStored`
(`:202-206`, module-private), which requires `body.stored === true` and nothing looser. An
unparseable 200 goes through `.catch(() => null)` at `:252`, fails the predicate, and returns
`"parked"` — draft kept.

`login-form.tsx` no longer clears anything; `grep clearDraft` on it returns nothing. It awaits the
handoff at `:47` and routes on it at `:50`: `"parked"` → `/home/new-business?draft=1` with the draft
**kept**, anything else → `/home`. A non-200 or a thrown fetch is a third value, `"none"`, which
also leaves the draft alone.

`onboarding-flow.tsx` in `mode: "additional"` seeds once at mount from the marker (`:105` `seeded`
ref, `:107-119`, via `additionalWizardDraft` → `loadDraft()`), and spends it at `:194` only after
`completeAdditional` succeeds. The `useRef` is load-bearing rather than stylistic: the sidebar link
to `/home/new-business` with no query is a same-route navigation that flips the prop true→false
**without unmounting**, so reading the prop would strand the copy. It stays in-memory-only by
design, per [[0015-signed-in-without-business-lands-on-new-business]].

Guarded by two new test files, 15 cases: `apps/web/test/onboarding-draft.test.ts` (11) and
`apps/web/test/onboarding-complete-route.test.ts` (4) — the first test in `apps/web` ever to import
a route handler, which became possible when `apps/web/vitest.config.ts` supplied the `@/` alias
(`9598b49`) and retired [[web-route-handlers-cannot-be-unit-tested]].

**No mutation testing was done, or at least none was recorded.** Nothing in `4252201`'s message, in
either test file, or anywhere in `apps/web` mentions mutants — this is stated explicitly because the
vault has twice caught a commit message claiming mutation runs with no artefact behind them
([[8a-wizard-shell-and-read-only-plan]], [[8d-demo-step-rework]]). What the tests honestly give is
negative-case coverage: the route test asserts `setQuestionnaire` and `createBusiness` are never
called on the `stored: false` path, and the draft test loops four malformed 200 bodies.

**Two SHAs, not one.** `4252201` also carried two vault files it should not have — a `falsified/`
note and a `status: superseded` stamp — and `b6b3dd4` reverted both byte for byte. The fix as it
stands in the tree is the pair. (The vitest supersession above was written later, on the founder's
explicit instruction.)

---

`login-form.tsx` finishes a leftover wizard draft after a password sign-in, and treats any 200 as
"saved":

```ts
const draft = loadDraft(); // :37
if (draft) {
  try {
    const response = await fetch("/api/onboarding/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
    });
    if (response.ok) clearDraft(); // :45
  } catch {
    // Leave the draft in place; /home works without it.
  }
}
```

Its comment says _"The server is idempotent — existing owners just get their business back."_ That
is true, and it is the problem: `/api/onboarding/complete` is idempotent **by owner, not by
content**. `route.ts:71-80` looks up any business owned by the caller and returns it at `:78` —
before `setQuestionnaire` at `:89` ever runs. The posted answers are discarded server-side, and the
response is still `200 {ok: true, businessId}`.

## Failure scenario

1. Someone already owns `עסק א`, created weeks ago. Signed out in this browser.
2. They land on the marketing page and go through `/start` for a **second** product, `עסק ב` — five
   steps, draft saved at `step: 4`.
3. On the last step they use the `כניסה` link because they remember they have an account.
4. Email + password on `/login`. `:37` loads the `עסק ב` draft and POSTs it.
5. `route.ts:77-79` finds `עסק א` and returns it. `עסק ב`'s answers are never written.
6. `:45` sees `response.ok` and calls `clearDraft()`. **The draft is gone from localStorage.**
7. `/home` renders the dashboard for `עסק א`.

No error, no prompt. Nothing on the screen ever said the answers were ignored, and there is no copy
of them left anywhere.

A _partial_ draft does not hit this — `questionnaireSchema` requires all four fields, so the route
400s at `route.ts:47-50`, `response.ok` is false, and the draft survives. It is specifically the
**completed** second questionnaire that is destroyed.

## Not caused by this branch, but newly reachable

Pre-existing code, unchanged since before `03fc7f9`. `5646529` adds a second automatic funnel into
`/login` while a live draft sits in localStorage: a failed Google round-trip now lands there. The
draft is untouched by that redirect itself — it is the password sign-in on the page they arrive at
that spends it.

## The fix shape

Either have the route report that it stored nothing (a flag on the 200, or a distinct status) and
have the client keep the draft, or have the client stop clearing on a response it cannot interpret.
The `allowCreate` path is not the answer here: the user has not asked for a second business.

Related: [[0015-signed-in-without-business-lands-on-new-business]] records the sibling case, a draft
orphaned rather than wiped.

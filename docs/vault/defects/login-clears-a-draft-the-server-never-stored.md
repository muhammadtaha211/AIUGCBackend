---
type: defect
status: verified
verified: 2026-09-03
method: "code read at 23a06e1 — apps/web/src/app/login/login-form.tsx:35-49: `loadDraft()` at :37, POST at :40-44, `if (response.ok) clearDraft()` at :45. apps/web/src/app/api/onboarding/complete/route.ts:69-89: the owner guard at :71-80 returns `{ok:true, businessId}` at :78 before `setQuestionnaire` at :89 is ever called. NOT reproduced: no account with an existing business was driven through the flow."
source: code
---

# Signing in wipes a wizard draft the server threw away

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

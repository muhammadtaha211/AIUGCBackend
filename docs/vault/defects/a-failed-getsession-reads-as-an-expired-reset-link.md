---
type: defect
status: verified
verified: 2026-09-10
method: "Code read at apps/web/src/app/reset-password/reset-password-form.tsx:27-30, found while sweeping every non-getUser auth call for the same shape during the close of [[auth-getuser-errors-read-as-signed-out]]. The getSession failure shape itself was NOT measured — only getUser's was ([[getuser-resolves-an-error-when-signed-out]]) — so the severity below is read from the code path, not reproduced."
source: code
---

# A failed `getSession()` on `/reset-password` reads as an expired link

The third member of the "an error is not an empty result" family, after
[[a-failed-businesses-query-reads-as-no-businesses]] and
[[auth-getuser-errors-read-as-signed-out]]. Not fixed — it is a different call
(`getSession`, not `getUser`) on a client component, and the task that found it was scoped to
`getUser`.

```ts
// apps/web/src/app/reset-password/reset-password-form.tsx:27-30
createClient()
  .auth.getSession()
  .then(({ data }) => setSession(data.session ? "ok" : "missing"))
  .catch(() => setSession("missing"));
```

Two ways the same guess gets made: `error` is dropped from the resolved result, and the
`.catch` maps a rejection to `"missing"` as well. `"missing"` renders the "this link is no
longer valid" state, so a transient failure tells someone mid-password-reset that their link
expired. The link is single-use and mailed, so the recovery is to request another one — the
user pays for our failure with a round trip through their inbox, and a second failure says
the same thing again.

Worse than the `/home` version in one respect: this is the surface someone reaches **because
they are already locked out**. Better in another: nothing is created, so unlike the
`businesses` defect there is no duplicate row at the end of it.

## What a fix would look like

Not a copy of `authedUser`. That helper is server-only and throws to an error boundary;
this is a browser component and the honest client-side answer is a third state
(`"unknown"` → "we could not check the link, try again") beside `"ok"` and `"missing"`,
plus reading `error` rather than only `data`. The classification is the same one
[[getuser-resolves-an-error-when-signed-out]] establishes: only
`AuthRetryableFetchError` / `AuthUnknownError` mean the read failed.

Whether it is worth doing is a founder call — password reset is live but has never been
observed failing this way.

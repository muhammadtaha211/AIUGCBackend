---
type: fact
status: verified
verified: 2026-09-21
method: "Three env mistakes made and fixed on go-live day, 2026-09-21, each recorded at the strength it was actually established. Box side: the founder read the RUNNING process's environment with `tr '\\0' '\\n' < /proc/$(systemctl show aiugc-worker -p MainPID --value)/environ` and reported what the value looked like there; nothing printed a key. Vercel side: the 503 was observed in the browser's request headers, the log lines are the founder's reading of the Vercel log. This session then reproduced both failure MECHANISMS locally against the repo's own code with literal strings and no secrets: `JSON.parse` on a single-quoted map, and `Number()` of a quoted id, run with `node -e`. Code cites are from the tree at 7ec6005: packages/core/src/config.ts:16-19, apps/web/src/app/api/account/checkout/route.ts:40-46, apps/web/src/lib/billing.ts parseCheckoutPages, packages/core/src/gateways/sumit.ts credentials()."
source: founder + code + browser
---

# The same value has to be typed differently in `apps/worker/.env` and in Vercel

Tags: **[MEASURED]** run or read this session; **[FOUNDER-REPORTED]** his reading of a log or a
dashboard; **[REASONED]**; **[UNVERIFIED]**.

Three separate env mistakes cost most of go-live day 2026-09-21, and only the third reached a paying
customer ([[../defects/sumit-return-failure-invited-a-second-payment]]). They are one family: the
same JSON string, correct in one place, is wrong in the other.

## The rules

- **`apps/worker/.env` on the box: one line per value.** Quotes optional. A value that wraps across
  lines is broken even inside quotes.
- **Vercel: bare values only.** No surrounding quotes, no `NAME=` prefix, no line breaks. Vercel
  stores what you paste, verbatim.
- **A Vercel env change reaches only deployments created AFTER it.** Changing a variable does not
  touch the running deployment; redeploy.
- **A checkout click proves only the pages map.** The credential VALUES are read in exactly one
  place, `HttpSumitClient.credentials()`, reached from `/api/billing/sumit/return`, from an upgrade
  through `/api/account/subscription/change`, and from the `billing_renewals` job on the box
  **[MEASURED]**. Their mere PRESENCE is checked more widely — `sumitConfigured()` runs on every
  plan change, downgrades included — but presence is a boolean and a malformed value passes it. So
  "checkout redirected to Sumit" is not evidence the keys work, which is exactly how the third
  mistake survived to a real payment.

## 1. The box: a value wrapped across lines inside its quotes

`SUMIT_CHECKOUT_PAGES` was pasted into `apps/worker/.env` split across lines, inside single quotes.
In `/proc/<pid>/environ` the value **broke at position 77, right after `"pro":`**, and `JSON.parse`
failed on it **[FOUNDER-REPORTED from the process's own environment]**. The process value **began
with `{`**, so systemd had stripped the quotes **[FOUNDER-REPORTED]** — from which: single quotes do
not protect a line break in an `EnvironmentFile`, they are removed and the break stays
**[REASONED, systemd.exec EnvironmentFile rules]**.

**The worker started anyway, and would have kept running forever** **[MEASURED, from the code]**:
`SUMIT_CHECKOUT_PAGES` is `z.string().optional()` (`packages/core/src/config.ts:19`), so any string
passes the env schema, and the only reader of the map in the whole tree is
`apps/web/src/app/api/account/checkout/route.ts` — no worker code path parses it. A broken pages map
on the box is invisible until someone looks.

Retyped on one line **[FOUNDER-REPORTED]**.

## 2. Vercel: the same value saved with its quotes

The pages value was saved on Vercel as `SUMIT_CHECKOUT_PAGES='{…}'` — quotes included.
`POST /api/account/checkout` answered **503 on all three tiers** **[MEASURED, request headers]** and
Vercel logged `SUMIT_CHECKOUT_PAGES is set but is not a JSON map of https URLs`
**[FOUNDER-REPORTED]** — which is verbatim the route's own line (`route.ts:43`) **[MEASURED]**.

Reproduced here **[MEASURED]**: `JSON.parse` on that exact shape throws at the **first character**
(`Unexpected token '''`), so `parseCheckoutPages` returns `null`, the route logs and returns
`jsonError(503, PAYMENTS_SOON)` → "התשלום המקוון יופעל בקרוב.". The bare JSON parses. Saving it bare
fixed it **[FOUNDER-REPORTED: checkout then redirected to Sumit]**. One shape logs nothing at all:
the line is guarded on `if (raw && !pages)`, so an **empty-string** value 503s silently **[MEASURED,
from the code]**.

Note what this 503 does NOT do: it returns **before** `createCheckoutIntent`, so nothing is written
— which is why the two intents that do exist prove the map was already fixed by then
([[first-real-purchase-2026-09-21]]).

## 3. Vercel: the credentials, and the one that cost a customer

With the pages fixed, checkout redirected and the payment went through. Then the return leg's
`/billing/payments/get/` answered **"Invalid Credentials (CompanyID/APIKey are incorrect)"**
**[FOUNDER-REPORTED, Vercel log with a stack]**, the route landed on `?checkout=failed`, and a real
₪150 payment was told to try again. Re-entering `SUMIT_COMPANY_ID` and `SUMIT_API_KEY` bare and
redeploying fixed it **[FOUNDER-REPORTED, proven by the replay in [[first-real-purchase-2026-09-21]]]**.

**What the malformation actually was, nobody saw — [UNVERIFIED].** One sufficient cause, reproduced
**[MEASURED]**: `credentials()` does `Number(env.SUMIT_COMPANY_ID)` after a presence-only check
(`packages/core/src/gateways/sumit.ts`), and `Number("'123'")` and `Number("SUMIT_COMPANY_ID=123")`
are both `NaN`, which `JSON.stringify` sends as `"CompanyID": null`. A quoted value and a pasted
`NAME=value` are therefore indistinguishable at the API from a missing company id.

**Nothing validates the shape of these values** at boot or at first use — the check is presence
only. The symptom is now safe (a failed verification says "being confirmed", not "try again"), but
the misconfiguration still breaks every checkout, politely.
([[../defects/sumit-return-failure-invited-a-second-payment]] §"What this does NOT fix".)

## Related

- [[../defects/sumit-return-failure-invited-a-second-payment]] — what mistake 3 did to a customer
- [[first-real-purchase-2026-09-21]] — the purchase that ran through all three
- [[sumit-real-org-configuration]] — the values themselves (the pages; never the keys)
- `docs/07-worker-box.md` §13 — the after-an-`.env`-change checks, none of which prints a key

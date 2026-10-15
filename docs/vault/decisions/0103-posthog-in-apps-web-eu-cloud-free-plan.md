---
type: decision
status: verified
verified: 2026-10-11
method: "Founder decisions 1, 5 and 7 of §2 of the task prompt 'PostHog on apps/web (visit counts, session recordings, browser errors)' (2026-10-11), each given as 'Decided on 2026-10-11 … Not up for relitigation', with his reasons; the dashboard address he filled in (eu.posthog.com/project/302007/…). MEASURED in the tree at feat/posthog-web: apps/web/package.json (posthog-js 1.434.15, exact), apps/web/src/lib/analytics.ts (analyticsSettings, posthogOptions), apps/web/src/lib/analytics-client.ts (the only runtime import), apps/web/test/analytics.test.ts (the boundary tests), and posthog-js 1.434.15's own source in node_modules for every SDK behaviour cited. PostHog's pages read 2026-10-11 for where the EU cloud keeps data and who runs it."
source: founder
---

# 0103 — PostHog, EU cloud, free plan with no card, in apps/web only; browser errors through it; no flags, experiments, surveys, server capture, source maps or install wizard

Tags as in 0068: **FOUNDER-REPORTED** (his ruling, statement or reasoning), **MEASURED** (read in
the tree, in the SDK's source, or run), **REASONED** (inference from what is cited), **PLANNING
DEFAULT** (the planning assistant's, kept unless he strikes it at PR review). The other half of the
prompt's decisions (what is recorded where, identity, hiding, the notice) is
[[0104-what-posthog-records-and-what-never-leaves]].

## 1. PostHog, EU cloud, free plan with no card, in `apps/web` only

**FOUNDER-REPORTED, decision 1.** His reason: an account that never pays looks the same in the
database whether the price put them off or a bug stopped them, and with practically no users this
is the cheapest time to add it. He asked for the new service, so locked decision #10 is met by his
request, not reopened.

**FOUNDER-REPORTED:** he created the PostHog account; the dashboard address he reported is
`eu.posthog.com/project/302007/…` (the EU cloud). Nothing else about the account was reported.

**MEASURED, the boundary:**

- `posthog-js` is a dependency of `apps/web` only, pinned exactly at **1.434.15** (published
  2026-09-26, the newest release more than two weeks old on 2026-10-11). Exact, not a caret,
  because the masking defaults this setup leans on are the SDK's and can move between releases.
- It is imported at run time in one file, `lib/analytics-client.ts`, as a dynamic
  `import("posthog-js/full/no-external")`: recording and error capture are bundled in and no script
  is ever loaded from PostHog's CDN. Every other mention is `import type`. A test pins both.
- `apps/admin` has no dependency on it and no source mentions it; a test reads both.
- The host is the EU cloud, `https://eu.i.posthog.com`. `analyticsSettings` refuses any other host
  (analytics off), except a loopback one for the local hiding check.
- **No key, nothing loads** — as with `SENTRY_DSN` (0037): with `NEXT_PUBLIC_POSTHOG_KEY` unset or
  blank the SDK is never imported and nothing is requested. Pinned in a test.

**MEASURED from PostHog's own pages (2026-10-11), not decided here:** the EU cloud stores data in
Frankfurt (AWS eu-central-1); the processor in its DPA is PostHog, Inc. (San Francisco); its DPA
§10.2 and its AI FAQ say staff and sub-processors may reach the data from outside the EU, the US
included, while its `/docs/privacy` page says EU-cloud data "never leaves EU jurisdiction". The two
disagree; `/privacy` states the DPA's version. Free plan: no card, 1M events a month, events kept 1
year, recordings up to 30 days. UNVERIFIED: the free recordings allowance (search snippets only),
exception retention, PostHog Inc.'s place of incorporation.

## 2. Browser errors are captured — beside 0037, not reopening it

**FOUNDER-REPORTED, decision 5.** The web apps still never load Sentry, and server routes still
report nowhere.

**MEASURED:** `capture_exceptions` with uncaught errors and unhandled rejections on, console errors
off; the three error boundaries (`app/error.tsx`, `app/home/error.tsx`, `app/global-error.tsx`)
call `captureError`, because a boundary's catch never reaches `window.onerror`. An error's message
keeps its words and loses any address in it (`scrubException`). No source maps, so stacks stay
minified. **REASONED:** the browser code builds no thrown message from customer content (the recon
of 2026-10-11 found `apiFetch` never throws and the one client `throw` is a fixed string), so the
message is not filtered beyond addresses. A dated pointer on 0037 leads here.

## 3. Not now

**FOUNDER-REPORTED, decision 7:** feature flags, experiments, surveys, server-side capture, source
maps, PostHog's install wizard.

**MEASURED:** `advanced_disable_feature_flags: true` (it also stops the `/flags` request, which
carries the first address seen and bypasses `before_send`), `disable_surveys: true`, no server-side
SDK, no source-map upload, no `instrumentation-client.ts`, and the wiring written by hand.

## Planning defaults (PLANNING DEFAULT, unstruck at the time of writing)

- Requests go straight to PostHog, with no proxy through our domain. A visitor with a blocker is
  not tracked. **MEASURED:** `api_host` is PostHog's; there is no rewrite.
- Where recording runs is decided in the repo, not in PostHog's dashboard. **MEASURED, with one
  limit the SDK imposes:** the SDK refuses to record at all unless the project's session replay is
  on (it reads that from the remote config; `startSessionRecording()` cannot override it), so that
  master switch is the founder's, and its sampling, minimum duration and URL triggers decide WHICH
  sessions record. Every switch that decides what is sent is pinned locally and wins over the
  dashboard (`posthogOptions`), except network capture, which the dashboard can turn on regardless,
  so it is dropped in code twice; and a URL trigger's raw address is scrubbed out of the recording
  ([[0104-what-posthog-records-and-what-never-leaves]] §4).
- Console output is captured only if what the web app logs has been checked. **MEASURED:** no
  client file logs anything (recon 2026-10-11), and console capture is still off
  (`enable_recording_console_log: false`, `capture_console_errors: false`): nothing was gained by
  turning it on.

## Related

- [[0104-what-posthog-records-and-what-never-leaves]] — the other four decisions.
- [[0037-the-worker-reports-to-sentry-the-web-apps-do-not]] — the boundary this sits beside.
- [[0068-prices-stand-no-free-tier-trials-by-hand]] — its "no analytics package" is stale from this.
- [[posthog-hiding-check-2026-10-11]] — what leaves the browser, measured; superseded on
  2026-10-15 by [[posthog-hiding-check-2026-10-15]] (vault 0110).
- `docs/10-analytics.md` — the wiring, the named steps, the env and the dashboard settings.

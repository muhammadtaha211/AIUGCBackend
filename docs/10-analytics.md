# 10 — Product analytics (PostHog, apps/web only)

Decisions: [`0103`](vault/decisions/0103-posthog-in-apps-web-eu-cloud-free-plan.md) (the service, the
boundary, what is not built) and
[`0104`](vault/decisions/0104-what-posthog-records-and-what-never-leaves.md) (counts, recordings,
identity, hiding, the notice). The measured hiding check:
[`facts/posthog-hiding-check-2026-10-11.md`](vault/facts/posthog-hiding-check-2026-10-11.md).
`/privacy` §3, §5, §6, §7, §8 and §9 describe this file; rows P13 and P14 of `legal-review.md`.

**Goal.** For a visitor who never pays, tell whether they left at the prices or got stuck, without
anyone telling us.

## Where it lives

| File                                           | What it is                                                                                                                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/lib/analytics.ts`                | The policy, pure and node-tested: the settings (key, EU host), which paths record, the address scrubber, the `before_send` scrubber, the recording masks, the SDK options, the named steps and their allowed codes. |
| `apps/web/src/lib/analytics-client.ts`         | The runtime: the one gate (`captureDecision`), the lazy SDK import, pageviews per route, identify, `track`, `captureError`, `resetAnalytics`. The only file that imports `posthog-js` at run time.                  |
| `apps/web/src/components/analytics.tsx`        | `<Analytics />` (mounted once in the root layout), `useStepViewed` (the wizards) and `<TrackStep />` (a step fired from a server component).                                                                        |
| `apps/web/src/app/api/analytics/viewer`        | `GET`: `{ admin: true }` for an admin account, `{ admin: false, id }` for a customer, 401 signed out. Asked only when a Supabase session cookie is present.                                                         |
| `apps/web/src/components/recording-notice.tsx` | The notice line: first screen of `/start`, and `/login`, `/forgot-password`, `/reset-password`.                                                                                                                     |
| `apps/web/test/analytics.test.ts`              | The proofs (below).                                                                                                                                                                                                 |

`posthog-js` is pinned exactly at **1.434.15** (2026-09-26, the newest release more than two weeks
old on 2026-10-11) and imported as `posthog-js/full/no-external`: recording and error capture
bundled, no script ever loaded from PostHog's CDN. `apps/admin` has no PostHog at all (a test reads
its `package.json` and sources).

## The gate — one place

`captureDecision()` in `analytics-client.ts` decides whether capture may start, for every route:

1. No `NEXT_PUBLIC_POSTHOG_KEY` (or a host that is not the EU cloud or a loopback stand-in): **off**.
   The SDK is never imported, nothing is requested.
2. This device has `aiugc.analytics.off` in localStorage: **off**. Set the first time an admin
   account is seen signed in on it.
3. This project's Supabase session cookie (`sb-<project ref>-auth-token`, the exact name supabase-js
   reads; another project's leftover cookie does not count) is present: ask
   `/api/analytics/viewer`. Admin → **off** and mark the device. Customer → **on**, identified by
   the user id. Cannot tell (5xx, network) → **off**.
4. Otherwise, an anonymous visitor: **on**.

While the gate says no, `before_send` drops every event, recordings and errors included. Between
routes, an event also leaves only while the session cookie is present or absent exactly as it was
when the gate last decided (`canSend`), so a sign-in or a sign-out stops everything at the moment
the cookie changes, until the next route has asked who it is. Moving to accept/decline later is one
more condition in `captureDecision`.

**Identity:** a PostHog identity left in the browser by a session that ended without `signOut()`
(a server-side sign-out, a revoked token) or by another account is reset before the next event;
`signOut()` resets it too. Anonymous browsing in a browser before a sign-in (or a signup) is merged
into that account by PostHog's `identify`.

**What it cannot see:** an admin's first anonymous visit on a device that has never shown an admin
session (the landing before signing in, say) counts like anyone's; from the moment that admin signs
in there, nothing is sent, and the device stays off.

## Counted, recorded

| Pages                                                                                                 | What is sent                                                                                                                    |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `/start`, `/login`, `/forgot-password`, `/reset-password`, `/home/**`, `/connect/**`                  | `$pageview`, the session recording, named steps, browser errors, `$identify`                                                    |
| Everything else (`/`, `/pricing`, `/about`, `/contact`, `/privacy`, `/terms`, `/social/deletion/:id`) | `$pageview` with the referring site and campaign parameters, browser errors, `$identify` for a signed-in customer; no recording |

`isRecordedPath` in `analytics.ts` is the list. The SDK starts with recording disabled and
`startSessionRecording` / `stopSessionRecording` run on every route change; leaving a recorded page
for a public one also stops the recorder inside the navigation's commit (`stopRecordingIfPublic`,
a layout effect), before its observer sees the public page's DOM. That ordering is React's and the
DOM's, REASONED, not measured.

The pageview's address and campaign are read when the route is reported (`pageviewProperties`),
not when the SDK has finished loading, so a visitor who taps on before it loads is not counted on
the wrong page.

## What never leaves the browser, and how

- **Addresses** (`sanitizeUrl`): origin + path with ids replaced by `:id` + only `utm_*`, `plan`
  and `checkout` (codes only). The fragment is always dropped. Applied to every URL-like property,
  `$set`/`$set_once` included, to the page address inside recordings (`maskCapturedNetworkRequestFn`
  and the snapshot scrubber), to every string in the SDK's own recording events (a dashboard URL
  trigger puts the raw address into `$recording_started` as `matchedUrl`), to what the SDK reads
  for targeting (`get_current_url`), and to addresses quoted inside an error message. Referrers are
  cut to their origin. Click ids (`fbclid`, `gclid`, …), `$fbc` and the search keyword are deleted.
- **Recordings, hidden by default**: `maskTextSelector: "*"` sends every text node through
  `maskText`, which hides it unless it sits under `data-ph-unmask` and not under `data-ph-mask`
  or inside a form field. Every input is masked (`maskAllInputs`) to the same five asterisks
  (`maskInput`), so a field's length does not leave either; masked page text keeps one asterisk
  per character and its spaces, so the replay keeps its layout. Attributes go through
  `maskAttribute` (addresses lose tokens, `srcset` goes whole, words are hidden unless readable).
  Every `img`, `video`, `audio`, `canvas`, `iframe`, file input and hidden input is replaced by a
  blank box (`BLOCK_SELECTOR`). Captured network requests and console lines are dropped twice
  (`maskReplayRequest` returns null; the snapshot scrubber removes plugin events), because
  PostHog's dashboard can turn network capture on regardless of the local setting.
- **No click events** (`autocapture: false`), no heatmaps, no dead clicks, no web vitals, no
  console capture, no surveys, no feature flags (`advanced_disable_feature_flags`, which also stops
  the `/flags` request that bypasses `before_send`).
- **Storage**: `persistence: "localStorage"` — no cookie, so nothing of PostHog's rides on
  requests to our own server.

### Marking a screen readable

`data-ph-unmask` on a container makes Tavnit's own copy inside it readable; form fields stay
masked inside it. Put `data-ph-mask` on anything inside such a container that shows a customer's
own content, and never render customer content inside a marked container without it. A screen
nobody marked comes out as asterisks. Marked today: the `/start` questionnaire (its recap of the
answers is masked again), the onboarding header, every `StepHeader`, every field label, the three
auth pages, the wizard rail and the three wizard titles, the sidebar's nav links,
`NoCreditsCard`, `/home/plan` (its dialogs too, through `ConfirmDialog readable`),
`/home/plan/checkout`, and the ₪5 intro offer's `/home/plan/intro` and `/home/plan/continue`
(vault 0109), the two error cards, the notice line. `/home/plan` shows the customer's own
plan and billing state (next charge, a pending change, a failed charge), which is readable there
by design and said so in `/privacy` §3.

| Comes out readable                                                                                                                                             | Partly hidden                                                                                                                                                                                                                                                                                       | Fully hidden                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/start` steps 1–4, the three auth pages, `/home/plan`, `/home/plan/checkout`, `/home/plan/intro`, `/home/plan/continue`, the no-credits card, the error cards | `/start` signup step and `/home/new-business` (questionnaire readable, recap masked), every wizard (title, rail and step headers readable; everything the customer wrote or was given, the business name, media, hidden), the signed-in shell (nav readable; email, business names, credits hidden) | `/home` body (greeting with the business name, render strip), `/home/renders`, `/home/demos`, `/home/settings`, `/home/feedback`, `/connect/instagram` |

## Named steps

Every property is a fixed list of codes or a code pattern (`STEP_EVENTS` in `analytics.ts`);
`stepProperties` refuses anything else, an extra or missing property included, and a refused step
is not sent. The lists are pinned against the code's own (`STEPS`, `aWizardSteps("steps")`,
`wizardSteps()`, `C_WIZARD_STEPS`, `CHECKOUT_STATES`).

| Event                | Carries                                                                                                                                                                          | Fires                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start_step_viewed`  | `step`: `business` \| `product` \| `benefits` \| `audience` \| `signup`                                                                                                          | `onboarding-flow.tsx`, every step change of the public wizard (signup mode only), a restored draft included.                                                                                                                                                                                                                                                                                                         |
| `account_created`    | `method`: `password` \| `google`                                                                                                                                                 | `password`: `lib/auth.ts signUp`, when Supabase answers without an error (the account row exists, unconfirmed). `google`: `onboarding-flow.tsx` on the OAuth return to `/start` — when the first business is stored and the provider is `google`, or, with no finished questionnaire (a Google account made from `/login`), when the account is a Google one created in the last ten minutes (`isNewGoogleAccount`). |
| `home_first_arrival` | `to`: `home` \| `plan`                                                                                                                                                           | When a signup's draft is stored as the account's first business (`stored: true`), right before the browser goes to `/home` or `/home/plan`: the `/start` OAuth/confirmation return, `completeSignup`, and `/login`'s parked-draft handoff; and `/home/new-business` when the account had no business (`firstBusiness`, read by the page).                                                                            |
| `no_credits_wall`    | `service`: `a` \| `b` \| `c`                                                                                                                                                     | `NoCreditsCard`, rendered by `/home/{a,b,c}/new` when the gate refuses.                                                                                                                                                                                                                                                                                                                                              |
| `plans_viewed`       | nothing                                                                                                                                                                          | `PlanManager` mount (`/home/plan`).                                                                                                                                                                                                                                                                                                                                                                                  |
| `checkout_started`   | `plan`: a plan code (`/^[a-z][a-z0-9_-]{0,39}$/`, the slug rule), or `intro` for the ₪5 offer                                                                                    | `CheckoutForm`, after `/api/account/checkout` (or the ₪5 offer's `/api/account/intro`) answers with a redirect, sent as a beacon just before the browser leaves for Sumit. The redirect URL (it carries the email and business name) is never sent.                                                                                                                                                                  |
| `payment_returned`   | `outcome`: `success` \| `refused` \| `failed` \| `unconfirmed`; the ₪5 offer's `intro` \| `intro_refused` \| `intro_failed` \| `intro_unconfirmed`; `continued`                  | `PlanManager` mount when `?checkout=` is present (set by `/api/billing/sumit/return`; `continued` by the continue page after a month activates on the saved card).                                                                                                                                                                                                                                                   |
| `wizard_step_viewed` | `service`: `a` \| `b` \| `c`; `step`: one of A's `persona hook hookStudio demo plan render`, B's `persona pointers script audio effect render`, C's `persona clip studio render` | Every step change of the three wizards (`useStepViewed`); A's waits for its `?demo=` restore, so a reload counts the step it lands on.                                                                                                                                                                                                                                                                               |
| `render_requested`   | `service`: `a` \| `b` \| `c`; `result`: `ok` \| `no_credits` (402) \| `refused` (422, content policy) \| `error`                                                                 | The confirm step's `start()` in each wizard, after the render POST answers.                                                                                                                                                                                                                                                                                                                                          |

Plus PostHog's own: `$pageview` (every allowed route), `$identify` (once per customer session,
the user id only), `$snapshot` (recordings), `$exception` (uncaught errors, unhandled rejections,
and what the three error boundaries catch, through `captureError`).

**Caveats, REASONED from the code:**

- `account_created` (`password`) over-counts by already-registered addresses: with confirmation ON,
  Supabase answers those the same way.
- `payment_returned` counts again on a reload of the landing, because `?checkout=` stays in the
  address.
- `account_created` (`google`, no finished questionnaire) counts again if that person reloads
  `/start` within the ten minutes.
- An error, or a step fired by a page's own effects, in the moment between a sign-in and the next
  route's answer is dropped, not sent late.

**Skipped:** the in-wizard credits shortfall at the confirm step is not a separate step; a refused
render request shows as `render_requested` with `result: no_credits`.

## Env

| Variable                   | Where                                                                                                            | Notes                                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_POSTHOG_KEY`  | Vercel, the web project (Production; Preview only if previews should send), and optionally `apps/web/.env.local` | PostHog's project API key (`phc_…`). Unset or blank: nothing loads. Inlined at build time, so a change needs a redeploy. |
| `NEXT_PUBLIC_POSTHOG_HOST` | nowhere in normal use                                                                                            | Defaults to `https://eu.i.posthog.com`. Any other value turns analytics off, except a loopback host (the hiding check).  |

## Dashboard settings it depends on

The SDK refuses to record unless the project's **session replay is on** (it reads that from the
remote config), so that one switch is the founder's. Its sampling, minimum duration and URL
triggers decide WHICH sessions record, never what goes into one. Every setting that decides what is
sent is pinned locally and wins over the dashboard, except network capture, which is dropped in
code instead.
Recommended: session replay ON; network capture OFF; console log capture OFF; "Discard client IP
data" ON (PostHog says new EU-cloud projects default to it); authorized domains limited to
`tavnit.ai` if the dashboard offers it.

## Deleting an account

`/privacy` §12 promises that deleting an account includes the data linked to its id in PostHog. On a
deletion request, find the person by the Tavnit user id in PostHog and delete it with its events and
recordings, alongside the steps `/privacy` §12 already lists.

## The hiding check (repeatable)

A local HTTP server stands in for PostHog's ingest (`GET /array/<key>/config` answers
`{"sessionRecording":{"endpoint":"/s/"}}`; `/e/` and `/s/` record their bodies, gunzipping the
batch and each compressed snapshot). The web dev server runs with
`NEXT_PUBLIC_POSTHOG_KEY=<any>` and `NEXT_PUBLIC_POSTHOG_HOST=http://127.0.0.1:<port>` set in its
own process. Headless Chrome is driven over CDP with a normal user agent (posthog-js drops
`HeadlessChrome` as a bot) through the public pages, `/start` typed end to end, `/reset-password`
with a token, `/login` with Sumit ids in `next=`, a throwaway harness page under `/start/` that
mounts the real sidebar, C studio and render player with marker values, and an admin session (a
throwaway value under this project's real session-cookie name, which the middleware leaves alone,
and the viewer route answered through CDP's Fetch domain). Then every captured byte is searched for
the markers. Results: [`facts/posthog-hiding-check-2026-10-11.md`](vault/facts/posthog-hiding-check-2026-10-11.md).

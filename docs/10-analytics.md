# 10 — Product analytics (PostHog, apps/web only)

Decisions: [`0103`](vault/decisions/0103-posthog-in-apps-web-eu-cloud-free-plan.md) (the service, the
boundary, what is not built) and
[`0104`](vault/decisions/0104-what-posthog-records-and-what-never-leaves.md) (counts, recordings,
identity, hiding, the notice), whose §1 and §3 are superseded by
[`0110`](vault/decisions/0110-posthog-records-every-page-hides-only-the-sensitive.md) (every page
records; only the sensitive is hidden; media shows where it plays; the notice on every public page).
The measured hiding check:
[`facts/posthog-hiding-check-2026-10-15.md`](vault/facts/posthog-hiding-check-2026-10-15.md)
(which supersedes the 2026-10-11 one).
`/privacy` §3, §5, §6, §7, §8 and §9 describe this file; rows P13 and P14 of `legal-review.md`.

**Goal.** For a visitor who never pays, tell whether they left at the prices or got stuck, without
anyone telling us.

## Where it lives

| File                                           | What it is                                                                                                                                                                                         |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/lib/analytics.ts`                | The policy, pure and node-tested: the settings (key, EU host), the address scrubber, the `before_send` scrubber, the recording masks, the SDK options, the named steps and their allowed codes.    |
| `apps/web/src/lib/analytics-client.ts`         | The runtime: the one gate (`captureDecision`), the lazy SDK import, pageviews per route, identify, `track`, `captureError`, `resetAnalytics`. The only file that imports `posthog-js` at run time. |
| `apps/web/src/components/analytics.tsx`        | `<Analytics />` (mounted once in the root layout), `useStepViewed` (the wizards) and `<TrackStep />` (a step fired from a server component).                                                       |
| `apps/web/src/app/api/analytics/viewer`        | `GET`: `{ admin: true }` for an admin account, `{ admin: false, id }` for a customer, 401 signed out. Asked only when a Supabase session cookie is present.                                        |
| `apps/web/src/components/recording-notice.tsx` | The notice line: first screen of `/start` (and `/home/new-business`, which shares it), `/login`, `/forgot-password`, `/reset-password`, and `SiteFooter` on every public page.                     |
| `apps/web/test/analytics.test.ts`              | The proofs (below).                                                                                                                                                                                |

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

While the gate says no, `before_send` drops every event, recordings and errors included, and
nothing is queued until it says yes again. Between routes, an event also leaves only while the
session cookie has exactly the value the gate last decided for and no tab has marked the device
(`admit`). So a sign-in, a sign-out, another account's session written over this one (Supabase
replaces the cookie's value without removing it), a token refresh or another tab's admin sign-in
stops everything at the moment it happens. What happens next (vault 0110, "no gap at sign-in"):

- The gate is asked again **at once**, not on the next route (`recheck`); an answer fetched for a
  cookie value that changed meanwhile is asked again.
- Meanwhile the recorder's batches (up to ten, about twenty seconds) and the steps and errors fired
  through `track` / `captureError` are **held** in memory, not dropped.
- The answer decides them. A sign-in's go out only if the account is a customer's: the batches
  re-sent as the recorder's own request (`release`: `_url` the `/s/` endpoint,
  `_batchKey: "recordings"`, `_noTruncate`, `skip_client_rate_limiting`, pinned against
  posthog-js's `_captureSnapshot` in a test), then the steps, so the replay has no gap. Any other
  change's go out if the answer allows them and the identity did not change: a token refresh, or a
  sign-out through `signOut()`, which resets the identity before the cookie goes. An admin's answer
  drops them, stops the recording and marks the device, as before; so does an answer that cannot
  be had, and a changed identity (a session that ended without `signOut()`, another account).
- Events the SDK raises itself in that moment (an uncaught error) are dropped, not held.

Moving to accept/decline later is one more condition in `captureDecision`.

**Identity:** a PostHog identity left in the browser by a session that ended without `signOut()`
(a server-side sign-out, a revoked token) or by another account is reset before the next event;
`signOut()` resets it too. Anonymous browsing in a browser before a sign-in (or a signup) is merged
into that account by PostHog's `identify`.

**What it cannot see:** an admin's first anonymous visit on a device that has never shown an admin
session (the landing before signing in, say) counts like anyone's; from the moment that admin signs
in there, nothing is sent, and the device stays off.

## Counted, recorded

**Every page records** (vault 0110): the landing, `/pricing` and every other public page, `/start`,
the auth pages, everything signed in. Each route sends `$pageview` (address cut down, campaign kept),
the recording, named steps, browser errors and, for a signed-in customer, `$identify`. Nothing stops
the recorder between a public page and an app page. The SDK starts with recording disabled and
`startSessionRecording` runs once the gate has answered, on every route.

**MEASURED in posthog-js 1.434.15's source, not decided here:** the recorder holds a fresh page's
first batch until the visitor interacts (`_holdFlushUntilInteraction`; a scroll, a click, typing),
or until a clean unload of a page that was visible; and the first batch reached the stand-in about
five seconds after the interaction in the hiding check. A visit with no interaction and no clean
unload ships no recording.

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
- **Recordings: shown as on screen, the sensitive hidden** (vault 0110). `maskTextSelector: "*"`
  and `maskAllInputs: true` send every text node and every text field through `maskText` /
  `maskInput`, and every attribute through `maskAttribute`, so the policy is ours and the dashboard's
  masking settings cannot override it. They show the page as it was, except:
  - inside `data-ph-mask` (`MASK`): text as one asterisk per character with its spaces, a field as
    the same five asterisks whatever was typed, words and links in attributes gone, and every
    image and video a blank box;
  - in any field that is a password, email or phone field, a password field switched to text
    (rrweb's `data-rr-is-password`), or that says `autocomplete` username, email, tel,
    current-password, new-password or one-time-code (`SENSITIVE`), marked or not;
  - an email address anywhere else, in text, a field or an attribute (`EMAIL`, a pattern): from the
    word before its `@` to the end of the word, so one being typed into an ordinary field is
    hidden from the moment its `@` is typed. What was typed before the `@` has been recorded by
    then, because posthog-js records every keystroke and offers no way to sample them. A word that
    starts with `@` (a handle) shows; an address written with spaces around the `@` is not
    recognised;
  - the codes in an address shown or typed (a product link with a preview key, say): `http(s)`
    addresses in text and fields are cut down like any other (`sanitizeUrl`);
  - text with no element to place it.
- **Media** shows where a replay watched the next day would still play it (`isPlayableMedia`, and
  the same rule in CSS in `BLOCK_SELECTOR`, read from the attribute as the page wrote it). A replay
  carries the link, not the pixels: the viewer's browser fetches it then. A link with no query
  plays and is kept whole and absolute (rrweb records `poster` as written); so does Next's image
  optimiser serving such a link, with its `srcset`. Anything else (a signed link, the Meta CDN, a
  `blob:` or `data:` address, an `/api/` route) is a blank box of the same size, and its address
  is cut down besides. Canvases, frames, embeds, file inputs and hidden inputs are always boxes (a
  hidden input's value can be a token, a file input's is the file's name, and the recorder masks
  neither). Captured network requests and console lines are dropped twice (`maskReplayRequest`
  returns null; the snapshot scrubber removes plugin events), because PostHog's dashboard can turn
  network capture on regardless of the local setting.
- **No click events** (`autocapture: false`), no heatmaps, no dead clicks, no web vitals, no
  console capture, no surveys, no feature flags (`advanced_disable_feature_flags`, which also stops
  the `/flags` request that bypasses `before_send`).
- **Storage**: `persistence: "localStorage"` — no cookie, so nothing of PostHog's rides on
  requests to our own server.

### Marking a field hidden

Shown is the default; the hidden set is the list above and nothing else. To hide something new,
put `data-ph-mask` on the smallest element that holds it: its text, fields, attribute words and
links, and any image or video inside it, all go. Where the identity cannot be isolated from the
copy around it (a sentence built with the account's name in it, a `title` attribute), mark the
container. `ConfirmDialog sensitive` does it for a dialog, which is portalled out of any marked
region. A field needs no mark if it is a password, email or phone field or carries one of the
`autocomplete` hints above.

Marked today: the account email (the sidebar's menu and profile row, the avatar letter, the mobile
avatar button, `/home/settings`), a connected Instagram account's name, username and picture
(`/home/settings` and its success line and disconnect dialog, `/schedule/[renderId]`'s account
picker, `/calendar`'s day list and post chips, `/calendar/[postId]` and its link to the post, the
expired-account notice on `/home`), the contact and feedback forms whole and the email their
confirmations show, and the deletion code on `/social/deletion/[code]`. A test pins a mark in each
of these files.
Sumit's payment page is on its own domain and never recorded.

| Shown as on screen                                                                                                                                                                                                                                                                                                  | Partly hidden                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Fully hidden                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| The landing, `/pricing`, `/about`, `/privacy`, `/terms` (their media is Tavnit's own static files and plays); `/start` steps 1 to 4; `/home/new-business` (answers and recap); `/home/plan` and its checkout, intro and continue pages; the no-credits card; the error cards; the notice line; `/connect/instagram` | `/start` signup step and the three auth pages (fields shown except email and password); every wizard (the business content, the scripts, hook lines, captions and texts shown and typed; every customer video and image a box); the signed-in shell (business name and credits shown, the email hidden); `/home/settings` (questionnaires shown; the email and connected accounts hidden); `/home` (greeting and business name shown, render thumbnails boxed, the expired-account notice hidden); `/home/demos` (demo thumbnails boxed); `/home/renders`, `/schedule`, `/calendar` (render boxes, account hidden); `/contact` (page shown, form hidden); `/social/deletion/[code]` (the code hidden) | `/home/feedback`'s form; the contact form; Sumit's payment page (another domain, never recorded) |

| Media                                                                           | Link                                                    | Lifetime (MEASURED)                                          | In a replay                                                 |
| ------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------- |
| Demos, demo and analysis thumbnails, the A example pair                         | signed (Supabase)                                       | 3600 s (`SIGNED_URL_TTL_SECONDS`, `apps/web/src/lib/api.ts`) | box                                                         |
| Renders (`videoUrl`; `downloadUrl` is a link, not media) and their thumbnails   | signed                                                  | 3600 s                                                       | box (the download link's address is kept without its token) |
| Hook clips, text-block clips, TTS audio (opener clips: no component shows them) | signed                                                  | 3600 s                                                       | box                                                         |
| Persona images                                                                  | public catalogue bucket, through Next's image optimiser | none (a 3600 s signed fallback when `catalog_path` is null)  | plays (the fallback: box)                                   |
| The landing's and the `/home` cards' example clips and stills, the brand mark   | Tavnit's static files                                   | none                                                         | plays                                                       |
| A connected account's picture, the sound picker's covers and previews           | Meta CDN, signed by Meta                                | Meta's, not in the code                                      | box (the picture is hidden anyway)                          |

## Named steps

Every property is a fixed list of codes or a code pattern (`STEP_EVENTS` in `analytics.ts`);
`stepProperties` refuses anything else, an extra or missing property included, and a refused step
is not sent. The lists are pinned against the code's own (`STEPS`, `aWizardSteps("steps")`,
`wizardSteps()`, `C_WIZARD_STEPS`, `CHECKOUT_STATES`).

| Event                  | Carries                                                                                                                                                                                                                                                                                                                                                           | Fires                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start_step_viewed`    | `step`: `business` \| `product` \| `benefits` \| `audience` \| `signup`                                                                                                                                                                                                                                                                                           | `onboarding-flow.tsx`, every step change of the public wizard (signup mode only), a restored draft included.                                                                                                                                                                                                                                                                                                         |
| `account_created`      | `method`: `password` \| `google`                                                                                                                                                                                                                                                                                                                                  | `password`: `lib/auth.ts signUp`, when Supabase answers without an error (the account row exists, unconfirmed). `google`: `onboarding-flow.tsx` on the OAuth return to `/start` — when the first business is stored and the provider is `google`, or, with no finished questionnaire (a Google account made from `/login`), when the account is a Google one created in the last ten minutes (`isNewGoogleAccount`). |
| `home_first_arrival`   | `to`: `home` \| `plan`                                                                                                                                                                                                                                                                                                                                            | When a signup's draft is stored as the account's first business (`stored: true`), right before the browser goes to `/home` or `/home/plan`: the `/start` OAuth/confirmation return, `completeSignup`, and `/login`'s parked-draft handoff; and `/home/new-business` when the account had no business (`firstBusiness`, read by the page).                                                                            |
| `no_credits_wall`      | `service`: `a` \| `b` \| `c`                                                                                                                                                                                                                                                                                                                                      | `NoCreditsCard`, rendered by `/home/{a,b,c}/new` when the gate refuses.                                                                                                                                                                                                                                                                                                                                              |
| `plans_viewed`         | nothing                                                                                                                                                                                                                                                                                                                                                           | `PlanManager` mount (`/home/plan`).                                                                                                                                                                                                                                                                                                                                                                                  |
| `checkout_started`     | `plan`: a plan code (`/^[a-z][a-z0-9_-]{0,39}$/`, the slug rule), or `intro` for the ₪5 offer                                                                                                                                                                                                                                                                     | `CheckoutForm`, after `/api/account/checkout` (or the ₪5 offer's `/api/account/intro`) answers with a redirect, sent as a beacon just before the browser leaves for Sumit. The redirect URL (it carries the email and business name) is never sent.                                                                                                                                                                  |
| `payment_returned`     | `outcome`: `success` \| `refused` \| `failed` \| `unconfirmed`; the ₪5 offer's `intro` \| `intro_refused` \| `intro_failed` \| `intro_unconfirmed`; `continued`                                                                                                                                                                                                   | `PlanManager` mount when `?checkout=` is present (set by `/api/billing/sumit/return`; `continued` by the continue page after a month activates on the saved card).                                                                                                                                                                                                                                                   |
| `wizard_step_viewed`   | `service`: `a` \| `b` \| `c`; `step`: one of A's `persona hook hookStudio demo plan render`, B's `persona pointers script audio demo effect render` (`demo` only with the cutaway option on, vault 0121; before 2026-10-21 it came after `effect`, so an ordered B funnel spanning that date mixes the two orders — vault 0122), C's `persona clip studio render` | Every step change of the three wizards (`useStepViewed`); A's waits for its `?demo=` restore, so a reload counts the step it lands on.                                                                                                                                                                                                                                                                               |
| `render_requested`     | `service`: `a` \| `b` \| `c`; `result`: `ok` \| `no_credits` (402) \| `refused` (422, content policy) \| `error`                                                                                                                                                                                                                                                  | The confirm step's `start()` in each wizard, after the render POST answers.                                                                                                                                                                                                                                                                                                                                          |
| `next_version_started` | `service`: `a` \| `c` (B has no such button)                                                                                                                                                                                                                                                                                                                      | `RenderPlayer`'s "גרסה נוספת" (decision 0124), on the click, as a beacon: the home strip's and library's modals and the A and C finish steps.                                                                                                                                                                                                                                                                        |

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
- A step fired in the moment between a session change and the gate's answer is held with the
  recording and follows it (sent on a customer's answer after a sign-in, dropped on an admin's);
  an uncaught error the SDK catches itself in that moment is dropped.

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

**The 2026-10-15 run** (vault 0110) used the same recipe with these changes. The harness page also
mounted the settings social card, the feedback and contact forms, a public and a signed image and a
hidden input. Markers came in two lists: hidden kinds, which must be absent, and shown kinds, which
must be present. The sign-in phases set this project's real session-cookie name on an open page,
with the viewer route's answer delayed seven seconds by CDP's Fetch domain, after waiting until the
page's pre-sign-in batch had reached the stand-in, so that any later request is the gate's doing.
Results: [`facts/posthog-hiding-check-2026-10-15.md`](vault/facts/posthog-hiding-check-2026-10-15.md).

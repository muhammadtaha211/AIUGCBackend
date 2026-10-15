---
type: decision
status: verified
verified: 2026-10-11
method: "Founder decisions 2, 3, 4 and 6 of §2 of the task prompt 'PostHog on apps/web' (2026-10-11), each 'Decided on 2026-10-11 … Not up for relitigation', with the reasons given there (his for 2 and 6, planning's accepted by him for 4); the prompt's planning default on /login, /forgot-password and /reset-password. MEASURED at feat/posthog-web: apps/web/src/lib/analytics.ts (isRecordedPath, sanitizeUrl, scrubEvent, maskText, maskAttribute, BLOCK_SELECTOR, maskReplayRequest, posthogOptions, STEP_EVENTS, stepProperties), apps/web/src/lib/analytics-client.ts (captureDecision, onRoute, track), apps/web/src/app/api/analytics/viewer/route.ts, apps/web/src/components/recording-notice.tsx, apps/web/test/analytics.test.ts (81 tests, all passing 2026-10-11), and the browser check in facts/posthog-hiding-check-2026-10-11.md."
source: founder
---

# 0104 — Counts on public pages, recordings from /start on; the user id only, the /start session joined to the account; customer content hidden, Tavnit's interface visible, hidden by default; a notice line, decided in one place

Tags as in [[0103-posthog-in-apps-web-eu-cloud-free-plan]]. All four decisions are
FOUNDER-REPORTED, 2026-10-11, not up for relitigation.

## 1. Counts on public pages, recordings from `/start` onward

> **Superseded 2026-10-15** by [[0110-posthog-records-every-page-hides-only-the-sensitive]] §1 and
> §5: every page records, the landing included, and nothing stops the recorder between public and
> app pages. Kept below as it was decided and measured.

**FOUNDER-REPORTED, decision 2.** Planning advised leaving `/start` out of the first version,
because it records people who have no account. He chose to include it: someone who quits the
questionnaire leaves no trace anywhere else.

**PLANNING DEFAULT, unstruck:** `/login`, `/forgot-password` and `/reset-password` are recorded too
and carry the same notice line — a failed sign-in is the kind of bug he would never hear about.

**MEASURED:** `isRecordedPath` records `/start`, `/login`, `/forgot-password`, `/reset-password`,
`/home/**` and `/connect/**`. Every other page sends `$pageview` with the referring site (origin
only) and the campaign parameters, plus browser errors and, for a signed-in customer, `$identify` —
never a recording. The SDK starts with recording disabled and the runtime starts or stops it on
every route; leaving a recorded page for a public one stops the recorder inside the navigation's
commit, so the public page's DOM stays out of the recording (REASONED from React's and the DOM's
ordering, not measured). MEASURED in the browser: the landing and `/pricing` sent one
`$pageview` each and no recording ([[posthog-hiding-check-2026-10-11]]).

## 2. The user id only, and the `/start` session joins the account

> **2026-10-15:** `canSend` below is `admit` since [[0110-posthog-records-every-page-hides-only-the-sensitive]]
> §5, which compares the cookie's value rather than its presence and holds what it stops instead
> of dropping it. The rule here stands.

**FOUNDER-REPORTED, decision 3.** PostHog knows the account by its Tavnit user id and nothing else:
no name, no email.

**MEASURED:** when a Supabase session cookie is present the runtime asks
`/api/analytics/viewer` (server-side `users.role` read) and calls `identify(userId)` with no person
properties; `person_profiles: "identified_only"`. Pinned in a test (`identify` called with exactly
one argument). MEASURED in the browser: the one `$identify` carried the id and an empty `$set`.
**REASONED from the SDK's source:** `identify` sends `$anon_distinct_id`, which merges the
anonymous browsing in that browser before the sign-in or signup — the `/start` visitor included —
into the account. `resetAnalytics()` runs in `signOut()`, and an identity left by a session that
ended any other way (a server-side sign-out, a revoked token) or by another account is reset before
the next event (`$user_id` compared on every route), so the next person on that browser starts
anonymous. Pinned in tests.

**Accounts with the admin role send nothing (§1 of the prompt). MEASURED:** an admin viewer stops
capture before the SDK loads. If the SDK is already running (an anonymous `/login` that becomes an
admin), nothing is sent from the moment the session cookie appears — every event is checked against
the session the last decision was made for (`canSend`) — and when the answer says admin the
recording stops; the device is then marked (`aiugc.analytics.off`) and nothing loads on it again.
The session cookie is matched by its exact name, so another project's leftover cookie cannot pass
for one. When the account cannot be checked, nothing
is sent. MEASURED in the browser: the admin phases sent no request at all, not even the remote
config. **What it cannot see (REASONED):** an admin's first anonymous visit on a device that has
never shown an admin session.

## 3. Customer content hidden, Tavnit's interface visible, hidden by default

> **Superseded 2026-10-15** by [[0110-posthog-records-every-page-hides-only-the-sensitive]] §2 and
> §3: shown is the default; only passwords, codes and tokens, emails and identity fields, two forms
> and media that would not play in a replay are hidden. Kept below as it was decided and measured.

**FOUNDER-REPORTED, decision 4** (planning's reason, accepted): he can already read a customer's
text in his own database, so hiding it in recordings costs him nothing.

**MEASURED, the mechanism:** every text node goes through `maskText` (`maskTextSelector: "*"`),
which hides it unless it is under `data-ph-unmask` and not under `data-ph-mask` or inside a form
field (one asterisk per character, spaces kept, for the replay's layout); every input is masked to
the same five asterisks, so a field's length does not leave; attributes go through `maskAttribute` (addresses lose tokens, words
hidden unless readable); media, canvases, iframes, file and hidden inputs are replaced by blank
boxes. A screen nobody marked comes out as asterisks. Where readable and hidden meet, hidden wins.
The marked screens and the readable / partly hidden / fully hidden table are in
`docs/10-analytics.md`. MEASURED in the browser: none of seventeen marker values (typed answers,
the recap, an email and password, a recovery token, Sumit ids, a business name, an account email, a
customer text and its edit, three signed media links, a hidden input) reached the stand-in, while
the marked interface copy did.

## 4. What never leaves the browser, by channel

**MEASURED:** in a recording — the masks above; in a click — no click events at all
(`autocapture: false`); in an error's context — addresses scrubbed out of the message and every URL
property; in an address — `sanitizeUrl` keeps only origin, the path with ids replaced, and `utm_*`,
`plan`, `checkout` (codes only), never the fragment, applied to every URL-like property, `$set` and
`$set_once` included, to the page address inside recordings, to every string in the SDK's own
recording events (a dashboard URL trigger writes the raw address into `$recording_started`), and to
what the SDK reads for targeting (`get_current_url`). Captured network requests and console lines
are dropped twice (`maskReplayRequest` and the snapshot scrubber), because PostHog's
dashboard can turn network capture on whatever the local setting says (MEASURED in the SDK's
source).

## 5. A notice line, not an accept/decline banner, and a subtle one

**FOUNDER-REPORTED, decision 6.** The options were the line or a banner. Planning recommended the
line and said it is a product call, not a legal one. One place must decide whether capture may
start, so that moving to accept/decline later is a small change.

**MEASURED:** `RecordingNotice` — "השימוש באתר מוקלט כדי לשפר את השירות." linking to `/privacy`,
`text-xs` at 50% ink — sits under the first question's options on `/start` (at 375 px: options end
at 732 px, the line at 788–804 px of an 812 px viewport, no horizontal scroll) and under the card on
the three auth pages. The one place is `captureDecision()` in `lib/analytics-client.ts`. Whether a
notice carries the transfer for visitors with no account is filed for counsel
(`docs/legal/reg2-open-questions.md`).

## Named steps

`STEP_EVENTS` in `lib/analytics.ts`; where each fires, what it carries and its caveats are in
`docs/10-analytics.md`. Each property is a fixed list of codes or a code pattern; anything else, an
extra or a missing property included, is refused before the SDK sees it (pinned in tests).

## Related

- [[0103-posthog-in-apps-web-eu-cloud-free-plan]] — the service and the boundary.
- [[posthog-hiding-check-2026-10-11]] — the browser measurement.
- [[0014-legal-page-positions]] — acceptance by use; `/privacy` rows P13 and P14 in
  `docs/legal-review.md`.

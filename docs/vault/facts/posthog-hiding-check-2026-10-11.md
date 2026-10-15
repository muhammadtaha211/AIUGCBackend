---
type: fact
status: superseded
verified: 2026-10-11
method: "Scripts in the session scratchpad, not committed (recipe in docs/10-analytics.md, 'The hiding check'): ingest.mjs, a node http server on 127.0.0.1:8789 standing in for PostHog's ingest (GET /array/<key>/config answers {sessionRecording:{endpoint:'/s/'},supportedCompression:['gzip-js','base64']}; every /e/ and /s/ body recorded, gunzipped, each compressed snapshot inflated); the web dev server started through a temporary .claude/launch.json entry (reverted) with NEXT_PUBLIC_POSTHOG_KEY=phc_local_hiding_check and NEXT_PUBLIC_POSTHOG_HOST=http://127.0.0.1:8789 set in its own process only; drive.mjs, headless Chrome 141-class over raw CDP with a normal desktop user agent and --disable-blink-features=AutomationControlled; analyze.mjs, a per-phase split and a substring search of every captured byte. Tree: feat/posthog-web before the first commit, posthog-js 1.434.15. A throwaway harness page at apps/web/src/app/start/probe/page.tsx (deleted with apps/web/.next after the run) mounted the real Sidebar, C StepStudio, WizardNav and RenderPlayer with marker values. No production write: /start was typed up to the signup step and never submitted; the admin and customer sessions were a throwaway cookie value with /api/analytics/viewer answered through CDP's Fetch domain. Run twice the same day: run 1 before the adversarial review's fixes, under a made-up cookie name (sb-probe-auth-token) the runtime then accepted; run 2 on the final tree (exact cookie name, the copy-not-mutate scrubbers, the constant input mask, the per-route address snapshot, the sign-in gate), under this project's real session-cookie name with an unparseable value — curl with that cookie on /start, /start/probe and / got 200 and no Set-Cookie, so the middleware leaves it alone."
source: browser
---

# What leaves the browser with PostHog wired, measured against a local stand-in

> **Superseded 2026-10-15** by [[posthog-hiding-check-2026-10-15]], the same recipe re-run after
> [[0110-posthog-records-every-page-hides-only-the-sensitive]] made every page record and only the
> sensitive hidden. This note stays as the measurement of the 2026-10-11 policy.

Two runs, 2026-10-11, eight phases each; the table is run 2, on the final tree. Run 1 (before the
review's fixes) gave the same answer in every row: the same markers absent, the same requests. Requests counted at the stand-in; media requests the harness
page made for its own `<img>`/`<video>` (they pointed at the stand-in too) are excluded.

| Phase | What the browser did                                                                                               | Requests                                                                                                 | Events                                                                                                           |
| ----- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| A     | `/?utm_source=probe_ig&utm_campaign=reel_probe&fbclid=PROBEFBCLID`                                                 | config ×2, `/e/` ×1                                                                                      | `$pageview` ×1                                                                                                   |
| B     | `/pricing`                                                                                                         | config ×2, `/e/` ×1                                                                                      | `$pageview` ×1                                                                                                   |
| S     | `/start` at 1280×800 and at 375×812 (the screenshots)                                                              | config ×4, `/e/` ×2, `/s/` ×2                                                                            | `$pageview` ×2, `start_step_viewed` ×2, `$snapshot` ×2                                                           |
| C     | `/start` typed through every step to the signup recap, then an email and two passwords typed, not submitted        | config ×2, `/e/` ×3, `/s/` ×2                                                                            | `$pageview` ×1, `start_step_viewed` ×5 (`business`, `product`, `benefits`, `audience`, `signup`), `$snapshot` ×3 |
| D     | `/reset-password?token_hash=PROBETOKENHASH&type=recovery`                                                          | config ×2, `/e/` ×1, `/s/` ×1                                                                            | `$pageview`, `$snapshot`                                                                                         |
| E     | `/login?next=/api/billing/sumit/return?og-paymentid=PROBESUMIT…`, an email typed                                   | config ×2, `/e/` ×1, `/s/` ×1                                                                            | `$pageview`, `$snapshot`                                                                                         |
| F     | a customer session (viewer `{admin:false,id:"probe-user-0001"}`) on the harness page; a text typed into the studio | config ×2, `/e/` ×2, `/s/` ×1                                                                            | `$identify` ×1, `$pageview`, `$snapshot`                                                                         |
| G     | an admin session (viewer `{admin:true}`) on the harness page (run 1: `/start`)                                     | **0** to PostHog (run 2's three requests were the harness page fetching its own media from the stand-in) | none                                                                                                             |
| H     | the same browser, signed out, on `/`                                                                               | **0**                                                                                                    | none                                                                                                             |

**No public page recorded:** phases A and B sent no `/s/`.

**Seventeen marker values, none in any PostHog payload:** `PROBEFBCLID`, `PROBETYPED` (every
questionnaire answer, also shown back in the signup recap — the recap was on screen), `PROBEEMAIL`,
`PROBEPASS`, `PROBETOKENHASH`, `PROBESUMIT`, `PROBELOGINMAIL`, `PROBEBIZ` (business name in the
sidebar and the wizard row), `PROBEMAIL` (account email in the sidebar), `PROBETEXT` (the studio's
text, in the preview, the textarea and the burned overlay), `PROBEOLD` (an earlier text),
`PROBEEDIT` (typed into the textarea), `PROBETOKEN`, `PROBEVIDEO`, `PROBEDL`, `PROBEIMG` (signed
media links: a clip, a render, its download link, a thumbnail), `PROBEHIDDEN` (a hidden input).
Nor the strings `token=` or `og-paymentid`. The one hit for the bare word `token_hash` was the
SDK's own config dump inside the recording, naming the parameter list it masks — no value.

**Addresses arrived cut:** every `$current_url` as origin + path (`/reset-password`, `/login`,
`/start/probe`), the landing's with `utm_source` and `utm_campaign` and without `fbclid`;
referrers `$direct`; the download link's `href` in the DOM as
`…/storage/v1/object/sign/renders/out.mp4` with no token.

**Readable where marked, asterisks elsewhere:** the snapshots carried "איזו מודעה אתם יוצרים
היום?", "שומרים ויוצרים את המודעות", the notice line, "כניסה לחשבון", "בחירת סיסמה חדשה",
"שלבי היצירה" and "כל היצירות"; customer content arrived as runs of `*`. Blocked elements (the
`<img>`s and `<video>`s) arrived as tag name, class and size, no `src`.

**Identity:** the one `$identify` carried `distinct_id: "probe-user-0001"` and `$set: {}`.

**Admin:** after phase G, `localStorage["aiugc.analytics.off"] === "1"`, in both runs.

**Browser storage written** (end of phase C): localStorage `ph_<key>_posthog` and
`aiugc.onboarding.v1` (the existing draft); sessionStorage `ph_<key>_window_id`,
`ph_<key>_primary_window_exists`, `ph_<key>_session_registered_properties`, `ph_<key>_posthog`;
**no cookie**. The SDK's source also names `ph_replay_pending_buffer_…` (sessionStorage, a parked
recording between pages); not seen at the moment of the read.

**What this does not cover:** PostHog's real ingest and dashboard (the stand-in accepted
everything); `persistence` behaviour across a real signup (no account was created); network
capture turned on from a real dashboard (the stand-in's config never asked for it, and the SDK
disables it on localhost); exceptions (none was thrown).

**Learned on the way:** posthog-js drops every event from a `HeadlessChrome` user agent; the first
run sent only the remote-config request until the driver set a normal one.

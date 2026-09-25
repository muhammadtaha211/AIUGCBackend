---
type: decision
status: verified
verified: 2026-09-19
method: "Founder decisions taken in chat 2026-09-19 and relayed in the task brief for this change; every product claim the new copy makes was then re-read against the tree at branch `landing/two-services` (off `origin/main` `1849713`) before it shipped — the file:line evidence is in §4. Built in one change: apps/web/src/app/page.tsx, apps/web/src/lib/landing-media.ts (new), apps/web/public/landing/README.md (new), apps/web/src/app/layout.tsx, apps/web/src/components/landing/site-footer.tsx, apps/web/src/app/(marketing)/about/page.tsx. Gate: `pnpm lint` and `pnpm typecheck` exit 0; all five serial suites green (remotion 76, core 602, worker 7, web 474, admin 39 — 1198 tests, 0 failures). Rendered and measured in a browser at localhost:3000: the four anchors resolve, the before/after row's RTL order was read off getBoundingClientRect, the three corrected contrast ratios off a canvas composite, and no console error on /, /about, /pricing or /terms. The full five-suite gate ran at `95c12ac`; the review fixes at `d768a2c` re-ran `@aiugc/web` alone (474 green) because they touch only classNames, comments and a markdown file under `apps/web`. Amended 2026-09-23 on branch `tweaks/landing-home-contact-demo`: two bullets carry in-place amendments — the pathway-cards one (fixed in `0ade931`, which also found a second live `קריינות` surface 0061 had missed, `home/demos/page.tsx:40`) and the before/after order one, whose x-ranges were re-measured off getBoundingClientRect at a 768px viewport after `3375231` reversed the row. Gate at that point: `pnpm typecheck` and repo-wide `prettier --check` exit 0, all five serial suites green (remotion 76, core 699, worker 7, web 531, admin 39 — 1352 tests, 0 failures). `verified` stays 2026-09-19 — nothing else in this note was re-measured."
source: founder
---

# 0061 — The landing sells the two services separately, and claims no results

## The decision

The public landing (`/`) and `/about` sold the **retired** Service A: "מסרטון אחד", a voiceover, an
"עם קול ובלי" variant pack — a format that stopped existing on 2026-09-05
([[0020-service-a-is-hook-and-steps-only]]) — and folded the talking head into one feature card
among three. Both pages are now built around the two services that actually run, under the names
the app itself writes.

### 1. Two services, named as the app names them, sold separately

`#features` is a two-card strip — **הוק + דמו** and **סרטון עם דמות AI** — each linking to its own
section: `#how` for hook + demo (the light intro plus the existing dark block), `#presenter` for
the talking head. Neither is a bullet inside the other's list.

The names are not new copy. `SERVICE_LABELS.a` is `"הוק + דמו"`, spaced
(`apps/web/src/lib/service-b-ui.ts:55`); `"סרטון עם דמות AI"` is how the wizard and the dashboard
card write it. `apps/web/src/lib/plans-ui.ts:116-117` already pins the pair, and the landing now
matches it rather than inventing a third spelling.

### 2. No results claim, anywhere, and no number

**There are no customers. Nothing has been measured. So the page claims nothing.** Specifically
ruled out: `מוכח`, `נוסה ונבדק`, any organic-reach or performance promise, and any before/after
statistic. The old `SocialProof` band — six dashed `לוגו` tiles and an invented testimonial about
"מה זה עשה לקמפיין שלו" — is deleted rather than left as a placeholder, because a placeholder for a
results claim is a results claim with the number still to be chosen.

Cost is compared **to production only** ("בלי צלם, בלי אולפן ובלי יום צילום"), never to ad spend.
The one money-adjacent line, `בלי תקציב מדיה כדי להתחיל`, is about how the ads are distributed —
the customer posts them organically — not a claim about what they return.

**No credit number and no shekel number appears on the landing**, and never
`N סרטונים בחודש` ([[0051-the-credit-unit-and-the-three-credit-only-plans]] §5). Pricing has its own
page and keeps it.

### 3. The self-marketing band IS the social proof

`#proof` replaces the logo wall: תבנית's own Instagram presenter is a persona generated in תבנית,
and every video on that account was made by the process the section above describes. The band
**discloses the account as AI** in its own copy — "החשבון מסומן כדמות AI, כמו שאנחנו מבקשים מכל מי
שמפרסם עם תבנית" — so the proof and the disclosure ship together.

The presenter's name and the Instagram URL are founder-owed
(`presenterName`, `instagramUrl` in `apps/web/src/lib/landing-media.ts`). `instagramUrl` is `null`
today, which hides the link and nothing else; the band still renders. **The copy is written
feminine** — if the presenter is male the founder rewrites it, not a session.
_(Name set 2026-09-25, founder in chat: **נועה** — female, so the feminine copy stands.
`instagramUrl` is still `null`.)_

### 4. The vocabulary rules, each with the code behind it

- **`כיתובים`, never `כתוביות`, for hook + demo's per-step text.** They are burned labels on demo
  trims, and the wizard already calls them that — `יש צעד בלי כיתוב` (`service-a-ui.ts:775`),
  `כיתוב לצעד הזה` (`state-picker.tsx:491`). `כתוביות` stays correct for Service B, which genuinely
  burns karaoke captions driven by real word timestamps (`packages/remotion/src/overlays.tsx:41,79-80`;
  timestamps required or the render fails, `pipelines/renders.ts:677-689`).
- **No `קריינות` on the hook + demo path.** The steps output has no audio stream at all:
  no `<Audio>` in the composition (`packages/remotion/src/ServiceASteps.tsx:20-23`), `muted: true`
  on the render call, which is what actually drops the stream since `audioCodec: "aac"` would
  otherwise mux a silent one (`packages/remotion/src/render.ts:295-306`), and the format refuses
  voiced input up front (`pipelines/sets.ts:277-281`).
- **No length is stated for the talking head.** `MAX_B_SCRIPT_WORDS = 150` is a runaway-cost
  processing ceiling and says so in its own comment (`packages/core/src/b-script-words.ts:10-23`);
  the ad's length follows the approved audio. See the corrections below.
- **"Silent on purpose, sound added natively" is the music line.** One bordered aside says the
  render comes out silent and the trending track is added in Instagram or TikTok — which is the
  useful form of CLAUDE.md's locked decision 7, stated once rather than apologised for.
- **No persona holds a physical product** ([[0017-service-b-single-setting-selfie-talking-head]] —
  product-in-hand isn't proof). Nothing on the page shows or says it.

The eight product claims the new copy makes were each read back against the code before shipping;
the two load-bearing ones:

- `סרטון של 8 עד 90 שניות` — `DEMO_MIN_DURATION_MS`/`DEMO_MAX_DURATION_MS`,
  `packages/core/src/pipelines/demos.ts:19-20`, the only duration gate.
- `עוברים על זה פעם אחת לכל דמו ... כל מודעה נוספת מאותה הקלטה היא רק פתיח ומשפט חדשים` — **true,
  and checked as a question rather than assumed.** A second render off the same demo is a
  **pass-through**: the wizard re-attaches to the demo's newest plan row whatever its status
  (`getLatestStepPlan`, `pipelines/demo-step-plans.ts:1316-1324`), the approved branch turns on
  `plan.approvedAt !== undefined` (`components/a-wizard/step-plan.tsx:783`), and in that branch there
  is no approve button at all — only continue. Approval is once per plan ROW, not once per render;
  `approvePlan` is idempotent (`demo-step-plans.ts:1587`). The single exception is
  `עריכת עותק חדש`, which forks a fresh unapproved row (`demo-step-plans.ts:1553-1567`). This is
  what [[0048-the-demo-analysis-is-charged-once-per-demo]] prices, now said in customer copy.

### 5. The physical-product category STAYS

Narrowing the ICP was raised and **deferred as its own decision**. `WhatChooser` still offers
`מוצר פיזי` first and the landing still addresses it. Recorded so that the absence of narrowing
reads as a decision deferred, not an oversight.

## Reasoned, not founder-decided

- **The anchors `#features` and `#how` are kept.** `site-header.tsx` and `site-footer.tsx` link to
  `/#features` and `/#how` from every other route (legal, marketing, pricing), so renaming them
  would break the shared nav from four pages. The sections behind them changed; the ids did not.
  `#presenter` and `#proof` are new and reached only from within the page.
- **Media is one typed config plus a folder** — `apps/web/src/lib/landing-media.ts` and
  `apps/web/public/landing/` (new, with a README listing the expected filenames). Every slot ships
  `src: null` and one `<MediaSlot>` draws the existing AdFrame still in its place, wearing the
  slot's own label; **the word "placeholder" never appears on screen**. Replacing an asset is a
  file drop plus one line — no import, no page edit. The hook lines live in the same object,
  because they are the copy burned onto those clips.
  **One constraint on the owed footage, recorded because it only bites when the assets arrive:
  `demoAfter` must carry NO burned hook line.** The page draws that line itself, in HTML, over all
  five frames that play the clip — one in the before/after row and four in step 4, where the whole
  point is that the SAME recording carries four different openers. A clip with its own line burned
  in would show two at once and contradict three of the four tiles. It is in the README.
  _(Reversed 2026-09-25, founder's call in chat when the footage arrived: step 4 is ONE frame
  playing `demoAfter`, and `demoAfter` is the finished ad as it came out — hook line burned in.
  The page draws no HTML line over it anywhere now, in step 4 or in the before/after row (the
  `hook={HOOKS[0]}` there is gone). The four HTML lines survive only on step 2's hook clips, which
  are bank clips with no text on them. Checked at localhost:3000: exactly four
  `p.absolute.top-3` overlays on the page, all on the hook strip; nine `<video>` elements, none
  fetched at the top of the page and each at readyState 4, playing, once scrolled into view —
  measured in headless Chrome over CDP at 375×812, because the app's Browser pane reports
  `visibilityState: hidden` and never runs IntersectionObserver. The clips load lazily since
  the same change (`components/landing/landing-video.tsx`, founder's pick): eager autoplay pulled
  ~10 MB before the hero was scrolled past. README rewritten to match.)_
  _(Later the same day, founder's call: step 2's hook clips show bare too — no HTML line is drawn
  over any clip on the page now, so the four `p.absolute.top-3` overlays above are zero. The
  lines survive only in step 3's option-list mock.)_
- **The three feature cards lost their media headers.** Two of the three have no image to show, and
  the surviving card's existing caption read `כתוביות מיושרות לימין, תמיד` — forbidden vocabulary on
  the hook + demo path (§4) that could only be fixed by writing new Hebrew. Text-only cards avoided
  both; the before/after row above them carries the section's visual.
- **Step 3's option-list mock now shows hook LINES.** Its old three strings were benefit captions,
  correct under the old "הכתוביות והקריינות נוצרות לבד" heading and wrong under the new "בוחרים משפט
  פתיחה". It reuses the existing `HOOKS` lines rather than authoring new ones. The fake waveform is
  gone — the step no longer describes anything with audio in it.
- **`StepTitle` gained a `tone`.** The dark block's lime numeral is invisible on paper (1.2:1), so
  the light variant mutes it instead of introducing a second heading style. It is `text-ink/60`
  **because Tailwind's preflight strips the `<ol>` marker, which makes that numeral the only visible
  numbering — real text owing 4.5:1, not decoration.** It shipped at `/30` (1.98:1) and was caught in
  review; the new `Eyebrow` (`/45`, 2.98:1) and the `#proof` disclosure line (`/50`, 3.49:1) were
  wrong the same way. All three are `/60` = **4.83:1**, measured by compositing in the browser, which
  is also the register the rest of the page already used. **The reusable number: on
  `--color-paper`, `/60` is the first `text-ink` step that clears 4.5:1 — /30 is 1.98, /45 is 2.98,
  /50 is 3.49, /55 is 4.12 (still short), /60 is 4.83, /65 is 5.77.** Everything below /60 reads
  fine on the dark block and fails on paper, which is how all three got written.
- **The before/after arrow is drawn, not typed** — but **not** for the reason first written here.
  The original claim was that U+2190 is `Bidi_Mirrored`; it is **not** —
  `unicodedata.mirrored('←')` is `0` on UCD 14, and the character is bidi class `ON`, so it is
  _reordered_ by the run around it, never flipped. An SVG's direction is fixed by its path, which is
  still the right call, for that reason. Recorded because the wrong version was committed first.
  The row's RTL order was verified by measurement, not by reading: raw demo at x 442–634 (right),
  arrow, finished ad at 130–322 (left).
  _(Superseded on this last sentence only, 2026-09-23, in `3375231`: the founder reversed the
  visual order — raw recording LEFT, finished ad RIGHT, which is deliberately not what RTL gives.
  Re-measured the same way at a 768px viewport: raw demo at x 124–316 (left), arrow at 356–396,
  finished ad at 436–628 (right). Mirror images of the numbers above, offset 6px per edge because
  that measurement ran in a 764px content box and this one in 752px. The DOM order is unchanged,
  raw-first; `flex-row-reverse` on the row does the flip and `-scale-x-100` on the arrow mirrors
  it, so the arrow still travels raw → ad. The rest of this bullet — that the arrow is an SVG
  because a path fixes its direction where U+2190 would only be reordered — is **why the flip is a
  one-class change**, and stands unaltered.)_

## Corrections

Both about the same number, both wrong in opposite directions, and neither reached the page:

- **"Service B is a fixed 15s"** (assistant, 2026-09-19) — **wrong.** 15 is `durationPreset`, in
  seconds, hardcoded on the web path (`components/b-wizard/b-wizard.tsx:66`; 30s exists in the
  schema and the CLI but is not offered). It derives a word budget —
  `wordBudget = floor(durationPreset × words_per_second)` ≈ 33 words at the seeded 2.2
  (`pipelines/copy.ts:527-528`) — and the prompt asks for 90–100% of it
  (`prompts/b_script/v17.md:46-52`). The rendered ad's length follows the approved audio, so it is a
  target, not a fixed length. **The brief's own phrasing of this correction — "15 is the generation
  target" — is itself loose: 15 is the preset in seconds; the generation target is the word budget
  it produces.**
- **"up to 15 minutes"** (founder, 2026-09-19) — **wrong.** `MAX_B_SCRIPT_WORDS = 150` is ~60–70s of
  speech and is a processing ceiling, not a duration limit; its own comment forbids ever telling a
  customer their ad must be under N seconds (`packages/core/src/b-script-words.ts:10-23`).

**The consequence both corrections point at is the same, and it is the rule: the page states no
length for the talking head.** The only duration anywhere in the new copy is the demo's 8–90s, which
is a real upload gate.

## Related

[[0017-service-b-single-setting-selfie-talking-head]] ·
[[0020-service-a-is-hook-and-steps-only]] ·
[[0036-auto-release-b-is-always-on]] ·
[[0048-the-demo-analysis-is-charged-once-per-demo]] ·
[[0051-the-credit-unit-and-the-three-credit-only-plans]]

## What this change deliberately did NOT do

- **`/about`'s "איך זה עובד" section is untouched.** It was not in scope, and its one `קריינות` is
  scoped to `במודעות עם דמות` — Service B, where the voiceover is real — so it is accurate, not
  stale. Left as found (`(marketing)/about/page.tsx:75`).
- **`apps/web/src/app/home/pathway-cards.tsx:36` still promises `כתוביות וקריינות` for `הוק + דמו`**
  — the card a signed-in customer clicks to enter the A wizard, describing a voiceover the silent
  format cannot produce. Out of this change's scope (a `/home` surface, not marketing) and left for
  the founder; it is now the last place on the customer path selling the retired format.
  _(Fixed on this one point, 2026-09-23, in `0ade931` on branch
  `tweaks/landing-home-contact-demo`, not yet merged. The card body is
  now `…חיתוך לסרטון המוצר שלכם וכיתוב על כל צעד.`, so §4's two vocabulary rules hold on the
  `/home` entry card too. It was **not** the last such place: the same sweep found
  `apps/web/src/app/home/demos/page.tsx:40` saying the demo description helps `הקריינות`, fixed in
  the same commit to `הכיתובים` — which is what `demos.description` actually feeds
  (`pipelines/demo-step-plans.ts:1149`, `pipelines/copy.ts:322`). Everything else in this section
  stands.)_
- **No opengraph/twitter metadata was added.** There is none to update: the root
  `metadata` is two keys and there is no `metadataBase`, no `title.template`, no OG image. Worth
  knowing before the next metadata change — the root **description** is inherited by 15 of 20
  routes, the root **title** by 11, because every child route hard-codes its own `X | תבנית` string
  rather than using a template. The root is now the only title in the app using an em dash rather
  than a pipe; the founder's string was taken verbatim.

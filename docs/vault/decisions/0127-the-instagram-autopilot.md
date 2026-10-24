---
type: decision
status: verified
verified: 2026-10-24
method: "Founder task prompt of 2026-10-24 (the phone-menu link and the Instagram autopilot), decisions 3–19 and its for-the-record lines, and his approval of the plan the same day ('Approved, with these changes and answers': the Sentry marker every night, the setup's demo order, the character mapping, his four calls). The approved plan is ~/.claude/plans/pasted-content-id-9341-model-opus-pure-raven.md. MEASURED read-only in production before the build (a scratch tsx probe, no write): four Instagram accounts connected under the admin account; Tavnit the only admin-owned business; its demos 'Service A' and 'Service B' ready with approved plans; active hook clips per persona; no social_posting, tiktok_posting or autopilot row; 16 Instagram posts in 14 days, 3 הוק + דמו with a sound and 1 with an empty caption. Built on feat/instagram-autopilot: supabase/migrations/0070_autopilot.sql; packages/core/src/pipelines/autopilot.ts, autopilot-setup.ts, autopilot-email.ts, zoned-time.ts; the hooks in social.ts, social-failure-email.ts, handlers.ts, jobs/schedule.ts, demo-step-plans.ts; apps/worker/src/autopilot-checkin.ts, reporting.ts, index.ts; apps/web/src/app/(posting)/autopilot/*, app/api/autopilot/**, the calendar. Pinned by packages/core/test/autopilot-night.test.ts (19 cases), autopilot-plan.test.ts (7), zoned-time.test.ts (5), migrations.test.ts (0070); apps/worker/test/autopilot-checkin.test.ts; apps/web/test/autopilot.test.ts (8). Fakes for Meta, Claude, the renderer and Resend; no paid call, no Meta call, no production write by the build."
source: founder + code
---

# 0127 — The Instagram autopilot

Tags as in 0099: **FOUNDER-REPORTED** (his ruling or reason), **MEASURED**, **REASONED**,
**PLANNING DEFAULT** (the build's choice under the prompt's latitude, kept at his approval). The
mechanics are in `docs/09-social-posting.md` §The autopilot.

## The decisions (FOUNDER-REPORTED, 2026-10-24, not up for relitigation)

3. **Founder-only first, behind its own switch, shaped like `social_posting`.** No row means admins
   only. Built so customers could use it later; nothing customer-facing ships now. His reason: he
   spends an hour a day making and scheduling posts and wants out of the loop entirely; quantity
   over quality, misses accepted. It reopens [[0101-tavnit-schedules-and-posts-to-instagram-and-tiktok]]
   ruling 12's "campaigns that generate themselves", which
   [[0124-the-next-version-is-taught-at-the-finished-video]] §2 deferred until there is real-user
   data — for him alone; customers stay behind the switch, and his run produces that data
   (planning's framing; he did not dispute it).
4. **Instagram only.** TikTok cannot run unattended: [[0115-tiktok-inbox-posting-pr4]] rejected
   direct post, an inbox draft needs him to finish each one in the app, and TikTok holds at most five
   unfinished drafts per 24 hours. His ruling.
5. **Service A only; C later; B never.** C has too few clips and unpolished text structures, and
   he will add C (and a C demo) when ready. B costs more and needs a person to listen — locked
   decision 5 also requires an audio preview before any voiced render. The rule for C: build
   nothing for it, and shape nothing so that a per-account C count later means redoing A's work.
6. **One setup, organised by account, not by service.** Each connected Instagram account gets
   on/off, its characters, A videos per day, the demos A rotates through, a posting window (his
   example for four posts: 12:00, 14:00, 17:00, 21:00). His choice; planning's reason: the account
   rules live in one place, and C later is one more count per account.
7. **Characters.** Each character page posts only its own character; the official page gets the
   three characters that have no page. The character pages are AI influencers and never mix; the
   page-less characters give the official page variety. **His mapping (FOUNDER-REPORTED, at
   approval, 2026-10-24) — the page names are not the character names:** shir_acreates → טליה,
   omri.creates → עומרי, yael_creates → שירה, tavnit.ai → נטלי, נהוראי and גלעד.
8. **Every post is its own render, and no video file goes to two accounts.** Planning's reason, from
   public reporting on Instagram's originality rules: Instagram recommends only the original of
   identical copies, and an account posting mostly copies drops out of recommendations. He accepted
   it.
9. **Volume.** Four a day per character page, each with a different hook clip, the same clips again
   the next day; the official page's count is his choice. No hook clip runs twice in a day on one
   account, so an account's count cannot exceed its active clips. Planning's reason: near-identical
   posts close together drag each other down, and the bank caps variety, not the hook lines.
   _Reading:_ "the same clips again the next day" is read through 12 — clips repeat across days in
   least-used order, so an account with more clips than posts cycles through all of them.
10. **Demos are picked per account, by name, in the setup, and he can add more any time** (today
    "Service A" and "Service B"; a C demo later). He wants to choose what the videos show.
    PLANNING DEFAULT kept: a demo joins once it can render an A video; until then the setup shows
    that it cannot, and why. **His ask at approval (2026-10-24):** nothing is preselected — he picks
    each account's demos himself; named demos sit at the top of the setup's list, unnamed ones
    below, each group in today's order (newest first). The setup's list only; the wizard pickers and
    `/home/demos` are unchanged.
11. **It runs every night, unattended, until paused**, rendering in quiet hours and scheduling across
    each window through today's path; no daily button. His reason: set and forget. Planning's: renders
    queue one at a time, so quiet hours mean no customer waits behind it; the existing path keeps the
    calendar, statuses and failure email.
12. **Rotation is least-used first, per account: hook clip, demo and sound. A hook line is never
    used twice.** Every clip gets used.
13. **Sound comes from one saved list he picks once, with the existing picker.** A refused sound is
    skipped for the next one; one email when the list runs low. Planning's reason: a saved sound
    publishes on the Page token, which does not expire (MEASURED: `publish_post` reads only the
    sound's `audioId`, on the Page token; the User token is the search's alone). An A video has no
    audio of its own, so it never posts without a sound.
14. **No caption.** No AI-written captions, and no need for any.
15. **No AI label — his deliberate decision, with no reason given, against planning's
    recommendation.** Both sides: Meta's Community Standards (Misinformation, read 2026-10-12,
    docs/09) "require people to disclose, using our AI-disclosure tool, whenever they post organic
    content with photorealistic video … and we may apply penalties if they fail to do so". Planning
    recommended the label for that reason; he ruled against it.
16. **No credits and no caps, through docs/05's admin bypass.** It is admin-only for now; pricing
    waits for a public release. _Reading:_ "no caps" is credits and the per-account caps the bypass
    lifts (docs/05). The platform-wide `assertBudget` stays (it has no role bypass by design), and so
    does a runaway valve on the paid hook-line call (CLAUDE.md: no paid call in a loop without an
    explicit cap) — neither limits the counts he can save.
17. **Failures.** Email only when his decision is needed; never post broken; never stop quietly;
    retry or swap before stopping.
    - Quiet: Meta hiccups (retried), Instagram's daily limit (it waits, as today), a refused sound
      (the next one), a failed render (one retry, then another version for that slot).
    - Never posted broken: only a finished render with a sound, on the right account; otherwise the
      slot is skipped and shows on the calendar.
    - Pauses the account and emails once: a lapsed connection, no usable sound, a character with no
      active clips, Meta refusing the video file itself, a day with nothing posted.
    - A night that never runs: a Sentry alert, if his plan has check-in monitoring; nothing new or
      paid otherwise.
      _Reading of 11 against 17:_ the failure email stays unchanged for manual posts; autopilot posts
      are left out of it, and a stop reaches him once, as the pause email.
18. **Autopilot posts are marked on the calendar** — to tell them apart now and compare later.
19. **Not doing:** TikTok, B, C, captions, the AI label, analytics, an approve-before-posting mode,
    credits or pricing, anything customer-facing beyond the switch.

**His calls at approval (2026-10-24):**

- **The Sentry marker** is written every Israel night once planning finishes, also when no account
  is due or no setup exists: the check-in means "the night ran", so accounts off or paused never
  trip Sentry; a night that never runs, or whose planning keeps failing, still alerts.
- The phone-menu PR carries its own records (0126). The check-in is on from the merge — he
  confirms in Sentry that a missed check-in emails him. Autopilot renders are visible in the
  library like any render.

## Planning defaults (kept at approval)

- **Storage**: three tables (0070), server-only; accounts keyed on Instagram's own id, so a
  disconnect and reconnect keeps the settings. The slot table's unique indexes are 8's, 9's and
  12's rules.
- **The night**: one self-rescheduling singleton, `autopilot_tick`, every 60 s on the light lane.
  Planning at 03:00 Israel (unique on both clock-change days, five hours before the earliest
  post); a save, a switch-on or a resume starts with the next 03:00; a box that was down at 03:00
  still plans late for an account that was on. Posting times 08:00–23:55 in 5-minute steps; the
  count fills the earliest times.
- **Renders**: one autopilot render on the heavy lane at a time, across every setup (a customer
  waits behind at most one). Attempt 3's "another version" keeps the clip when no other is free.
  A slot posts at most 2 h after its time, or is skipped `late`.
- **The sound swap**: inside `publish_post` for autopilot posts only, at most 2 swaps a post; a
  refusal at `media_publish` is not swapped; an audio-named refusal marks the sound at once, an
  ambiguous one after another sound posts.
- **Pauses**: the first cause wins; a pause cancels the account's open slots and its autopilot posts
  that have not started; every cause resumes by hand on the setup card. Switching an account off by
  hand cancels the same way, clears a pause and sends nothing. "Nothing posted" judges only the
  slots made since the account was last switched on, and never a day a pause or a switch-off
  touched.
- **Emails**: one per pause, accounts paused within one sweep folded; one per low-sound episode,
  under 3 usable sounds; the shared 20-a-UTC-day ceiling, a held email after 00:00 UTC.
- **Hook lines**: the wizard's own generator and prompt, untouched; at most 4 writer runs a setup a
  night, failures included, each at most 2 Claude calls (the writer regenerates once after an
  unrenderable character), so 8 at worst; REASONED cost ~₪0.13 a call, 2–4 calls on a normal night.
- **Variety**: among equally used clips, the character used least that day first (7's variety).
- **No jitter**: posts go out at his times.
- **The post page** still edits an autopilot post (caption, AI tick, time are his act); a sound he
  removes is put back at publish.

## MEASURED in production (read-only, 2026-10-24, before the build)

Four Instagram accounts connected under the admin account (shir_acreates, omri.creates,
yael_creates, tavnit.ai). Tavnit (`1b237001`) is the only admin-owned business. "Service A"
(`17c112d9`) and "Service B" (`32e93f95`) are ready with approved plans. Active hook clips: שירה 6,
עומרי 5, טליה 4, נטלי 4, נהוראי 4, גלעד 4. No switch rows. Three הוק + דמו posts went out with a
sound and one with an empty caption (docs/09 corrected).

## Built beyond the plan, from the diff review (2026-10-24)

- Failures pause an account only from slots made since it was last switched on, so a resume is
  never undone by the post that caused the pause.
- A late plan books no time already past its 2 hours.
- The night renders only for an admin-owned business, so no debit or classifier call runs inside the
  slot's transaction until customers are built on purpose.
- The hook-line valve counts writer runs (each at most 2 Claude calls), not calls.
- A character with no active clips cannot be switched on.
- The autopilot's emails are admin-only today, so §5 is unchanged; it names them before
  the switch opens to customers.

## Unverified

- What Meta returns for a withdrawn sound (docs/09 check (m)): the swap covers an `ERROR` and a
  creation refusal either way.
- Whether his Sentry account's one included cron monitor is free; the monitor creates itself on the
  first check-in. His check.
- No signed-in walk; the setup and calendar were seen in a harness (`packages/core/.work/shots-0127/`).

## Related

[[0101-tavnit-schedules-and-posts-to-instagram-and-tiktok]] ·
[[0107-social-posting-pr3-tick-landing-line-failure-email]] ·
[[0124-the-next-version-is-taught-at-the-finished-video]] ·
[[0125-demos-get-an-optional-name-never-read-by-a-model]] ·
[[0126-the-demos-page-is-in-the-phone-menu]] ·
[[0037-the-worker-reports-to-sentry-the-web-apps-do-not]]

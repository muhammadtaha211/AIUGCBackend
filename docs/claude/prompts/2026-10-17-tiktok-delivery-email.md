Model: Sonnet 5.5. A well-scoped follow-up: one email, copy in four places, one hardening. It touches core and web, so plan mode first.

# PR 4.1: the TikTok delivery email and the door

Read first: `docs/09-social-posting.md` (the TikTok section and runbook), `docs/vault/state-of-play.md`, `docs/vault/decisions/0115*`, `docs/vault/CONVENTIONS.md`, and the failure email's code and copy, which this PR mirrors. Save this prompt under `docs/claude/prompts/` and the approved plan under `docs/claude/plans/`.

## 1. Goal

When a TikTok draft reaches the owner's inbox, Tavnit emails them at that moment: which video, which account, the exact path to it inside TikTok, a link to the post page, and one line that unfinished drafts block new ones. Everywhere Tavnit talks about a TikTok draft, it names that same path. The TikTok-only schedule step says what the time is for: the draft and the reminder arrive then, the final touches stay in TikTok, and עכשיו sends it now. A pasted newline in an environment value can no longer break a provider key.

## 2. Decided

Record per CONVENTIONS.md, with reasons. Not up for relitigation.

- **A delivery email for TikTok drafts.** Reason: the owner is not in Tavnit when the draft lands, TikTok's own notification is easy to miss (the founder missed it on the live run, knowing what to look for), and email is the only channel Tavnit has. One email per delivered draft, sent on the first transition to `delivered` whatever moved it (webhook or poll), never twice for one post; folded per sweep like the failure email; same sending path, same ceiling, same switch logic as the failure email. Content: the video's name, the account, the three-step path below, a link to the post page in Tavnit, one line that unfinished drafts block new ones.
- **The path, as observed on the live run of 2026-10-17 (founder-reported):** TikTok → the **Inbox** tab (תיבת דואר נכנס) → **System Notifications** (התראות מערכת) → the notification "Your content from Tavnit is ready" → tap → TikTok's editor. The notification's Hebrew wording was not observed; quote the English and describe the rest by tab names, in Hebrew with the English in parentheses, since owners run TikTok in either language. Use this path verbatim in four places: the TikTok card's lead, the schedule note shown when TikTok is picked, the delivered line on the post page, and the email.
- **Scheduling stays as it is.** Reasons: a draft plus an email at the chosen time is a routine an owner can keep, while a pile of drafts is not; TikTok caps pending uploads at five per account per day, so "send everything now" fails on the sixth and the hourly deferral would schedule invisibly; in a mixed schedule the draft should land when the Reel goes live. What changes is the sentence: the TikTok-only step says the time is when the draft and the reminder email arrive, that sound, caption and posting are done in TikTok, and that עכשיו sends it right away.
- **Trim every environment string in the shared config.** Reason: on 2026-10-17 a Vercel value began with a newline and TikTok refused `client_key=%0A…`; this must not be possible again, for Meta's keys as much as TikTok's.
- **Not now, on purpose:** a reminder when a draft is still unfinished after a day; per-user email preferences; Instagram's deauthorize callback. Leave them as named next steps in state-of-play.

Founder-reported state for state-of-play, if the PR 4 close-out did not already record it: the live run t1 to t6 passed on 2026-10-17; the post made from the TikTok editor was public; the sandbox kept its own URL properties list and needed its own domain verification; the box runs the PR 4 code with the failure email on; the sandbox pair is on Vercel Production and the box.

## 3. Unverified: confirm before relying on it

- Whether the PR 4 close-out landed (docs/09 runbook line on sandbox URL properties, the fact note, 0115, strings FINAL, state-of-play). If not, do it first, as its own commit.
- How the email log records kind and platform, and whether adding a delivery kind needs a migration. If it does, stop and ask.
- The post page URL the email should link to, and that it opens signed in (the failure email once linked to a page that did not exist).
- Resend's daily ceiling and how `heldByCeiling` applies to a new kind; the delivery email must count against the same ceiling.
- Which copy strings on the schedule page render for TikTok-only, mixed, and Instagram-only, so the new sentence appears only when TikTok is picked.

## 4. Limits

- No migration, merge, deploy, env change or production write without the founder's explicit OK, each separately.
- No new library. Legal pages stay held: report the owed privacy sentence about this email, don't edit the page.
- Don't change delivery mechanics, the webhook, the tags, or anything on the Instagram path.
- All copy Hebrew; list new strings as DRAFT, subject and body included.

## 5. Latitude

Everything else from the repo: where the email is composed, how the fold groups drafts, how the schedule step phrases the three facts in the house register. Plan mode first; if the repo contradicts the goal or a decision, stop and report.

## 6. Done when

1. Plan approved. Stop there first.
2. Built with tests (one email per post across webhook-then-poll and poll-then-webhook; fold of several drafts; ceiling; switch; the trim). docs/09 and the vault updated. PR open. Stop for the founder's OK to merge.
3. After merge, box pull and restart on his OK: he schedules one TikTok draft a few minutes ahead and receives one email with the path, the account, the video's name and a working link; the four copy places read as decided; a second delivery in the same sweep folds into one email.

## 7. Report back

Screenshots of the four copy places and of the received email; the DRAFT strings; the owed privacy sentence in full; what differs from this prompt.

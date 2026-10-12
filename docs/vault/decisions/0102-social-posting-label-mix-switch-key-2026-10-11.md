---
type: decision
status: verified
verified: 2026-10-11
method: "Founder decisions 1–5 of §2 of the task prompt 'social posting PR 2 (connecting accounts), with five changes' (2026-10-11), each given as 'Decided on 2026-10-11 … Not up for relitigation' with his reasons, plus that prompt's two planning defaults; the session's plan for them approved at Stop 1 the same day (one question answered in chat: merge the docs PR first, then branch). MEASURED in the tree at feat/social-posting-connect: supabase/migrations/0060_scheduled_posts_ai_label.sql; packages/core/src/db/schema.ts (scheduledPosts.aiLabel); packages/core/src/pipelines/social.ts (SOUND_VOLUMES, socialPostingSchema, getPostingAccess, schedulePosts, updateScheduledPost, handlePublishPost); packages/core/test/social-publish, social-accounts, meta-graph and migrations tests (69 passing on the four files, 2026-10-11)."
source: founder
---

# 0102 — Five changes to what PR 1 built: the AI label is the customer's, the mix is per service, the switch names accounts, Instagram first, the key handed over unseen

Tags as in 0101: **FOUNDER-REPORTED** (his ruling, statement or reasoning), **MEASURED** (read in
the tree or run), **REASONED** (inference from what is cited), **PLANNING DEFAULT** (assumed by
the planning assistant, kept at his approval and not otherwise ruled). All five are
FOUNDER-REPORTED, 2026-10-11, not up for relitigation. They change
[[0101-tavnit-schedules-and-posts-to-instagram-and-tiktok]], whose dated pointers lead here.

> **2026-10-12 — a second switch sits beside this one's
> ([[0105-instagram-stays-on-facebook-login-one-window-setup-behind-a-switch]]):**
> `app_config.instagram_connect` chooses which Facebook window "חיבור חשבון" opens (`"onboarding"`
> = Meta's one-window setup; absent = today's). It is read only behind `social_posting`'s gate, so
> a hidden account still sees no trace; §4's single Instagram card is unchanged.

## 1. The AI label is the customer's choice, per post, unticked by default on every service

**Replaces** 0101's plan default (§10 Q1): `is_ai_generated=true` on הוק + דמו and דמות AI, never on
גוש טקסט, decided per service in code (`AI_LABELLED_SERVICES`). **Options:** that per-service
default, or the customer ticks it per post. **His reason:** let the user decide, the way a
competitor does.

**MEASURED:** `scheduled_posts.ai_label boolean NOT NULL DEFAULT false` (migration 0060, written
in this task and **applied to production 2026-10-11** on his instruction, before PR 2 merged — read
back before and after, [[production-migration-push-log]]); `schedulePosts` takes `aiLabel` (absent =
false) and stores it on every row of the batch; `updateScheduledPost` changes it while the post is
pending; the publish job sends `aiGenerated: post.aiLabel`, and the provider sends no
`is_ai_generated` field at all when it is false (`meta-graph.ts`, pinned in `meta-graph.test.ts`).
`AI_LABELLED_SERVICES` is deleted. The checkbox is web PR 3's.

**His instruction:** the draft legal text must not say that videos are labelled. The approved plan's
§12 terms draft ("AI-made videos are labelled") is withdrawn with this note.

## 2. The mix, per service

**Replaces** 0101's plan default (§10 Q2): `audio 100 / video 0` for a silent render and
`audio 35 / video 100` for one with its own sound.

| service   | the picked sound (`audio_volume`) | the render's own audio (`video_volume`) |
| --------- | --------------------------------- | --------------------------------------- |
| הוק + דמו | 100                               | 0 (the video is silent)                 |
| דמות AI   | 15                                | 100 (the voice)                         |
| גוש טקסט  | 100                               | 40 (the clip's own sound)               |

**His reason:** where nobody speaks the music leads; where the character speaks the speech must
sit clearly on top. Planning picked the numbers at his request. **Nothing is measured**; they are
judged on the first live posts.

**MEASURED:** `SOUND_VOLUMES = {a, b, c}` in `pipelines/social.ts`; `social-publish.test.ts` pins
each service's container at those numbers. **REASONED, the session's call, approved at Stop 1:** a
retired "full"-format A render (CLI only, vault 0020) has a voiceover, so it takes דמות AI's mix.

**Consequence for PR 3 (REASONED):** Appendix A's mix line for "a video with its own sound" ("the
video's own soundtrack plays in full, the sound plays softer in the background") is wrong for גוש
טקסט now; PR 3 drafts a line of its own for C.

## 3. The switch gets a third setting: named accounts

**Replaces** 0101's two settings (`admins` | `everyone`). **His reason:** Meta's reviewer has to
walk the flow inside Tavnit, and an admin account can open every customer's business.

**MEASURED:** `app_config.social_posting` is `{"access":"admins"}` (also what an absent row means),
`{"access":"named","userIds":["<uuid>",…]}` or `{"access":"everyone"}`. Admins are always allowed;
under `named` a listed account is allowed too (ids compared case-insensitively). **A row that does
not parse hides the feature** instead of throwing: `getConfigValueOr` threw, which would have
turned a customer's 404 into a 500, a trace of the feature (the session's call, approved at Stop
1). Accounts are named by user id rather than email because an id never changes. The SQL that names
one by email is in `docs/09-social-posting.md` §"The switch".

## 4. Instagram first, TikTok after

TikTok stays the last PR (PR 4 of the approved plan). PR 2 renders no TikTok card and builds no
TikTok pre-screen. **FOUNDER-REPORTED:** no TikTok developer app exists (2026-10-11).

## 5. `SOCIAL_TOKEN_KEY` is generated by the session and never shown

**Replaces** docs/09's instruction that he generate the key with a `node -e` that printed it to the
console. **His terms:** its value never appears in terminal output, the transcript, a commit or a
report; then the session walks him through placing the same value on Vercel, on the box and in his
local web env (each placement its own OK — §4 of his prompt).

**The way (the session's, approved at Stop 1):** one `node -e` writes 32 random bytes, base64, to a
file outside the repo with the `wx` flag (it refuses to overwrite: a new key makes every sealed
token unreadable) and prints nothing. The only thing ever reported is a fingerprint, the first 8
hex characters of the value's SHA-256, so the three places can be compared without displaying it.

## Planning defaults of the same prompt (PLANNING DEFAULT, unstruck)

- Live checks use the box on `origin/main`, never a task branch. PR 1's worker code is already
  there. (0101's OPEN "live-test executor" question is answered by this.)
- `instagram_manage_messages` is unused; the runbook tells him to remove it before review.

## Related

- [[0101-tavnit-schedules-and-posts-to-instagram-and-tiktok]] — the decisions these change.
- [[0061-landing-positioning-two-services-no-results-claims]] — §3's wording about AI marking is
  checked against change 1 in the PR 2 report, not edited.

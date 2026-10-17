---
type: falsified
status: superseded
verified: 2026-10-17
method: "The claim: docs/vault/decisions/0115-tiktok-inbox-posting-pr4.md §4 and docs/09-social-posting.md §TikTok, as written 2026-10-16. What killed it: the read-only query in [[tiktok-inbox-live-run-2026-10-17]] (a posted TikTok row with `provider_media_id` and `permalink` set) and WebFetch of https://developers.tiktok.com/doc/add-a-sandbox on 2026-10-17, asked what the page says about public posts from a sandbox app."
source: db
---

# "A sandbox post cannot be public"

## The claim

Written 2026-10-16 in the PR 4 session (Claude, planning and building), in 0115 §4 and docs/09's
webhook section: "a sandbox post cannot be public, MEASURED on add-a-sandbox", and from it that "no
sandbox run yields a post id", so the player-URL permalink behind «צפייה בפוסט» could only be checked
after TikTok's audit (t7).

## What killed it

**The sandbox produced a public post** on 2026-10-17. The posted row has a post id and a permalink
(TikTok sends a `post_id` only for a public post), and the founder reports the post he finished in
TikTok's editor was public ([[tiktok-inbox-live-run-2026-10-17]]).

The page never said it. Read again on 2026-10-17, add-a-sandbox says only that sandbox mode "does
not offer access to Content Posting API for public videos". That is about what the API can post on
its own. With inbox upload, the owner finishes the video inside TikTok's own editor and picks who sees
it there, so nothing Tavnit sends decides it. The 2026-10-16 note read the sentence as a rule about
the post and labelled the reading MEASURED. It was an inference from one sentence that names neither
inbox upload nor direct post.

## What stands

The permalink stopgap is unchanged; only its check moved up: t7 is the founder's look now, not after
the audit. Direct post stays rejected for the reason in
[[tiktok-api-attaches-no-sound-2026-10-16]], which does not depend on this claim.

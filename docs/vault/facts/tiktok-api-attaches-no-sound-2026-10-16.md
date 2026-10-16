---
type: fact
status: verified
verified: 2026-10-16
method: "Read live on 2026-10-16 through WebFetch, several narrow prompts per page, by an independent reader and re-checked by a critic: https://developers.tiktok.com/doc/content-posting-api-reference-direct-post (the post_info and source_info tables, the error codes), https://developers.tiktok.com/doc/tiktok-api-scopes (the full scope table), https://developers.tiktok.com/doc/content-posting-api-reference-query-creator-info (linked from the direct-post page), https://developers.tiktok.com/doc/content-posting-api-reference-upload-video (the inbox init body). The founder checked the first two pages himself the same day (task prompt §2)."
source: browser
---

# TikTok's API attaches no sound: not on direct post, not on the inbox upload, and no scope for it (2026-10-16)

The evidence behind [[0115-tiktok-inbox-posting-pr4]] §1 — direct post rejected, inbox only,
because music is a must ([[0101-tavnit-schedules-and-posts-to-instagram-and-tiktok]] decision 2).

**MEASURED — the direct-post reference**
(`https://developers.tiktok.com/doc/content-posting-api-reference-direct-post`):
`POST https://open.tiktokapis.com/v2/post/publish/video/init/`, scope `video.publish`. Its
`post_info` takes exactly `privacy_level`, `title`, `disable_duet`, `disable_stitch`,
`disable_comment`, `video_cover_timestamp_ms`, `brand_content_toggle`, `brand_organic_toggle` and
`is_aigc`. No field sets music, sound or audio, and the page never mentions music, sound, audio or
the Commercial Music Library. `source_info` is the file (`PULL_FROM_URL` or `FILE_UPLOAD`) and
nothing else. The creator-info query it links to (`…/content-posting-api-reference-query-creator-info`)
returns no music field either.

**MEASURED — the scopes reference** (`https://developers.tiktok.com/doc/tiktok-api-scopes`): the
scopes are `local.product.manage`, `local.shop.manage`, `local.voucher.manage`, the eight
`portability.*`, the four `research.*`, `user.info.basic`, `user.info.profile`, `user.info.stats`,
`video.list`, `video.publish` ("Directly post content to a user's TikTok profile") and `video.upload`
("Share content to creator's account as a draft to further edit and post in TikTok"). **No scope
concerns music, sounds or the Commercial Music Library.**

**MEASURED — the inbox upload** (`https://developers.tiktok.com/doc/content-posting-api-reference-upload-video`):
`POST /v2/post/publish/inbox/video/init/` takes `source_info` alone — no title, no music, no label.
The owner adds the sound in TikTok's editor, after opening TikTok's inbox notification.

**FOUNDER-REPORTED, not on these pages:** TikTok's Commercial Music Library is in-app only. None of
the pages read names it; the only music reference on any of them is the "Music Usage Confirmation"
declaration the content-sharing guidelines ask a direct-post screen to show
(`https://developers.tiktok.com/doc/content-sharing-guidelines`).

Re-read before relying on it after 2026-10-30 (CONVENTIONS: 14 days); a new `post_info` field or a
music scope would reopen the question, which is then the founder's.

Model: Opus 5.5. Two packages, probably a migration, a new provider with a webhook, and vault notes that must keep measured and reasoned apart. Start in plan mode.

# PR 4: TikTok inbox posting

Save this prompt as `claude/prompts/2026-10-16-tiktok-inbox-posting.md` and the approved plan under `claude/plans/` before building anything.

Read first: `docs/09-social-posting.md`, `docs/vault/state-of-play.md`, `docs/vault/CONVENTIONS.md`, `docs/vault/decisions/0101*` and `0105*`–`0108*`, `docs/repo-map.md`, then the Instagram implementation they map: the connect route and callback, the schedule flow, the worker's publish job, the tile tags, the failure email, the switch. It is the pattern to follow.

TikTok's pages. Read them; do not work from memory:
- Login Kit web: https://developers.tiktok.com/doc/login-kit-web
- Tokens and refresh: https://developers.tiktok.com/doc/oauth-user-access-token-management
- Inbox upload: https://developers.tiktok.com/doc/content-posting-api-get-started-upload-content and https://developers.tiktok.com/doc/content-posting-api-reference-upload-video
- Post status: https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status
- Media transfer and domain rules: https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide
- Webhooks: https://developers.tiktok.com/doc/webhooks-overview, /doc/webhooks-events, /doc/webhooks-verification
- Guidelines (the watermark rule applies to us): https://developers.tiktok.com/doc/content-sharing-guidelines
- Sandbox: https://developers.tiktok.com/doc/add-a-sandbox
- For the fact note: https://developers.tiktok.com/doc/content-posting-api-reference-direct-post and https://developers.tiktok.com/doc/tiktok-api-scopes

## 1. Goal

A Tavnit user named in the TikTok switch can connect a TikTok account in הגדרות → חיבורים, pick it, alone or alongside Instagram accounts, when scheduling a video, and at the scheduled time the worker delivers the video as a draft to that account's TikTok inbox. The owner finishes in TikTok: sound, caption, publish. The tile shows one tag per platform; TikTok's reads נשלח לטיקטוק when the draft lands and פורסם once TikTok's webhook says the owner posted it. An authorization revoked inside TikTok marks the account disconnected. Failures take the existing failure path and email. Nobody outside the switch sees any of it.

## 2. Decided

Record each in `docs/vault/decisions/` per CONVENTIONS.md. Not up for relitigation.

- **Inbox only; no direct post, not deferred, rejected.** 0101 stands, now on evidence: TikTok offers no way to attach a sound by API. Checked 2026-10-16 on the direct-post reference (post_info takes privacy_level, title, disable_duet/stitch/comment, video_cover_timestamp_ms, brand_content_toggle, brand_organic_toggle, is_aigc; nothing for music), on the scopes reference (no music scope exists), and TikTok's Commercial Music Library is in-app only. Also write this as a fact note with those URLs and the date. The founder's rule: music is a must.
- **No caption, no sound, no AI tick for TikTok.** The inbox init carries only the file; the owner adds everything in TikTok. The quiet AI tick controls Instagram only and is not shown when no Instagram account is selected.
- **Tags per platform.** Today's rule (מתוזמן while any post waits; the terminal word once one went out and none wait; no tag when the only post failed) now applies per platform, each platform its own tag with its icon, Instagram first. Instagram's terminal word stays פורסם. TikTok's is נשלח לטיקטוק on inbox delivery and פורסם on the published webhook. Never more than one tag per platform on a tile.
- **Webhooks in this PR.** Callback `https://tavnit.ai/api/social/tiktok/webhook`, registered in the production draft (and meant to be in the sandbox; see Unverified). Handle inbox-delivered, published and authorization-removed; verify TikTok's signature with the client secret; ignore events we don't handle; idempotent. Reason: without them we know only that we sent a file, and the founder wants the calendar to show which drafts the owner never finished.
- **A TikTok switch independent of Instagram's**, same mechanism and modes. Meta's review and TikTok's audit will clear on different days.
- **Redirect URI `https://tavnit.ai/api/social/tiktok/callback`, exactly; scopes `user.info.basic` and `video.upload`; Web only.** This is what the console holds.
- **Sandbox credentials until TikTok's audit passes, the production pair after.** Connections made on sandbox credentials carry sandbox open_ids and will need reconnecting after the switch; design so that is a reconnect, not a data repair.
- **Tokens never reach browser script.** If a provider step needs that, stop.

Founder-reported external state, for state-of-play as founder-reported (2026-10-14 to 16):
- Meta: business portfolio "Tavnit" (ID 1147255727975713); legal name טאהא מוחמד, address ת"ד 929, כאבול 2496300, website tavnit.ai. Business verification filed 2026-10-14 on the אישור עוסק פטור, confirmed by email code to muhammad@tavnit.ai (a Namecheap forward to the founder's Gmail); status "In review". App 1728633468194967 declared Tech Provider; the portfolio is connected under Review → Verification; access verification is locked until business verification completes. Still owed on Meta: the Website platform on Basic (unverified whether added), reviewer account, recording, app review, the privacy page's address and connected-accounts text.
- TikTok: developer app "Tavnit", production draft saved 2026-10-16 with a placeholder demo video, not submitted. Domain property tavnit.ai verified by DNS TXT at Namecheap. Platform Web https://tavnit.ai; Terms /terms; Privacy /privacy. Products: Login Kit (Web redirect above), Content Posting API with Upload on and Direct Post off, Webhooks (callback above). Scopes user.info.basic, video.upload. One sandbox cloned from the draft, with one target user.
- tavnit.ai DNS is at Namecheap; mail forwarding muhammad@tavnit.ai → Gmail; Resend's records untouched.

## 3. Unverified: confirm in the tree before relying on it

- `social_accounts.platform` (or its equivalent) accepts `tiktok`, and whether that needs a migration. The one-live-row-per-account index with a TikTok open_id as the external id.
- The schedule flow's account picker with mixed platforms; where the tile tag rule lives.
- How the worker reaches the rendered file today (storage path, signed URL). This decides the transfer method (Latitude).
- Whether renders carry any Tavnit mark or logo. TikTok's guidelines forbid watermarks on content shared to TikTok; if they do, stop and report before building delivery.
- The TikTok env names in docs/09 and the env schema both apps use. The founder pastes the sandbox pair into Vercel and the box once you name the variables; never into the repo or the chat.
- The switch's table and key, and how `named` lists accounts.
- Whether the box is on main and holds `RESEND_API_KEY`. The failure email needs both, and nobody has reported either.
- Whether the sandbox's webhook field carries the callback; the founder was told to set it, not confirmed.
- From TikTok's pages: token lifetimes and refresh rotation; the inbox init/upload/status contract, including status values for inbox uploads and any pending-draft cap; webhook event names, payloads and signature scheme; Login Kit web parameters (state, PKCE).

## 4. Limits

- No migration applied, no production write (the switch SQL included), no env change, no merge, no deploy, no provider spend, and no TikTok "Submit for review", without the founder's explicit OK, each one separately.
- No new library without his OK.
- Legal pages stay held: report owed text, don't edit it.
- Don't change the Instagram publish path beyond the tag rule. No direct-post code, not even behind a flag.
- All user-facing copy in Hebrew; list every new string as DRAFT in the report.

## 5. Latitude

- Implementation from the repo and the Instagram pattern: provider shape, refresh scheduling, status polling next to webhooks, how פורסם links to the post once TikTok gives an id.
- Transfer method: TikTok's guideline says server-held files "should" use PULL_FROM_URL from a verified domain; tavnit.ai and its subdomains are verified, the storage domain cannot be. Choose FILE_UPLOAD or PULL_FROM_URL by what the repo can serve over https, without a redirect, for the hour TikTok allows; say why in the plan.
- Plan mode first. If the repo contradicts the goal or a decision, stop and report; don't improvise.

## 6. Done when

1. The plan is approved by the founder. Stop there first.
2. Built with tests; docs/09 gains a TikTok section (flow, env names, the sandbox→production runbook, the console state above, live checklist); vault notes written; PR open. Stop for his OK to merge.
3. After merge, his env placement, the box pull and the switch SQL, each on his OK: live checks in the sandbox with the target user. Connect → the account listed → schedule → the draft appears in the TikTok app's inbox → tile shows נשלח לטיקטוק → the owner posts from TikTok → tile shows פורסם via the webhook → revoke in TikTok's settings → the account shows disconnected → a forced failure takes the failure path and sends the email. Leave the sandbox in a state he can record the audit demo from, with the step list.
4. The three Instagram checks nobody reported: (k) a הוק + דמו with a sound viewed logged out; (o) the forced failure's notice and email; (w) whether sound search works on the Page token. Run what code or a probe can run; hand him the rest as steps.

## 7. Report back

- Before building: the plan. Data shape, transfer method and why, webhook handling, what the switch gates, any stop from §3.
- After: screenshots of connect, a mixed-platform schedule, a tile with both tags; each live check with evidence; the TikTok env names and where each goes; the switch SQL to run; the DRAFT strings; what differs from this prompt; what is owed outside the code (privacy page, legal text, the audit demo steps).

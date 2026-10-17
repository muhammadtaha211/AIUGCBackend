Model: Sonnet 5.5. Legal copy that must match what the code actually does; one package, no plan mode, but every sentence is DRAFT until the founder approves it.

# Privacy and terms: connected accounts, address, emails

Read first: the live pages' source for /privacy and /terms, `docs/09-social-posting.md`, `docs/vault/state-of-play.md`, the connect and token code for both platforms, the email code (auth, failure, delivery from PR 4.1), Meta's data-deletion route, and `docs/vault/CONVENTIONS.md`. Save this prompt under `docs/claude/prompts/`.

## 1. Goal

tavnit.ai/privacy tells a reader the truth about connected social accounts: what Tavnit receives from Instagram and from TikTok, why, what it does with it, how long it keeps it, how to disconnect or revoke, and which emails Tavnit sends. It names the operator's registered address. The cookies section names the OAuth cookies. /terms carries a short connected-accounts clause if it has none. Both pages pass a reviewer at Meta and at TikTok who opens them to check that the policy covers their platform's data.

## 2. Decided

Record per CONVENTIONS.md.

- **The hold on the legal pages is lifted for this scope only:** address, connected accounts, OAuth cookies, emails and processors, a connected-accounts clause in the terms. Reason: both platform reviews open the privacy URL, a policy silent on the platform's data is a standard rejection, and the Tel Aviv address contradicts the business record Meta is verifying.
- **Address:** ת"ד 929, כאבול 2496300, as on the business registration. The operator's name line stays as it is unless it contradicts the Meta record (legal name טאהא מוחמד, trade name תבנית); if it does, report both versions and wait.
- **Connected accounts, one section, both platforms, from the code not from memory:** what is received (Instagram: Page and account identifiers and names, the tokens; TikTok: open_id, display name, avatar, the access and refresh tokens); that tokens are stored encrypted and used only to publish or deliver what the user scheduled; that Tavnit posts nothing the user did not schedule; how to disconnect in Tavnit and how to remove Tavnit inside Facebook or TikTok; what happens to tokens and scheduled posts on disconnect or revoke; what is kept afterwards (post history, if the code keeps it); that Meta and TikTok process the content under their own policies; Meta's data-deletion request route.
- **Cookies:** the OAuth state cookies for both platforms, by their real names, with purpose and lifetime from the code.
- **Emails:** every kind Tavnit sends, from the code: sign-in, failure, TikTok delivery, anything else found; Resend named as the processor for all of them, not only the auth emails.
- **Terms:** a short clause that the user is responsible for content posted to their own accounts and for complying with each platform's rules, and that Tavnit cannot guarantee a platform's acceptance or publication. Only if the terms have no such clause today.
- **Hebrew only**, house register, dated "last updated" line. Every new or changed sentence is DRAFT; nothing merges before the founder approves the text.

## 3. Unverified: confirm in the code first

- What /privacy and /terms say today, section by section; which processors they already name (Resend, Supabase, Vercel, PostHog, Sentry, Meta, TikTok) and which the code uses but the page omits. Fix only what this prompt scopes; list the rest as gaps in the report.
- The exact cookie names and lifetimes for both OAuth flows.
- What disconnect and revoke do to tokens and to scheduled or past posts, and what the post history keeps after an account is gone.
- The complete list of email kinds in the code and the sending address.
- Whether the Instagram data-deletion route is reachable and what it does, so the sentence about it is true.

## 4. Limits

- No merge or deploy without the founder's explicit OK on the text, shown in full first.
- No other page, no design change, no English version, no new section beyond the scope above.
- Describe only what the code does. Where the code is unclear, say so in the report rather than writing a reassuring sentence.

## 5. Latitude

Section placement, wording in the house register, how much of the platform mechanics to explain. If the pages contradict the code in a way outside this scope, stop and report rather than fix.

## 6. Done when

1. The report shows, for each changed section, the current text and the proposed text, with the code line that backs each factual claim. Stop for approval.
2. After approval: committed, PR open, merge on OK. tavnit.ai/privacy and /terms show the new text; the "last updated" line carries the date.

## 7. Report back

The current-versus-proposed text per section; the cookie and email facts as found; gaps outside scope; what differs from this prompt.

---

**Added by the founder in chat, 2026-10-17, with the prompt:** "i want the following prompt to be done in the same PR if possible, when you're done push and merge the PR". Done in PR #108 (the PR 4.1 branch), and merged by the session when finished, on that instruction.

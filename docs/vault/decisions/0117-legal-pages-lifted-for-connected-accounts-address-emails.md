---
type: decision
status: verified
verified: 2026-10-17
method: "Founder decisions in §2 of the task prompt 'Privacy and terms: connected accounts, address, emails' (2026-10-17, docs/claude/prompts/2026-10-17-privacy-terms-connected-accounts.md), and his instruction in chat the same day: 'i want the following prompt to be done in the same PR if possible, when you're done push and merge the PR'. MEASURED in the tree at feat/tiktok-delivery-email: apps/web/src/app/(legal)/{legal.tsx,privacy/page.tsx,terms/page.tsx}; apps/web/test/legal-pages.test.ts (21). Every factual sentence was checked against the code by four lenses (received and sent; disconnect, removal and retention; cookies and emails; terms, address and consistency), 114 claims found supported, 43 candidate problems raised, a skeptic per candidate confirmed 26 (many the same defect seen twice), all applied; the 17 refuted are in the PR 4.1 report. The code facts come from three read-only passes over packages/core/src/pipelines/social.ts, social-failure-email.ts, social-delivery-email.ts, secret-box.ts, providers/{meta-graph,tiktok,resend}.ts, apps/web/src/lib/social-oauth.ts, apps/web/src/app/api/social/**, apps/web/src/app/(legal)/social/deletion/[code]/page.tsx. No production write; no env change."
source: founder
---

# 0117 — The legal pages say what the connected accounts do: Instagram, TikTok, the registered address, the OAuth cookies, every email

Tags as in [[0115-tiktok-inbox-posting-pr4]]: **FOUNDER-REPORTED**, **MEASURED**, **REASONED**. §1–§5 are FOUNDER-REPORTED,
2026-10-17. The text itself is Hebrew and lives in the two pages; this note records why and what is
deliberately not in it.

## 1. The hold is lifted for this scope only

The legal pages were held (state-of-play, "owed while the legal pages are held, not edited"). Lifted
for: the operator's address, connected accounts, the OAuth cookies, emails and processors, and a
connected-accounts subsection in the terms. **His reason:** both platform reviews open the privacy URL,
a policy silent on the platform's data is a standard rejection, and the Tel Aviv address contradicts
the business record Meta is verifying. Everything else on the pages stays as it was.

**Options offered:** keep the hold and wait for counsel; lift it for the scope above; lift it
entirely. **Chosen: the scope.** Out of scope and reported, not touched: see §7.

## 2. The address is the registration's P.O. box — it supersedes 0058

`OPERATOR_ADDRESS` is now **`ת"ד 929, כאבול 2496300, ישראל`** (the registration's address, his words;
the file was not seen by this session). It supersedes [[0058-the-operator-address-is-a-tel-aviv-street-address]]
(`ברזיל 14, תל אביב`, 2026-09-17), which a card company's "reachable operator" requirement had
prompted ([[0057-the-upay-site-requirements-are-met-by-reorganising-not-re-deciding]]). One constant,
four surfaces: `/privacy` §1 (twice), `/terms` §1 and §16, `/about`, `/contact`. A test pins the constant and
fails on any "ברזיל 14" left under `apps/web/src`.

**Open, his call:** whether a P.O. box still meets the acquirer's reachable-operator requirement
(0057/0058 — nobody asked Upay); and the registration-versus-receipts alignment 0058 already named.

## 3. The operator's name line is unchanged; the Meta record's order is reported

The pages say **מוחמד טאהא (Mohammad Taha)**, given name first; the Meta record he cites has the legal
name **טאהא מוחמד**, family name first. The same two words in the other order is a presentation
difference, not an obvious contradiction, so the line stays and both versions are reported (his rule:
report both and wait). If Meta's verification string-matches the name, he changes one line in
`privacy/page.tsx` §1 and `terms/page.tsx` §1.

## 4. One section for connected accounts, from the code

`/privacy` **§13** (placed after "your rights" so the old §1–§12 keep their numbers: `docs/legal/` and
`docs/10-analytics.md` cite §10–§12, and "minors", "changes" and "contact" become §14–§16). It says what
is received from Meta and from TikTok (field by field), why, what is sent to each, how the tokens are
protected, how to disconnect in Tavnit and how to remove Tavnit in Facebook and in TikTok, Meta's
data-deletion request, and what stays and for how long. §3, §4, §5, §6, §7, §8, §9 and §12 carry the
short matching sentences. Each claim has a code line behind it; `apps/web/test/legal-pages.test.ts`
ties the names and numbers (cookie names and lifetimes, scopes, signed-link lifetimes, the cipher, what
disconnect and Meta's deletion clear and keep, who sends email) to the constants and the code.

**Where the code is less than a reader might assume, the text says so** (his rule: no reassuring
sentence the code cannot back):

- **Disconnect revokes nothing** at Meta or TikTok; it erases Tavnit's stored tokens and cancels posts
  that have not started. The account's name, picture link, ids and the whole post history stay.
- **Facebook does not tell Tavnit** about an ordinary removal; the connection simply stops working and is
  marked "פג תוקף" at the next daily check or publish attempt. REASONED from Meta's error codes, not
  observed live. The sealed tokens stay until the owner disconnects or asks for deletion.
- **Meta's data-deletion callback** erases tokens, username, name, picture and Page name only; the
  Instagram id, Page id, Facebook user id and every post row stay. The text says exactly that.
- **No automatic deletion** of either table, and none of `events` or `jobs`; the text says so.
- Whether Meta's **Data Deletion Request URL** is entered in the Meta app is not recorded as done
  (docs/09 runbook B); the sentence is conditional ("if the option does not appear, write to us").

## 5. Cookies, emails, processors, terms

- **Cookies:** `aiugc.social_oauth` and `aiugc.tiktok_oauth`, by their real names, `HttpOnly`, valid half an
  hour, kept up to 24 hours, holding only a random state, the Tavnit account id, a return path and the
  issue time — no token. Created when a signed-in account starts a connect, from settings **or** the
  schedule screen (review finding).
- **Emails:** §5's "the only messages" list now has the failure email and the TikTok delivery email
  (PR 4.1), §6 names Resend for all of them and says what each carries (business name, the connected
  account's name, platform, planned time, a sign-in-gated link; the user id in a technical header) and
  what it does not (tokens, captions, video). The receipt is Sumit's, not Resend's. There is no setting
  that stops the two emails.
- **Terms:** `/terms` §4 gains a short subsection (the connect authorises scheduled posts only; the user
  answers for what is posted to their own accounts and for the platform's rules; a platform may refuse,
  delay or remove; Tavnit cannot guarantee publication). The terms already said the user answers for
  platform rules (§4) and that Tavnit does not promise platforms accept the ads (§10); the new
  subsection adds the authorisation and the publication point, which they did not carry.
- The date at the head of both pages is **17.10.2026** (the one constant; also `terms_version` at
  checkout, which nothing compares).

## 6. His instruction to merge

The prompt said "nothing merges before the founder approves the text, shown in full first". His chat
message the same day said to do it in PR #108 and to push and merge when done. The session took that as
his decision to publish, showed him the full text in its report, and merged. The text was not read by
him before it went live; this note and the report are where he can check it, and a one-line change
reverts any sentence.

## 7. Outside the scope — reported, not changed

- **Sumit** receives, in the hosted-page URL, the business name, the account email, the checkout intent id
  and the Tavnit user id; §6 says only the email and the transaction details.
- **Sentry** (worker only) also receives alert events: a failed post's platform, kind and the first 200
  characters of Meta's or TikTok's error text; §6's Sentry paragraph is generic.
- **Gmail** hosts the public support mailbox and **Namecheap** holds the DNS (and a mail forward); the page
  names Google only for sign-in. The Supabase custom domain `auth.tavnit.ai` is not named.
- **Promises with no code behind them:** the email for a material change in the policy or terms, the 14-
  and 30-day price notices, replies to the contact form (it sends no acknowledgement), dunning (no email at
  `past_due` or suspension), the 30-day handling and the manual account deletion (never run end to end,
  and no code deletes a user; every foreign key is NO ACTION, so the social rows must go first).
- **§9** "only these items" is conditional: the Supabase PKCE verifier cookie (the page's "temporary
  cookie") is also created on sign-up and on forgot-password and lives up to 400 days; PostHog falls back
  to a cookie when `localStorage` is unavailable; the Supabase session cookie is not `HttpOnly`.
- **In-app copy:** the Instagram pre-screen says Tavnit uses the permission "only to find the accounts and
  publish"; the code also uses the user token for the sound search and the page token for a daily
  profile read, and the scope list includes `business_management` and `pages_read_engagement`. The policy
  now says what the code does; the pre-screen line was not changed.
- **`jobs/queue.ts:307`** says the janitor purges job rows; it does not.
- **Meta's deletion callback** erases less than "deletion" suggests (§4); extending it to the ids and the
  post history is a code change, not made here.
- **Whether the new terms subsection is a "material change"** that §14 promises 14 days' notice for — his
  or counsel's call, as with 0109's bullet.

## Related

- [[privacy-connected-accounts-claims-and-their-code-2026-10-17]] — each claim and the code line behind it.
- [[0058-the-operator-address-is-a-tel-aviv-street-address]] — superseded on the address.
- [[0116-tiktok-delivery-email-and-the-door]] — the delivery email §5 names; its owed `/privacy` sentence is now in the page.
- [[0115-tiktok-inbox-posting-pr4]] — the build; its "owed while the legal pages are held" item is closed here.
- [[0107-social-posting-pr3-tick-landing-line-failure-email]] — the failure email §5 names.
- [[resend-is-an-undisclosed-processor]] — the defect, now also closed for the worker emails.
- `docs/09-social-posting.md`, `docs/legal-review.md` (rows T2, P1, P11, E9; the owed list).

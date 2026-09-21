---
type: fact
status: verified
verified: 2026-09-21
method: "Four sources, kept apart and tagged per claim. (1) The quota reading: POST https://api.sumit.co.il/website/companies/listquotas/ with a Credentials body, run FROM THE BOX on 2026-09-21 with the real org's keys read out of apps/worker/.env inside the command, before the first purchase — Status 0. (2) The catalogue and global payment-page settings before any change: the founder's screenshots of the Sumit UI, read in chat 2026-09-21. (3) The settings he was then told to apply: recommended in chat the same day, applied by the founder, NOT observed by this session except where the first real purchase proves them ([[first-real-purchase-2026-09-21]]). (4) Sumit's own help articles (help.sumit.co.il 5507895, 5799412, 10792135, 14166702), read 2026-09-21 as text, not measured by us. The three payment-page URLs are the values set on the apps/web Vercel project. No key, company id or token is recorded here or was printed by any command."
source: founder + browser + code
---

# The founder's REAL Sumit organisation, as configured on 2026-09-21

Tags, used on every claim below: **[MEASURED]** this session ran it or read it out of a file;
**[FOUNDER-REPORTED]** he told us or showed a screenshot; **[RECOMMENDED IN CHAT]** we advised it
and he says he applied it, unobserved; **[PER SUMIT DOCS]** from a help article, read not measured;
**[REASONED]**; **[UNVERIFIED]**.

The TEST organisation is a different thing entirely — [[sumit-test-org-configuration]]. Where the
two deliberately differ, this note says so.

## The credentials and the quota [MEASURED]

`/website/companies/listquotas/` from the box answered **Status 0**, which is the whole point of
running it: the real org's keys authenticate. Before the first purchase it reported

| statistic                   | real org  | test org (for contrast) |
| --------------------------- | --------- | ----------------------- |
| ActionsBilling / Operations | 0 / 50    | 100                     |
| OutgoingEmails / Mails      | 2 / 5000  | 1000                    |
| Files / Storage             | 2 / 5000  | 1000                    |
| ActionsBilling / Obligo     | 0 / 57000 | 0 / 0                   |

The allowances differ from the test org's in both directions (fewer operations, far more mail and
storage), which is how this reading identifies **which organisation a key belongs to** without
printing the key: run `listquotas` and compare the numbers. `Obligo` is not explained in the
pricing article — its meaning is **[UNVERIFIED]**; asking Sumit is an owed founder action.

**Only the private API key is used.** Sumit also issues a public key for its browser-side JS; no
code in this repo reads one — `SUMIT_API_KEY` is sent server-to-server in the `Credentials` body
and nothing else ([[../decisions/0062-hosted-checkout-via-sumit-payment-pages]]).

## The catalogue and the pages, before any change [FOUNDER-REPORTED, screenshots]

Per catalogue: add-product button ☑, quantity selection ☑, single-item limit ☐, return URL **empty**,
קטלוג ללא מע"מ ☐, Google/Apple Pay ☐, orders without charge ☐. Global: redirect link empty, max
installments 1, separate customer per purchase ☐, standing order without charge ☐, notification
email empty. Four extra fields existed, scoped to a sample catalogue only. One terms entry
("התקנון") with placeholder text, unattached to any catalogue. **No Bit option appeared on the
catalogue screen** — consistent with the Bit module not being installed **[REASONED; founder to
confirm]**.

## What he was told to set, on all three catalogues [RECOMMENDED IN CHAT; applied by the founder, NOT observed]

add-product ☐ · quantity ☐ · single-item limit ☑ · return URL
`https://tavnit.ai/api/billing/sumit/return` · catalogue max installments 1 · wallets ☐ ·
קטלוג ללא מע"מ ☐ · Sumit's terms left unattached · global redirect empty · notification email set to
an inbox he reads · products one-time and fixed-price.

Only התחלה is proven, and only through the purchase: [[first-real-purchase-2026-09-21]]. Comparing
מתקדם and פרימיום against התחלה is an owed founder action.

Three of these are deliberate and worth the reason:

- **קטלוג ללא מע"מ stays UNTICKED, deliberately unlike the test org** where it is on. Sumit's own
  article 14166702 says a customer created through a no-VAT catalogue is **flagged VAT-exempt for
  future charges**, is not merged with non-exempt customer cards, and has the VAT component
  stripped from a VAT-inclusive price **[PER SUMIT DOCS]**. Every subscriber is created and renewed
  through these customer cards, so ticking it would leave the whole book exempt past the עוסק פטור
  conversion ([[../decisions/0046-billing-ships-as-osek-patur]] §7) **[REASONED]**.
- **Sumit's terms stay unattached.** Acceptance lives in our checkout, recorded per intent
  ([[../decisions/0056-the-purchase-step-takes-an-active-terms-checkbox]]).
- **Wallets stay off** until someone measures whether a wallet payment leaves a chargeable saved
  card — the renewal depends on one **[REASONED]**.

## The payment pages [MEASURED — the values set on Vercel]

Public by design; they travel through the customer's browser and carry no secret.

```
starter  https://pay.sumit.co.il/12zjrrk/13b6o3o/13b6y0e/payment/
pro      https://pay.sumit.co.il/12zjrrk/13b6w8m/13b6y0l/payment/
studio   https://pay.sumit.co.il/12zjrrk/13b6wf8/13b6y0s/payment/
```

Same shape as the test org's: one org segment, one catalogue and one product each, no query string.
All three resolve through `SUMIT_CHECKOUT_PAGES` — proven by an intent row existing for each of the
three plans ([[first-real-purchase-2026-09-21]]).

## What Sumit's documentation says [PER SUMIT DOCS — read 2026-09-21, not measured by us]

**Pricing, article 5507895.** A successful card charge is one operation, **and the document it
issues is a second**. Past the included operations a paid plan bills per use rather than blocking
(the free plan blocks — article 13509212). **API calls are included at 5× the operations** — 250
here — with overage at a quarter of an extra operation's price. Past the outgoing-email allocation
Sumit stops sending documents until the next month.

> This settles an open contradiction. [[sumit-test-org-configuration]] carried the founder's
> "~100 UI actions and ~400 API calls a month" against a `listquotas` reading that reports no such
> figure, and [[sumit-payment-page-saves-the-card]] recorded that the endpoint does not report it.
> Both were right: **API calls are a derived allowance (5× operations), not a statistic**.

**Refunds on Upay, articles 5799412 and 10792135.** A refund issued from Sumit needs a **Upay
balance larger than the refund**, and needs the original charge to have been made through Sumit. A
full refund on the day of the charge usually becomes a cancellation instead. The error
"סכום הזיכוי לא אושר על ידי חברת הסליקה…" means the balance is short; the way out is Upay (their
form, or WhatsApp 055-9763169) and then crediting the document by hand in Sumit. In the UI the
control is on the payment's clearing card, under סליקת אשראי → "יצירת זיכוי באשראי".

> **[REASONED] consequence, and it matters today:** a brand-new terminal cannot refund its first
> customers out of Sumit, because there is no balance yet. So a customer who paid and was not
> activated is better recovered by **fixing the cause and replaying the return URL** — which is what
> actually worked on 2026-09-21 — than by refunding.
> ([[../defects/sumit-return-failure-invited-a-second-payment]].)

## Related

- [[first-real-purchase-2026-09-21]] — the only thing that proves any of §"what he was told to set"
- [[sumit-test-org-configuration]] — the test organisation, which differs on purpose
- [[sumit-payment-page-saves-the-card]] — every API response measured on the test org
- [[env-values-differ-between-the-box-and-vercel]] — how these values must be typed in each place
- [[../decisions/0062-hosted-checkout-via-sumit-payment-pages]] — the design these settings serve

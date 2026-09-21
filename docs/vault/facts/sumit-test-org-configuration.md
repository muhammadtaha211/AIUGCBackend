---
type: fact
status: verified
verified: 2026-09-21
method: "The configuration list is the founder's, read in the Sumit UI on 2026-09-21 and dictated in the task brief ([M founder]); this session did not open the Sumit UI. What this session ADDED was measured from outside: the three payment-page URLs in apps/web/.env.local (all on https://pay.sumit.co.il, one catalogue path each, no query), the rendered התחלה page's text and hidden form (CompanyID, CatalogID, Cart.Items[0].ID/UnitPrice 150, PaymentDetails.Provider 'OfficeGuy', reCAPTCHA Enterprise via OfficeGuy.Common.RecaptchaScoreSubmit), the outcome of two of the published test cards, and the API's quota reading. Test cards: help.sumit.co.il article 5832877, fetched as text."
source: founder + browser
---

# The founder's Sumit TEST business, as configured on 2026-09-21

Tags: **[M founder]** read in the Sumit UI by the founder; **[M]** measured by this session.

## Organisation [M founder]

- A separate test business, org name **testbusiness**, business number **999999998** on its
  documents and pages [M — the page footer says "דף מאת testbusiness, עוסק פטור: 999999998"].
- Products under מוצרים/שירותים, fixed price, no VAT ("קטלוג ללא מע"מ" on), ILS:
  **תבנית - מסלול התחלה 150**, **…מתקדם 300**, **…פרימיום 500** (plain hyphen in the product
  names; the page's own header reads "תבנית — מסלול התחלה" with an em dash).
- One catalogue per plan, type "תשלום בסכום קבוע", one product each, single item per purchase
  ("הגבלת תשלום למוצר/שירות בודד" on), quantity selection off, Google/Apple Pay off, orders
  without charge off, recurring document off, language Hebrew.
- Global payment-page settings: max installments 1; **"הגדרת לקוח/ה נפרד/ת לכל רכישה" OFF** (one
  Sumit customer per payer — the saved card has one home); "חיבור להוראת קבע בלי לבצע חיוב" off.
- Document after charge: the business default, "(חשבון/קבלה)" — measured as spec `Type 1`
  InvoiceAndReceipt with VAT 0 ([[sumit-payment-page-saves-the-card]]).
- Redirect after payment (per catalogue): `http://localhost:3000/api/billing/sumit/return`.
- No Bit and no Upay connection in the test org; clearing runs against a **test terminal** — the
  page carries a red notice "סליקת האשראי מתבצעת מול מסוף בדיקות. לא יתקבלו תשלומים…" [M].
- Test quota per the founder: ~100 UI actions and ~400 API calls a month. What `listquotas`
  reports is `ActionsBilling/Operations 100`, `Mails 1000`, `Storage 1000` — see the other note.

## The pages [M]

`SUMIT_CHECKOUT_PAGES` in `apps/web/.env.local` maps `starter`, `pro`, `studio` to three URLs of
the shape `https://pay.sumit.co.il/<org>/<catalog>/<product>/payment/` with no query string.
The page prefills **name** and **emailaddress** from the URL into its own two text fields
(`RenderedFields.Fields[0..1]`), shows the product line and total, four card fields
(`PaymentDetails.CreditCard_CardNumber`, `_Expiration` — typed `0531` becomes `05/2031` —,
`_CVV`, `_CustomerID` = the payer's ID number), and a "תשלום (150₪)" anchor that submits the
form through a **score-based reCAPTCHA Enterprise** (`OfficeGuy.Common.RecaptchaScoreSubmit`).
A programmatic click on the anchor submitted normally; no challenge was shown.

## The published test cards, and what two of them did here [M]

Article 5832877 lists five MasterCard, three Visa and six Amex numbers (expiry 04/2026 or
05/2031, CVV given per card), plus two "fictitious" cards (1231-1231 and 4580-4580-4580-4580,
12/2026, CVV 123) that pass validity checks only. On this terminal on 2026-09-21:

| card                                         | result                                                         |
| -------------------------------------------- | -------------------------------------------------------------- |
| Visa 4557-4304-0232-1333, 05/2031, 098       | **declined**, "(קוד 003)" — but tokenised and saved as default |
| MasterCard 5326-1073-0002-0772, 05/2031, 033 | **approved**, Status "000", document 40000                     |

Both with ID number `000000018` (a checksum-valid placeholder). Which cards a test terminal
approves is not documented; treat the table as two data points, not a rule.

## Related

- [[sumit-payment-page-saves-the-card]] — every API response measured on this org
- [[sumit-real-org-configuration]] — the REAL organisation, which differs deliberately: קטלוג ללא
  מע"מ is **off** there, because a no-VAT catalogue flags its customers VAT-exempt for future
  charges and every subscriber is created through one
- [[../decisions/0062-hosted-checkout-via-sumit-payment-pages]] — the design built on it

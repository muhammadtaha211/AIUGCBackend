---
type: fact
status: verified
verified: 2026-09-21
method: "Against the founder's TEST Sumit business (org 'testbusiness', facts/sumit-test-org-configuration). The התחלה payment page (fixed 150, no VAT) opened in the in-app browser with externalidentifier=<uuid>, customerexternalidentifier=<uuid>, name and emailaddress; paid twice with Sumit's published test cards (article 5832877): Visa 4557-4304-0232-1333 05/2031 → DECLINED, page text 'החברה שהנפיקה לך את כרטיס האשראי לא אישרה את החיוב (קוד 003)'; MasterCard 5326-1073-0002-0772 05/2031 → APPROVED and redirected to the configured return URL. Then POST https://api.sumit.co.il/<endpoint> with a JSON body {Credentials:{CompanyID,APIKey}, ...} from a scratch Node script that read the keys from apps/web/.env.local and scrubbed them from its output: /billing/payments/list/ {Date_From, Date_To}, /billing/payments/get/ {PaymentID}, /billing/paymentmethods/getforcustomer/ {Customer:{ID}} and {Customer:{ExternalIdentifier, SearchMode:'ExternalIdentifier'}}, /billing/paymentmethods/setforcustomer/ (three variants), /accounting/documents/getdetails/ {DocumentID}, /website/companies/listquotas/ before and after. An empty POST to any endpoint with no body was also sent. Schemas: https://app.sumit.co.il/swagger/v1/swagger.json (public, 'SUMIT API - Full')."
source: browser + db
---

# After a payment-page purchase, Sumit saves the card — and the first card entered is the default

Tags: **[M]** measured this session.

## The return URL, verbatim shape

```
http://localhost:3000/api/billing/sumit/return?OG-CustomerID=2376907140&OG-PaymentID=2376907759
  &OG-PaymentType=CreditCard&OG-ExternalIdentifier=<our externalidentifier>&OG-DocumentNumber=40000
```

**Mixed case.** The help article (5836159) writes `og-customerid`; the page sends `OG-CustomerID`.
`URLSearchParams` is case-sensitive, so the return route lowercases keys before matching.

**The declined attempt did not redirect** — the page re-rendered with the error line and the
POST answered HTTP 200; the browser never reached the return URL. Only a valid payment comes back.

**The customer was reused.** Both attempts named the same `customerexternalidentifier`, name and
email; the second returned `OG-CustomerID=2376907140`, the customer the declined attempt had
created. But `/accounting/documents/getdetails/` shows that customer's `ExternalIdentifier` as
**null**, and `getforcustomer` with `Customer.ExternalIdentifier` + `SearchMode` answered
`PaymentMethod: null` (Status 0). So `customerexternalidentifier` was **not** written onto the
customer record; the match was by email (or name). The route sends the parameter anyway, as the
article names it, and binds on `OG-CustomerID`.

## `/billing/paymentmethods/getforcustomer/` after the purchase — a card IS saved

```json
{
  "Data": {
    "PaymentMethod": {
      "ID": 2376907142,
      "CustomerID": 2376907140,
      "CreditCard_Number": null,
      "CreditCard_LastDigits": "1333",
      "CreditCard_ExpirationMonth": 5,
      "CreditCard_ExpirationYear": 2031,
      "CreditCard_CVV": null,
      "CreditCard_CitizenID": "000000018",
      "CreditCard_CardMask": "XXXXXXXXXXXX1333",
      "CreditCard_Token": "427004b0-…",
      "Type": 1
    },
    "InactivePaymentMethods": null
  },
  "Status": 0
}
```

**It is the DECLINED card (1333), not the card that paid (0772).** The page tokenises the first
card it sees and makes it the customer's default; a later card that pays gets its own
`PaymentMethod` on the payment (`ID 2376907758`, token `63c7aeff-…`, seen in payments/get) but
the default is not moved. A renewal charged with `PaymentMethod` omitted ("use the customer
payment method") would hit 1333.

**Fix, measured:** `/billing/paymentmethods/setforcustomer/` with
`{Customer:{ID}, PaymentMethod:{CreditCard_Token, CreditCard_ExpirationMonth, CreditCard_ExpirationYear, Type:"CreditCard"}}`
answered Status 0 with the new default (`ID 2376907148`, last digits 0772), and `getforcustomer`
then returned 0772. Two variants fail: the token alone → Status 1 "Missing
CreditCard_ExpirationMonth/CreditCard_ExpirationYear"; `PaymentMethod:{ID:2376907758}` alone →
Status 2 "Nullable object must have a value." `completeCheckout` does the working variant when
the default's token differs from the paying card's.

Note `CreditCard_CitizenID` comes back on the method: the payer's ID number is card data Sumit
holds; the client maps only `ID`, `CreditCard_LastDigits`, expiry and the token, and stores none
of them — `gateway_recurring_ref` is the customer id.

## `/billing/payments/get/` for the approved payment

```json
{"Payment":{"ID":2376907759,"CustomerID":2376907140,"Date":"2026-09-21T06:12:21+03:00",
 "ValidPayment":true,"Status":"000","StatusDescription":" (קוד 000)","Amount":150.0000,"Currency":0,
 "PaymentMethod":{…"CreditCard_LastDigits":"0772","CreditCard_Token":"63c7aeff-…"},
 "AuthNumber":"0898318","ExternalIdentifier":"<our externalidentifier>","DocumentID":2376907762}}
```

- `Amount` is shekels with four decimals; the client rounds ×100 to agorot.
- **`ExternalIdentifier` echoes the page's `externalidentifier`** — the intent id. This is the
  fourth check `completeCheckout` makes and the one that binds a payment to its own intent.
- The declined payment exists too (list: `ID 2376907143`, `ValidPayment false`, `Status "003"`,
  `DocumentID 0`), so a decline is a payment row, not an absence.

## `/billing/payments/list/`

`Date_From` and `Date_To` are **required** (an empty body answers Status 1 naming both); `Valid`
and `StartIndex` optional; the answer is `{Payments: Payment[], HasNextPage}`. This is the
gateway's reconcile query after a lost charge answer.

## The document the test org issued

`/accounting/documents/getdetails/ {DocumentID: 2376907762}` → `Type: 1` (**InvoiceAndReceipt**
in the spec's enum — the combined "(חשבון/קבלה)" the founder saw as the business default),
`IsDraft false`, `DocumentNumber 40000`, `DocumentValue 150`, one item "תבנית - מסלול התחלה"
150 with `VAT 0.0000`, `Customer.NoVAT true`, a `DocumentDownloadURL`. The page said
"דף מאת testbusiness, עוסק פטור: 999999998".

## The API envelope and auth, from an empty POST

`POST /billing/payments/charge/` with `{}` → HTTP **200**,
`{"Data":null,"Status":1,"UserErrorMessage":"המשתמש אינו מחובר: Missing Credentials (CompanyID/APIKey are missing)","TechnicalErrorDetails":null}`.
So: credentials live in the body as `Credentials:{CompanyID, APIKey}` (confirmed by
`listquotas` answering Status 0 with them), and **errors are a Status field inside a 200**
(`0` Success, `1` BusinessError, `2` TechnicalError). `GET` on any endpoint 302s to a help
article. `/billing/payments/charge/` carries **no merchant reference** field (spec).

## Quotas (`/website/companies/listquotas/`)

| statistic                   | before | after two attempts + reads |
| --------------------------- | ------ | -------------------------- |
| ActionsBilling / Operations | 0/100  | 2/100                      |
| OutgoingEmails / Mails      | 1/1000 | 4/1000                     |
| Files / Storage             | 1/1000 | 1/1000                     |
| ActionsBilling / Obligo     | 0/0    | 0/0                        |

Read calls (get, list, getforcustomer, setforcustomer, getdetails, listquotas) did not move
`Operations`; the two charge attempts did (the decline included). The "~400 API calls" figure
from the brief is not a statistic this endpoint reports.

## Related

- [[../decisions/0062-hosted-checkout-via-sumit-payment-pages]] — what these numbers decided
- [[sumit-test-org-configuration]] — the organisation and the cards

-- 0063: each plan one shekel less -- 150 -> 149, 300 -> 299, 500 -> 499 ILS.
--
-- Founder decision 2026-10-15 (vault decision 0113): he set the three Sumit
-- payment pages to the new prices first, so the hosted first charge already
-- asks for 14900 / 29900 / 49900 agorot. This row is what everything else
-- reads: the card prices, the checkout intent's price (verifyHostedPayment
-- refuses a payment whose amount differs from it -- `amount_mismatch`), the
-- renewal charge on the saved card, the ₪5 trial's continue charge, and the
-- upgrade proration. Until it moves, a ₪149 payment for starter is refused.
--
-- Credits are unchanged. The rates become 14.9 / 11.96 / 9.98 agorot per
-- credit, which still print as ₪0.15 / ₪0.12 / ₪0.10, discounts 20% / 33%.
--
-- GUARDED on the old price, as 0043 was: a rebuild replays 0043's
-- 15000/30000/50000 and lands here by construction, and a hand-set price is
-- not silently overwritten. A guard that matches nothing exits 0 and still
-- records its version, so READ BEFORE AND AFTER:
--
--   select code, price_agorot, monthly_credits from plans order by price_agorot;
--
-- Expected after: starter 14900 / 1000, pro 29900 / 2500, studio 49900 / 5000.
UPDATE "plans" SET "price_agorot" = 14900 WHERE "code" = 'starter' AND "price_agorot" = 15000;
UPDATE "plans" SET "price_agorot" = 29900 WHERE "code" = 'pro' AND "price_agorot" = 30000;
UPDATE "plans" SET "price_agorot" = 49900 WHERE "code" = 'studio' AND "price_agorot" = 50000;

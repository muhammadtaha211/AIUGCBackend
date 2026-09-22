import { describe, expect, it } from "vitest";
import {
  checkoutRedirectUrl,
  IpRateLimiter,
  parseCheckoutPages,
  parseSumitReturnParams,
  sumitPaymentIdParam,
  sumitReturnPath,
} from "../src/lib/billing";
import { safeNextPath } from "../src/lib/onboarding";
import { checkoutPath, firstChargeLine } from "../src/lib/plans-ui";

/** The pure half of the hosted checkout (decision 0062). */

const PAGE = "https://pay.sumit.co.il/138f5dl/13b59j6/13b59is/payment/";
const INTENT = "2b7c5a41-9e10-4a53-a7a8-0c1c1a9f52d1";

describe("parseCheckoutPages", () => {
  it("accepts a JSON map of https URLs and nothing else", () => {
    expect(parseCheckoutPages(JSON.stringify({ starter: PAGE }))).toEqual({ starter: PAGE });
    expect(parseCheckoutPages(undefined)).toBeNull();
    expect(parseCheckoutPages("")).toBeNull();
    expect(parseCheckoutPages("{oops")).toBeNull();
    expect(parseCheckoutPages("[]")).toBeNull();
    expect(parseCheckoutPages(JSON.stringify({ starter: 1 }))).toBeNull();
    expect(parseCheckoutPages(JSON.stringify({ starter: "http://pay.example/x" }))).toBeNull();
    expect(parseCheckoutPages(JSON.stringify({ starter: "not a url" }))).toBeNull();
  });
});

describe("checkoutRedirectUrl", () => {
  it("adds the four Sumit params, URL-encoded, and no price", () => {
    const url = new URL(
      checkoutRedirectUrl(PAGE, {
        intentId: INTENT,
        userId: "11111111-1111-4111-8111-111111111111",
        name: "עסק שני",
        email: "dana@business.co.il",
      }),
    );
    expect(url.origin + url.pathname).toBe(PAGE);
    expect(url.searchParams.get("externalidentifier")).toBe(INTENT);
    expect(url.searchParams.get("customerexternalidentifier")).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(url.searchParams.get("name")).toBe("עסק שני");
    expect(url.searchParams.get("emailaddress")).toBe("dana@business.co.il");
    expect(url.searchParams.has("price")).toBe(false);
    expect(url.searchParams.has("fixedprice")).toBe(false);
  });

  it("omits name and email when absent", () => {
    const url = new URL(
      checkoutRedirectUrl(PAGE, { intentId: INTENT, userId: "u", name: null, email: null }),
    );
    expect([...url.searchParams.keys()]).toEqual([
      "externalidentifier",
      "customerexternalidentifier",
    ]);
  });
});

describe("parseSumitReturnParams", () => {
  it("reads the keys as the page sends them (OG-CustomerID) and as the article writes them (og-customerid)", () => {
    const sent = new URLSearchParams(
      `OG-CustomerID=2376907140&OG-PaymentID=2376907759&OG-PaymentType=CreditCard&OG-ExternalIdentifier=${INTENT}&OG-DocumentNumber=40000`,
    );
    expect(parseSumitReturnParams(sent)).toEqual({
      intentId: INTENT,
      paymentId: "2376907759",
      customerId: "2376907140",
    });
    const written = new URLSearchParams(
      `og-customerid=1&og-paymentid=2&og-externalidentifier=${INTENT}`,
    );
    expect(parseSumitReturnParams(written)).toEqual({
      intentId: INTENT,
      paymentId: "2",
      customerId: "1",
    });
  });

  it("refuses a missing id, a non-uuid intent, a non-numeric Sumit id", () => {
    expect(parseSumitReturnParams(new URLSearchParams(""))).toBeNull();
    expect(
      parseSumitReturnParams(new URLSearchParams(`og-paymentid=2&og-externalidentifier=${INTENT}`)),
    ).toBeNull();
    expect(
      parseSumitReturnParams(
        new URLSearchParams(`og-customerid=1&og-paymentid=2&og-externalidentifier=nope`),
      ),
    ).toBeNull();
    expect(
      parseSumitReturnParams(
        new URLSearchParams(`og-customerid=1&og-paymentid=2x&og-externalidentifier=${INTENT}`),
      ),
    ).toBeNull();
    expect(
      parseSumitReturnParams(
        new URLSearchParams(`og-customerid=-1&og-paymentid=2&og-externalidentifier=${INTENT}`),
      ),
    ).toBeNull();
  });
});

describe("sumitPaymentIdParam", () => {
  it("finds a payment id whatever the casing, and only when it is non-empty", () => {
    expect(sumitPaymentIdParam(new URLSearchParams("OG-PaymentID=2376907759"))).toBe("2376907759");
    expect(sumitPaymentIdParam(new URLSearchParams("og-paymentid=2376907759"))).toBe("2376907759");
    // Too malformed for parseSumitReturnParams, but still a browser the payment
    // page redirected: the landing must not say "try again".
    expect(sumitPaymentIdParam(new URLSearchParams("OG-PaymentID=abc"))).toBe("abc");
    expect(sumitPaymentIdParam(new URLSearchParams(""))).toBeNull();
    expect(sumitPaymentIdParam(new URLSearchParams("OG-PaymentID="))).toBeNull();
    expect(sumitPaymentIdParam(new URLSearchParams("OG-PaymentID=%20%20"))).toBeNull();
    expect(sumitPaymentIdParam(new URLSearchParams("OG-CustomerID=2376907140"))).toBeNull();
  });
});

describe("sumitReturnPath", () => {
  it("keeps the path and Sumit's own parameters, in order, and drops everything else", () => {
    const url = new URL(
      `http://localhost:3000/api/billing/sumit/return?OG-CustomerID=2376907140` +
        `&utm_source=mail&OG-PaymentID=2376907759&session=whatever&OG-ExternalIdentifier=${INTENT}`,
    );
    expect(sumitReturnPath(url)).toBe(
      `/api/billing/sumit/return?OG-CustomerID=2376907140&OG-PaymentID=2376907759` +
        `&OG-ExternalIdentifier=${INTENT}`,
    );
  });

  it("no og-* parameters at all leaves the bare path", () => {
    expect(sumitReturnPath(new URL("http://localhost:3000/api/billing/sumit/return?x=1"))).toBe(
      "/api/billing/sumit/return",
    );
  });
});

describe("IpRateLimiter", () => {
  it("allows max hits per window per address, then refuses until the window slides", () => {
    const limiter = new IpRateLimiter(3, 60_000);
    const t0 = 1_000_000;
    expect(limiter.allow("a", t0)).toBe(true);
    expect(limiter.allow("a", t0 + 1)).toBe(true);
    expect(limiter.allow("a", t0 + 2)).toBe(true);
    expect(limiter.allow("a", t0 + 3)).toBe(false);
    expect(limiter.allow("b", t0 + 3)).toBe(true);
    expect(limiter.allow("a", t0 + 60_001)).toBe(true);
  });
});

describe("safeNextPath", () => {
  it("honours a path under /home or the Sumit return route, and refuses everything that could leave the site", () => {
    expect(safeNextPath("/home/plan?checkout=success")).toBe("/home/plan?checkout=success");
    expect(safeNextPath("/home")).toBe("/home");
    const returnUrl =
      "/api/billing/sumit/return?OG-CustomerID=1&OG-PaymentID=2&OG-ExternalIdentifier=x";
    expect(safeNextPath(returnUrl)).toBe(returnUrl);
    expect(safeNextPath("/api/billing/sumit/return")).toBeNull();
    expect(safeNextPath("/api/account/checkout?x=1")).toBeNull();
    expect(safeNextPath("/homeless")).toBeNull();
    expect(safeNextPath("//evil.example/home")).toBeNull();
    expect(safeNextPath("https://evil.example/home")).toBeNull();
    expect(safeNextPath("/login")).toBeNull();
    expect(safeNextPath(["/home", "/home"])).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
  });
});

describe("the checkout page's strings", () => {
  it("checkoutPath writes the same param /home/plan and /start parse", () => {
    expect(checkoutPath("pro")).toBe("/home/plan/checkout?plan=pro");
  });

  it("firstChargeLine names today and the next date", () => {
    expect(firstChargeLine("21.10.2026")).toBe("החיוב הראשון היום, הבא ב־21.10.2026");
  });
});

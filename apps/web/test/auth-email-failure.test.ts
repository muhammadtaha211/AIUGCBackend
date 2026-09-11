import { AuthApiError, AuthError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { AUTH_EMAIL_FAILURE_REASONS } from "@aiugc/core";
import { authEmailSendFailure } from "../src/lib/auth";

/**
 * The predicate that decides whether a failed signup gets an alert and the
 * "use Google instead" message, or its ordinary inline error.
 *
 * Both directions are pinned, and the negative direction is the one that
 * matters: a validation failure misread as a send failure would tell a customer
 * with a duplicate address to try Google, and would wake the founder for it.
 *
 * Every code below is a member of the `ErrorCode` union in the INSTALLED
 * @supabase/auth-js (2.110.6, dist/main/lib/error-codes.d.ts) — the list is
 * taken from that file, not from memory. Note what is NOT in that union: there
 * is no email-send-specific code at all. It carries `sms_send_failed` and no
 * email twin, which is why an SMTP refusal has to be read off the 500 catch-all.
 */

/** GoTrue's shape: AuthApiError(message, status, code). */
const apiError = (code: string, status: number) => new AuthApiError("boom", status, code);

describe("authEmailSendFailure — positive direction", () => {
  it("classifies unexpected_failure at 500, GoTrue's catch-all for a failed SMTP send", () => {
    expect(authEmailSendFailure(apiError("unexpected_failure", 500))).toBe("unexpected_failure");
  });

  it("classifies unexpected_failure at any 5xx", () => {
    expect(authEmailSendFailure(apiError("unexpected_failure", 502))).toBe("unexpected_failure");
    expect(authEmailSendFailure(apiError("unexpected_failure", 503))).toBe("unexpected_failure");
  });

  it("classifies over_email_send_rate_limit — GoTrue refused to hand it to SMTP", () => {
    expect(authEmailSendFailure(apiError("over_email_send_rate_limit", 429))).toBe(
      "over_email_send_rate_limit",
    );
  });

  it("only ever returns a reason the alert row is allowed to carry", () => {
    for (const err of [
      apiError("unexpected_failure", 500),
      apiError("over_email_send_rate_limit", 429),
    ]) {
      const reason = authEmailSendFailure(err)!;
      expect(AUTH_EMAIL_FAILURE_REASONS).toContain(reason);
    }
  });
});

describe("authEmailSendFailure — negative direction", () => {
  it("never classifies a known validation failure as a send failure", () => {
    // Every 4xx code signUp can realistically return. None of these is a mail
    // that did not go out, and each already has its own Hebrew in auth.ts.
    const validationCodes: [string, number][] = [
      ["user_already_exists", 422],
      ["email_exists", 422],
      ["weak_password", 422],
      ["validation_failed", 400],
      ["email_address_invalid", 400],
      ["email_address_not_authorized", 403],
      ["signup_disabled", 422],
      ["email_provider_disabled", 422],
      ["over_request_rate_limit", 429],
      ["captcha_failed", 400],
      ["bad_json", 400],
      ["invalid_credentials", 400],
      ["email_not_confirmed", 400],
      ["user_banned", 400],
    ];
    for (const [code, status] of validationCodes) {
      expect(authEmailSendFailure(apiError(code, status))).toBeUndefined();
    }
  });

  it("does not classify unexpected_failure below 500 — the guard is the status, not the code alone", () => {
    expect(authEmailSendFailure(apiError("unexpected_failure", 400))).toBeUndefined();
    expect(authEmailSendFailure(apiError("unexpected_failure", 422))).toBeUndefined();
  });

  it("does not classify sms_send_failed — the union's only *_send_failed member is not ours", () => {
    expect(authEmailSendFailure(apiError("sms_send_failed", 500))).toBeUndefined();
  });

  it("does not classify a code the SDK has never heard of", () => {
    // ErrorCode is `ErrorCode | (string & {})` — the server may send anything.
    expect(authEmailSendFailure(apiError("some_future_code", 500))).toBeUndefined();
  });

  it("does not classify an error with no code at all", () => {
    // AuthError's own docs: errors raised before a response arrives carry
    // neither a code nor a status.
    expect(authEmailSendFailure(new AuthError("network down"))).toBeUndefined();
    expect(authEmailSendFailure(new AuthRetryableFetchError("offline", 0))).toBeUndefined();
  });

  it("does not classify things that are not auth errors", () => {
    expect(authEmailSendFailure(new Error("unexpected_failure"))).toBeUndefined();
    expect(authEmailSendFailure({ code: "unexpected_failure", status: 500 })).toBeUndefined();
    expect(authEmailSendFailure(null)).toBeUndefined();
    expect(authEmailSendFailure(undefined)).toBeUndefined();
    expect(authEmailSendFailure("unexpected_failure")).toBeUndefined();
  });
});

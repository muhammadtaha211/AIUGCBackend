import { getEnv } from "../config";
import { logger } from "../logger";

/**
 * Transactional email through Resend's HTTP API (decision 0107). One caller
 * today: the post-failure email the worker's sweep sends
 * (pipelines/social-failure-email.ts). The auth mail does NOT come through here
 * — Supabase Auth reaches Resend over SMTP on its own (docs/08 §8A.2).
 *
 * Plain `fetch`, no SDK: core is bundled into the Vercel apps, and nothing
 * there may send (the web sends no mail by construction).
 *
 * Read on resend.com 2026-10-12: `POST /emails` with `from`, `to`, `subject`
 * and `html`/`text`; `Authorization: Bearer`; an `Idempotency-Key` header of at
 * most 256 characters that Resend keeps for 24 hours; `daily_quota_exceeded`,
 * `monthly_quota_exceeded` and `rate_limit_exceeded` all answer 429.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Same key within 24 h → Resend sends once. ≤ 256 characters. */
  idempotencyKey: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<{ id: string }>;
}

/** The sender every Tavnit email carries — the auth mail's own (docs/08 §8A.2). */
export const EMAIL_FROM = "תבנית <noreply@tavnit.ai>";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const RESEND_TIMEOUT_MS = 10_000;

/**
 * A send that did not go out, in one of four kinds — the caller's whole decision:
 * - `retryable`: a network fault, a timeout, a 5xx or a per-second 429 — the
 *   same message may go out on a later tick;
 * - `dailyQuota`: Resend's own day (or month) spent — nothing goes out until
 *   00:00 UTC;
 * - `accountFault`: a 401 or 403 — the key is missing, revoked or held to
 *   another domain, or the domain is unverified. Nothing about THIS message
 *   would change; every message fails until the founder fixes the account, so
 *   no single cause is blamed for it;
 * - none of the three: this message is refused (a 400/422, a bad address).
 */
export class EmailSendError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly errorName: string | null,
    readonly retryable: boolean,
    readonly dailyQuota: boolean,
    readonly accountFault = false,
  ) {
    super(message);
  }
}

class HttpResend implements EmailProvider {
  constructor(private readonly apiKey: string) {}

  async send(message: EmailMessage): Promise<{ id: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RESEND_TIMEOUT_MS);
    let response: Response;
    let text: string;
    try {
      response = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
          "idempotency-key": message.idempotencyKey.slice(0, 256),
        },
        body: JSON.stringify({
          from: EMAIL_FROM,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
        signal: controller.signal,
      });
      // Inside the timeout and the catch: a body that stalls or resets is the
      // same network fault as a request that never landed.
      text = await response.text();
    } catch (err) {
      throw new EmailSendError(`resend request failed: ${String(err)}`, null, null, true, false);
    } finally {
      clearTimeout(timer);
    }

    let json: { id?: string; name?: string; message?: string } | null = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    // The status and Resend's error name only: never the address, the subject
    // or the body (customer data), never the key.
    logger.info({ status: response.status, error: json?.name }, "resend send");

    if (!response.ok) {
      const name = json?.name ?? null;
      const dailyQuota = name === "daily_quota_exceeded" || name === "monthly_quota_exceeded";
      const retryable = response.status >= 500 || (response.status === 429 && !dailyQuota);
      const accountFault = response.status === 401 || response.status === 403;
      throw new EmailSendError(
        `resend ${response.status} ${name ?? "?"}: ${(json?.message ?? "").slice(0, 200)}`,
        response.status,
        name,
        retryable,
        dailyQuota,
        accountFault,
      );
    }
    if (!json?.id)
      throw new EmailSendError("resend returned no id", response.status, null, true, false);
    return { id: json.id };
  }
}

let override: EmailProvider | undefined;

/** Test hook (same shape as `setMetaGraphProvider`). */
export function setEmailProvider(provider: EmailProvider | undefined): void {
  override = provider;
}

/**
 * The provider, or `undefined` when there is none to use — the caller then
 * sends nothing and writes nothing, the way `reportingEnabled` treats an unset
 * SENTRY_DSN (an empty `RESEND_API_KEY=` line counts as unset).
 *
 * DRY_RUN has no stub on purpose: the sweep's log rows are what mark a failure
 * as told, so a dry-run worker that "sent" would swallow the real email. Every
 * local env sets DRY_RUN=1 against the production database.
 */
export function getEmailProvider(): EmailProvider | undefined {
  if (override) return override;
  const env = getEnv();
  if (env.DRY_RUN) return undefined;
  const key = env.RESEND_API_KEY?.trim();
  return key ? new HttpResend(key) : undefined;
}

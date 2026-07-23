"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Client-side plumbing shared by the homepage strip and the wizard: one fetch
 * wrapper with the conventions applied (401 -> /login, Hebrew error strings)
 * and one polling hook (setInterval with cleanup + "still working" flag).
 */

export const NETWORK_ERROR = "בעיית תקשורת — בדקו את החיבור ונסו שוב.";
const GENERIC_ERROR = "משהו השתבש. נסו שוב בעוד רגע.";

export type ApiResult<T> = { ok: true; body: T } | { ok: false; status: number; error: string };

/** JSON in/out fetch. A 401 redirects to /login (the session is gone). */
export async function apiFetch<T>(input: string, init?: RequestInit): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch {
    return { ok: false, status: 0, error: NETWORK_ERROR };
  }
  if (response.status === 401) {
    window.location.assign("/login");
    return { ok: false, status: 401, error: "צריך להתחבר קודם." };
  }
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) {
    return { ok: false, status: response.status, error: body?.error ?? GENERIC_ERROR };
  }
  // A 2xx that isn't JSON would crash every caller that reads body.x — surface
  // it as an error so the UI lands in its error state instead of hanging.
  if (body === null) return { ok: false, status: response.status, error: GENERIC_ERROR };
  return { ok: true, body };
}

export function postJson<T>(url: string, payload?: unknown): Promise<ApiResult<T>> {
  return apiFetch<T>(url, {
    method: "POST",
    ...(payload !== undefined
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }
      : {}),
  });
}

const SLOW_AFTER_MS = 60_000;

/**
 * Run `tick` immediately and then every `intervalMs` while `active`. Cleans up
 * on unmount and whenever `active` flips. Returns true once polling has been
 * running for over a minute — the cue to show "עדיין עובד…".
 */
export function usePolling(active: boolean, intervalMs: number, tick: () => void): boolean {
  const [slow, setSlow] = useState(false);
  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => {
    if (!active) {
      setSlow(false);
      return;
    }
    tickRef.current();
    const interval = setInterval(() => tickRef.current(), intervalMs);
    const slowTimer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => {
      clearInterval(interval);
      clearTimeout(slowTimer);
      setSlow(false);
    };
  }, [active, intervalMs]);

  return slow;
}

export const MAX_POLL_FAILURES = 5;

/** Pure: consecutive poll-failure counting behind the give-up cutoff. */
export function recordPollFailure(failures: number): { failures: number; stalled: boolean } {
  const next = failures + 1;
  return { failures: next, stalled: next >= MAX_POLL_FAILURES };
}

/**
 * Poll a status endpoint while `active`. Success resets the failure count and
 * hands the body to `onResult`; 403/404 means the resource is gone for this
 * session (`onFatal`); anything else is transient and retried — but after
 * MAX_POLL_FAILURES consecutive failures the poll stops and `stalled` carries
 * the Hebrew error. The caller must render `stalled` with a retry control, so
 * a poll can never leave a spinner up forever.
 */
export function useJobPoll<T>(
  active: boolean,
  url: string,
  intervalMs: number,
  onResult: (body: T) => void,
  onFatal: (message: string) => void,
): { slow: boolean; stalled: string | null; retry: () => void } {
  const [stalled, setStalled] = useState<string | null>(null);
  const failures = useRef(0);

  const slow = usePolling(active && stalled === null, intervalMs, () => {
    void (async () => {
      const result = await apiFetch<T>(url);
      if (result.ok) {
        failures.current = 0;
        onResult(result.body);
        return;
      }
      if (result.status === 403 || result.status === 404) return onFatal(result.error);
      const next = recordPollFailure(failures.current);
      failures.current = next.failures;
      if (next.stalled) setStalled(result.error);
    })();
  });

  return {
    slow,
    stalled,
    retry: () => {
      failures.current = 0;
      setStalled(null);
    },
  };
}

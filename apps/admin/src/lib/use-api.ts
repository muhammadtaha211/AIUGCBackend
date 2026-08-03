"use client";

/**
 * One fetch wrapper with the conventions applied: 401 -> /login, Hebrew error
 * strings. Same shape as the web app's apiFetch, minus the polling hooks the
 * admin area doesn't need.
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

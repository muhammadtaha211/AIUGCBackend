import { afterEach, describe, expect, it, vi } from "vitest";
import {
  apiFetch,
  MAX_POLL_FAILURES,
  NETWORK_ERROR,
  pollErrorRoute,
  postJson,
  recordPollFailure,
} from "../src/lib/use-api";

const HEBREW = /[֐-׿]/;

function stubFetch(response: Response | Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(response)),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiFetch — every exit is ok-with-body or a Hebrew error", () => {
  it("returns the parsed body on success", async () => {
    stubFetch(new Response(JSON.stringify({ personas: [] }), { status: 200 }));
    const result = await apiFetch<{ personas: unknown[] }>("/api/personas");
    expect(result).toEqual({ ok: true, body: { personas: [] } });
  });

  it("network failure becomes the Hebrew network error, never a throw", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    const result = await apiFetch("/api/personas");
    expect(result).toEqual({ ok: false, status: 0, error: NETWORK_ERROR });
  });

  it("passes the server's Hebrew error through on a non-OK status", async () => {
    stubFetch(new Response(JSON.stringify({ error: "אין לך גישה לעסק הזה." }), { status: 403 }));
    const result = await apiFetch("/api/businesses/x/renders");
    expect(result).toEqual({ ok: false, status: 403, error: "אין לך גישה לעסק הזה." });
  });

  it("non-OK without a JSON body still yields a Hebrew error", async () => {
    stubFetch(new Response("Internal Server Error", { status: 500 }));
    const result = await apiFetch("/api/personas");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(HEBREW);
  });

  it("a 2xx that is not JSON is an error, not ok-with-null (would crash callers)", async () => {
    stubFetch(new Response("<!doctype html>", { status: 200 }));
    const result = await apiFetch("/api/personas");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(HEBREW);
  });

  it("401 redirects to /login", async () => {
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { assign } });
    stubFetch(new Response(JSON.stringify({ error: "צריך להתחבר קודם." }), { status: 401 }));
    const result = await apiFetch("/api/personas");
    expect(assign).toHaveBeenCalledWith("/login");
    expect(result.ok).toBe(false);
  });

  it("postJson sends the payload as JSON", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ scriptId: "s1" }), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    await postJson("/api/scripts/s0/text", { text: "טקסט" });
    expect(fetchMock).toHaveBeenCalledWith("/api/scripts/s0/text", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "טקסט" }),
    });
  });
});

describe("recordPollFailure — polls give up instead of spinning forever", () => {
  it("stays transient below the cutoff", () => {
    let failures = 0;
    for (let i = 1; i < MAX_POLL_FAILURES; i++) {
      const next = recordPollFailure(failures);
      failures = next.failures;
      expect(next.stalled).toBe(false);
    }
  });

  it("stalls exactly at MAX_POLL_FAILURES consecutive failures", () => {
    expect(recordPollFailure(MAX_POLL_FAILURES - 1)).toEqual({
      failures: MAX_POLL_FAILURES,
      stalled: true,
    });
  });

  it("a success resets the count (callers set failures back to 0)", () => {
    // After a reset, the next failure starts the count over.
    expect(recordPollFailure(0)).toEqual({ failures: 1, stalled: false });
  });
});

describe("pollErrorRoute — 404 is a normal state when the caller says so", () => {
  it("routes 404 to missing only for callers that handle it", () => {
    expect(pollErrorRoute(404, true)).toBe("missing");
    expect(pollErrorRoute(404, false)).toBe("fatal");
  });

  it("403 is fatal regardless — ownership never becomes a quiet wait", () => {
    expect(pollErrorRoute(403, true)).toBe("fatal");
    expect(pollErrorRoute(403, false)).toBe("fatal");
  });

  it("everything else is transient and retried", () => {
    expect(pollErrorRoute(500, true)).toBe("transient");
    expect(pollErrorRoute(0, false)).toBe("transient");
    expect(pollErrorRoute(429, true)).toBe("transient");
  });
});

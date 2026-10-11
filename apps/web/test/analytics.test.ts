import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureResult } from "posthog-js";
import {
  analyticsSettings,
  ANALYTICS_OFF_KEY,
  BLOCK_SELECTOR,
  isReadable,
  isRecordedPath,
  maskAttribute,
  maskReplayRequest,
  maskInput,
  maskText,
  isNewGoogleAccount,
  pageviewProperties,
  POSTHOG_EU_HOST,
  posthogOptions,
  renderRequestResult,
  sanitizeReferrer,
  sanitizeUrl,
  scrubEvent,
  STEP_EVENTS,
  stepProperties,
} from "../src/lib/analytics";
import { STEPS } from "../src/lib/onboarding";
import { CHECKOUT_STATES } from "../src/lib/plans-ui";
import { aWizardSteps } from "../src/lib/service-a-ui";
import { wizardSteps } from "../src/lib/service-b-ui";
import { C_WIZARD_STEPS } from "../src/lib/service-c-ui";

/**
 * PostHog in apps/web (vault 0103, 0104; docs/10-analytics.md). What the
 * founder's "done when" asks the tests to prove: no key, nothing loads; an
 * admin account sends nothing; public pages count and do not record while
 * /start and signed-in pages record; the account is identified by id only; a
 * named step cannot carry free text; an address is sent without its codes.
 * Plus the masking rules a recording runs through, which the browser check
 * (docs/10-analytics.md, "The hiding check") measured end to end.
 */

const WEB = join(__dirname, "..");
const SRC = join(WEB, "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function event(partial: Partial<CaptureResult>): CaptureResult {
  return { uuid: "u", event: "$pageview", properties: {}, ...partial } as CaptureResult;
}

// ---------------------------------------------------------------------------
// Settings and where recording runs
// ---------------------------------------------------------------------------

describe("analyticsSettings", () => {
  it("is off with no key, a blank key or a whitespace key", () => {
    expect(analyticsSettings({})).toBeNull();
    expect(analyticsSettings({ key: "" })).toBeNull();
    expect(analyticsSettings({ key: "   " })).toBeNull();
  });

  it("defaults to the EU cloud", () => {
    expect(analyticsSettings({ key: "phc_x" })).toEqual({ key: "phc_x", host: POSTHOG_EU_HOST });
  });

  it("refuses any host but the EU cloud or a loopback stand-in", () => {
    expect(analyticsSettings({ key: "phc_x", host: "https://us.i.posthog.com" })).toBeNull();
    expect(analyticsSettings({ key: "phc_x", host: "https://tavnit.ai/ingest" })).toBeNull();
    expect(analyticsSettings({ key: "phc_x", host: "http://127.0.0.1:8789/" })).toEqual({
      key: "phc_x",
      host: "http://127.0.0.1:8789",
    });
  });
});

describe("isRecordedPath", () => {
  it.each([
    ["/start", true],
    ["/login", true],
    ["/forgot-password", true],
    ["/reset-password", true],
    ["/home", true],
    ["/home/a/new", true],
    ["/home/plan/checkout", true],
    ["/connect/instagram", true],
    ["/", false],
    ["/pricing", false],
    ["/privacy", false],
    ["/terms", false],
    ["/about", false],
    ["/contact", false],
    ["/social/deletion/abc", false],
    ["/started", false],
    ["/homepage", false],
  ])("%s → %s", (pathname, recorded) => {
    expect(isRecordedPath(pathname)).toBe(recorded);
  });
});

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

describe("an address is sent without its codes", () => {
  it.each([
    [
      "the recovery token on /reset-password",
      "https://tavnit.ai/reset-password?token_hash=pkce_abc123&type=recovery",
      "https://tavnit.ai/reset-password",
    ],
    [
      "an auth code",
      "https://tavnit.ai/auth/callback?code=2c1f0f0e-1111-4c4c-8d8d-123456789abc",
      "https://tavnit.ai/auth/callback",
    ],
    [
      "tokens and GoTrue errors in the fragment",
      "https://tavnit.ai/login?error=oauth#access_token=eyJ.x.y&refresh_token=r1&error_description=Email+link+is+invalid",
      "https://tavnit.ai/login",
    ],
    [
      "Sumit ids inside a next= on /login",
      "https://tavnit.ai/login?next=%2Fapi%2Fbilling%2Fsumit%2Freturn%3Fog-paymentid%3D9%26og-customerid%3D7",
      "https://tavnit.ai/login",
    ],
    [
      "the deletion code in the path",
      "https://tavnit.ai/social/deletion/0f3a9c4e5b6d7a8b9c0d1e2f3a4b5c6d",
      "https://tavnit.ai/social/deletion/:id",
    ],
    [
      "a signed storage link",
      "https://x.supabase.co/storage/v1/object/sign/renders/9b2d0c3e-1d4f-4a5b-8c6d-7e8f9a0b1c2d/out.mp4?token=eyJhbGci",
      "https://x.supabase.co/storage/v1/object/sign/renders/:id/out.mp4",
    ],
    [
      "the A wizard's demo id",
      "https://tavnit.ai/home/a/new?demo=9b2d0c3e-1d4f-4a5b-8c6d-7e8f9a0b1c2d&step=3",
      "https://tavnit.ai/home/a/new",
    ],
  ])("%s", (_label, raw, expected) => {
    expect(sanitizeUrl(raw)).toBe(expected);
  });

  it("keeps where the visitor came from, the plan code and the payment outcome", () => {
    expect(
      sanitizeUrl("https://tavnit.ai/?utm_source=instagram&utm_campaign=reel_3&fbclid=IwAR0"),
    ).toBe("https://tavnit.ai/?utm_source=instagram&utm_campaign=reel_3");
    expect(sanitizeUrl("https://tavnit.ai/start?plan=pro")).toBe(
      "https://tavnit.ai/start?plan=pro",
    );
    expect(sanitizeUrl("https://tavnit.ai/home/plan?checkout=success")).toBe(
      "https://tavnit.ai/home/plan?checkout=success",
    );
  });

  it("drops a kept parameter whose value is not a code", () => {
    expect(
      sanitizeUrl("https://tavnit.ai/start?plan=%D7%94%D7%A2%D7%A1%D7%A7+%D7%A9%D7%9C%D7%99"),
    ).toBe("https://tavnit.ai/start");
  });

  it("cuts a referrer to its site", () => {
    expect(sanitizeReferrer("https://www.google.com/search?q=my+private+search")).toBe(
      "https://www.google.com",
    );
    expect(sanitizeReferrer("$direct")).toBe("$direct");
  });
});

describe("scrubEvent", () => {
  it("cleans the URL properties, the first-visit person properties and the referrers", () => {
    const scrubbed = scrubEvent(
      event({
        event: "$identify",
        properties: {
          $current_url: "https://tavnit.ai/reset-password?token_hash=abc&type=recovery",
          $pathname: "/social/deletion/0f3a9c4e5b6d7a8b9c0d1e2f3a4b5c6d",
          $referrer: "https://sumit.co.il/pay?emailaddress=a%40b.co&name=x",
          fbclid: "IwAR0",
          ph_keyword: "a private search",
          utm_source: "instagram",
        },
        $set_once: {
          $initial_current_url: "https://tavnit.ai/auth/callback?code=c0de",
          $initial_referrer: "https://l.instagram.com/?u=https%3A%2F%2Ftavnit.ai&e=AT0",
          $initial_fbclid: "IwAR0",
        },
        $set: { $fbc: "fb.1.123.IwAR0" },
      }),
    )!;
    expect(scrubbed.properties).toEqual({
      $current_url: "https://tavnit.ai/reset-password",
      $pathname: "/social/deletion/:id",
      $referrer: "https://sumit.co.il",
      utm_source: "instagram",
    });
    expect(scrubbed.$set_once).toEqual({
      $initial_current_url: "https://tavnit.ai/auth/callback",
      $initial_referrer: "https://l.instagram.com",
    });
    expect(scrubbed.$set).toEqual({});
  });

  it("cleans a recording batch: page addresses cut, network and console events dropped", () => {
    const scrubbed = scrubEvent(
      event({
        event: "$snapshot",
        properties: {
          $snapshot_data: [
            {
              type: 4,
              data: { href: "https://tavnit.ai/reset-password?token_hash=abc", width: 1 },
            },
            {
              type: 5,
              data: { tag: "$pageview", payload: { href: "https://tavnit.ai/login?next=%2Fhome" } },
            },
            {
              type: 6,
              data: {
                plugin: "rrweb/network@1",
                payload: { requests: [{ name: "https://x/?token=t" }] },
              },
            },
            { type: 2, data: "compressed" },
          ],
        },
      }),
    )!;
    expect(scrubbed.properties.$snapshot_data).toEqual([
      { type: 4, data: { href: "https://tavnit.ai/reset-password", width: 1 } },
      { type: 5, data: { tag: "$pageview", payload: { href: "https://tavnit.ai/login" } } },
      { type: 2, data: "compressed" },
    ]);
  });

  it("cleans every address in the SDK's own recording events, without touching the SDK's objects", () => {
    const live = { api_host: "https://eu.i.posthog.com", untouched: true };
    const payload = {
      reason: "url_trigger_matched",
      matchedUrl: "https://tavnit.ai/reset-password?token_hash=T#access_token=A",
      note: "seen at https://tavnit.ai/login?next=%2Fapi%2Fbilling%2Fsumit%2Freturn%3Fog-paymentid%3D9 today",
      config: live,
    };
    const scrubbed = scrubEvent(
      event({
        event: "$snapshot",
        properties: { $snapshot_data: [{ type: 5, data: { tag: "$recording_started", payload } }] },
      }),
    )!;
    const [out] = scrubbed.properties.$snapshot_data as Array<{
      data: { payload: { matchedUrl: string; note: string } };
    }>;
    expect(out!.data.payload.matchedUrl).toBe("https://tavnit.ai/reset-password");
    expect(out!.data.payload.note).toBe("seen at https://tavnit.ai/login today");
    expect(payload.matchedUrl).toContain("token_hash");
    expect(live.api_host).toBe("https://eu.i.posthog.com");
  });

  it("strips addresses out of an error's message and frames", () => {
    const scrubbed = scrubEvent(
      event({
        event: "$exception",
        properties: {
          $exception_list: [
            {
              type: "Error",
              value:
                "Invalid src prop (https://x.supabase.co/storage/v1/object/sign/a/b.png?token=eyJ) on `next/image`",
              stacktrace: {
                frames: [{ filename: "https://tavnit.ai/_next/static/chunks/app.js?dpl=abc" }],
              },
            },
          ],
        },
      }),
    )!;
    const [exception] = scrubbed.properties.$exception_list as Array<{
      value: string;
      stacktrace: { frames: Array<{ filename: string }> };
    }>;
    expect(exception!.value).toBe(
      "Invalid src prop (https://x.supabase.co/storage/v1/object/sign/a/b.png) on `next/image`",
    );
    expect(exception!.stacktrace.frames[0]!.filename).toBe(
      "https://tavnit.ai/_next/static/chunks/app.js",
    );
  });
});

// ---------------------------------------------------------------------------
// Recordings: hidden by default
// ---------------------------------------------------------------------------

/** A stand-in element: its ancestor chain, nearest first, matched by tag or [attribute]. */
function el(...chain: Array<string>): { closest(selector: string): unknown } {
  const nodes = chain.map((spec) => {
    const [tag, ...attrs] = spec.split(" ");
    return { tag: tag!, attrs };
  });
  const matches = (node: { tag: string; attrs: string[] }, selector: string) =>
    selector
      .split(",")
      .map((part) => part.trim())
      .some((part) =>
        part.startsWith("[") ? node.attrs.includes(part.slice(1, -1)) : node.tag === part,
      );
  return { closest: (selector) => nodes.find((node) => matches(node, selector)) ?? null };
}

describe("recording masks", () => {
  it("hides text nobody marked", () => {
    expect(maskText("העסק של דנה", el("span", "div", "body"))).toBe("**** ** ***");
    expect(isReadable(null)).toBe(false);
  });

  it("shows text under data-ph-unmask", () => {
    expect(maskText("איזו מודעה אתם יוצרים היום?", el("h1", "div data-ph-unmask", "body"))).toBe(
      "איזו מודעה אתם יוצרים היום?",
    );
  });

  it("lets data-ph-mask win inside a readable region", () => {
    expect(maskText("קהל היעד: אמהות", el("span", "ul data-ph-mask", "div data-ph-unmask"))).toBe(
      "*** ***** *****",
    );
  });

  it("never shows a field's text, marked or not", () => {
    for (const tag of ["textarea", "option", "select", "input"]) {
      expect(maskText("typed", el(tag, "div data-ph-unmask"))).toBe("*****");
    }
    expect(maskText("typed", el("p", "div contenteditable", "div data-ph-unmask"))).toBe("*****");
  });

  it("strips tokens from addresses and hides words in attributes", () => {
    const readable = el("img", "div data-ph-unmask");
    const hidden = el("span", "div");
    expect(
      maskAttribute("src", "https://x.supabase.co/storage/v1/object/sign/a.mp4?token=eyJ", hidden),
    ).toBe("https://x.supabase.co/storage/v1/object/sign/a.mp4");
    expect(maskAttribute("href", "/home/renders?x=1#y", hidden)).toBe("/home/renders");
    expect(maskAttribute("srcset", "/_next/image?url=a%3Ftoken%3Dt 1x", readable)).toBe("");
    expect(
      maskAttribute("style", "background-image: url(https://x/?token=t); width: 40%", hidden),
    ).toBe("background-image: url(); width: 40%");
    expect(maskAttribute("aria-label", "העסק של דנה", hidden)).toBe("**** ** ***");
    expect(maskAttribute("aria-label", "שלבי היצירה", readable)).toBe("שלבי היצירה");
    expect(maskAttribute("value", "typed", el("input", "div data-ph-unmask"))).toBe("*****");
    expect(maskAttribute("data-anything", "secret", hidden)).toBe("******");
    expect(maskAttribute("class", "text-sm text-ink", hidden)).toBe("text-sm text-ink");
  });

  it("masks every field to the same five asterisks, so its length does not leave", () => {
    expect(maskInput("a-13-char-pw!")).toBe("*****");
    expect(maskInput("x")).toBe("*****");
    expect(maskInput("")).toBe("");
  });

  it("blocks media and the two inputs the recorder never masks", () => {
    for (const selector of ["img", "video", "audio", "input[type=file]", "input[type=hidden]"]) {
      expect(BLOCK_SELECTOR.split(", ")).toContain(selector);
    }
  });

  it("cuts the page address the recorder writes and drops captured network requests", () => {
    expect(maskReplayRequest({ name: "https://tavnit.ai/reset-password?token_hash=abc" })).toEqual({
      name: "https://tavnit.ai/reset-password",
    });
    expect(
      maskReplayRequest({ name: "https://x/?token=t", initiatorType: "fetch", method: "GET" }),
    ).toBeNull();
  });
});

describe("posthogOptions", () => {
  const settings = { key: "phc_x", host: POSTHOG_EU_HOST };

  it("turns on only what was decided, explicitly", () => {
    const options = posthogOptions(settings, () => true);
    expect(options).toMatchObject({
      api_host: POSTHOG_EU_HOST,
      ui_host: "https://eu.posthog.com",
      persistence: "localStorage",
      person_profiles: "identified_only",
      capture_pageview: false,
      capture_pageleave: false,
      autocapture: false,
      capture_dead_clicks: false,
      capture_heatmaps: false,
      capture_performance: false,
      enable_recording_console_log: false,
      disable_session_recording: true,
      disable_surveys: true,
      advanced_disable_feature_flags: true,
      disable_external_dependency_loading: true,
      disable_capture_url_hashes: true,
      capture_exceptions: {
        capture_unhandled_errors: true,
        capture_unhandled_rejections: true,
        capture_console_errors: false,
      },
      get_current_url: sanitizeUrl,
      session_recording: {
        maskAllInputs: true,
        maskInputFn: maskInput,
        maskTextSelector: "*",
        maskAllElementAttributes: false,
        blockSelector: BLOCK_SELECTOR,
        recordHeaders: false,
        recordBody: false,
        captureCanvas: { recordCanvas: false },
      },
    });
  });

  it("drops every event while the gate says no, and scrubs it while it says yes", () => {
    let allowed = false;
    const beforeSend = posthogOptions(settings, () => allowed).before_send as (
      e: CaptureResult | null,
    ) => CaptureResult | null;
    const pageview = () =>
      event({ properties: { $current_url: "https://tavnit.ai/reset-password?token_hash=abc" } });
    expect(beforeSend(pageview())).toBeNull();
    expect(
      beforeSend(event({ event: "$snapshot", properties: { $snapshot_data: [] } })),
    ).toBeNull();
    allowed = true;
    expect(beforeSend(pageview())!.properties.$current_url).toBe(
      "https://tavnit.ai/reset-password",
    );
  });
});

// ---------------------------------------------------------------------------
// Named steps
// ---------------------------------------------------------------------------

describe("a named step cannot carry free text", () => {
  it("passes the step's own codes", () => {
    expect(stepProperties("checkout_started", { plan: "pro" })).toEqual({ plan: "pro" });
    expect(stepProperties("wizard_step_viewed", { service: "c", step: "studio" })).toEqual({
      service: "c",
      step: "studio",
    });
    expect(stepProperties("plans_viewed", {})).toEqual({});
  });

  it.each([
    ["text in a code field", "checkout_started", { plan: "העסק של דנה" }],
    ["a space in a code", "checkout_started", { plan: "my plan" }],
    ["a value off the list", "start_step_viewed", { step: "free text the visitor typed" }],
    ["an extra property", "no_credits_wall", { service: "a", note: "x" }],
    ["a missing property", "render_requested", { service: "a" }],
    ["a non-string", "no_credits_wall", { service: 1 }],
    ["anything on an empty step", "plans_viewed", { businessName: "דנה" }],
    ["an unknown step", "business_name_typed", { name: "דנה" }],
  ])("refuses %s", (_label, name, props) => {
    expect(stepProperties(name, props)).toBeNull();
  });

  it("tells a Google account made in the last ten minutes", () => {
    const now = Date.parse("2026-10-11T12:00:00Z");
    const google = { app_metadata: { provider: "google" } };
    expect(isNewGoogleAccount({ ...google, created_at: "2026-10-11T11:55:00Z" }, now)).toBe(true);
    expect(isNewGoogleAccount({ ...google, created_at: "2026-10-10T11:55:00Z" }, now)).toBe(false);
    expect(
      isNewGoogleAccount(
        { app_metadata: { provider: "email" }, created_at: "2026-10-11T11:55:00Z" },
        now,
      ),
    ).toBe(false);
  });

  it("reads a pageview's address and its campaign when the route is reported", () => {
    expect(
      pageviewProperties("https://tavnit.ai/start?plan=pro&utm_source=ig&utm_term=a+b"),
    ).toEqual({
      $current_url: "https://tavnit.ai/start?plan=pro&utm_source=ig&utm_term=a+b",
      $pathname: "/start",
      utm_source: "ig",
      utm_term: "a b",
    });
  });

  it("names a render request's answer by its code", () => {
    expect(renderRequestResult({ ok: true })).toBe("ok");
    expect(renderRequestResult({ ok: false, status: 402 })).toBe("no_credits");
    expect(renderRequestResult({ ok: false, status: 422 })).toBe("refused");
    expect(renderRequestResult({ ok: false, status: 500 })).toBe("error");
  });

  it("lists exactly the code's own steps and outcomes", () => {
    expect(STEP_EVENTS.start_step_viewed.step).toEqual([...STEPS]);
    expect(STEP_EVENTS.payment_returned.outcome).toEqual([...CHECKOUT_STATES]);
    expect([...STEP_EVENTS.wizard_step_viewed.step].sort()).toEqual(
      [...new Set([...aWizardSteps("steps"), ...wizardSteps(), ...C_WIZARD_STEPS])].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// The runtime: the gate, the loader, identity
// ---------------------------------------------------------------------------

type SdkDouble = Record<
  | "init"
  | "identify"
  | "capture"
  | "startSessionRecording"
  | "stopSessionRecording"
  | "get_distinct_id"
  | "captureException"
  | "reset"
  | "get_property",
  ReturnType<typeof vi.fn>
>;

const sdk = vi.hoisted(() => ({ ph: null as null | SdkDouble }));

// The factory runs once for the file; the proxy hands each test its own fresh SDK double.
vi.mock("posthog-js/full/no-external", () => ({
  default: new Proxy(
    {},
    { get: (_target, key: string) => (sdk.ph as Record<string, unknown>)[key] },
  ),
}));

/** How many times the SDK was started: once per fresh runtime that got past the gate. */
const loads = () => sdk.ph!.init!.mock.calls.length;

describe("the runtime", () => {
  let cookie = "";
  const location = { href: "https://tavnit.ai/" };
  let store: Map<string, string>;
  let fetchMock: ReturnType<typeof vi.fn>;

  async function client(key = "phc_test") {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", key);
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "");
    // The project ref is "ref", so the session cookie is sb-ref-auth-token.
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
    vi.resetModules();
    return import("../src/lib/analytics-client");
  }

  function initOptions() {
    return sdk.ph!.init!.mock.calls[0]![1] as ReturnType<typeof posthogOptions>;
  }

  beforeEach(() => {
    sdk.ph = {
      init: vi.fn(),
      identify: vi.fn(),
      capture: vi.fn(),
      startSessionRecording: vi.fn(),
      stopSessionRecording: vi.fn(),
      get_distinct_id: vi.fn(() => "anon-1"),
      captureException: vi.fn(),
      reset: vi.fn(),
      get_property: vi.fn(() => undefined),
    };
    cookie = "";
    location.href = "https://tavnit.ai/";
    store = new Map();
    fetchMock = vi.fn();
    vi.stubGlobal("document", {
      get cookie() {
        return cookie;
      },
    });
    vi.stubGlobal("window", {
      location,
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
      },
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function viewer(status: number, body?: object) {
    fetchMock.mockResolvedValue({
      status,
      ok: status >= 200 && status < 300,
      json: async () => body,
    });
  }

  it("with no key, nothing loads and nothing is asked", async () => {
    const { onRoute, track } = await client("");
    cookie = "sb-ref-auth-token=base64-abc";
    await onRoute("/start");
    track("plans_viewed", {});
    expect(loads()).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a public page counts the visit and never records", async () => {
    const { onRoute } = await client();
    await onRoute("/");
    expect(loads()).toBe(1);
    expect(initOptions().disable_session_recording).toBe(true);
    expect(sdk.ph!.startSessionRecording).not.toHaveBeenCalled();
    expect(sdk.ph!.stopSessionRecording).toHaveBeenCalled();
    expect(sdk.ph!.capture).toHaveBeenCalledWith("$pageview", {
      $current_url: "https://tavnit.ai/",
      $pathname: "/",
    });
  });

  it("counts the page the route was reported on, even if the visitor moved on before the SDK loaded", async () => {
    const { onRoute } = await client();
    location.href = "https://tavnit.ai/?utm_source=instagram&fbclid=x";
    const done = onRoute("/");
    location.href = "https://tavnit.ai/start";
    await done;
    expect(sdk.ph!.capture).toHaveBeenCalledWith("$pageview", {
      $current_url: "https://tavnit.ai/?utm_source=instagram&fbclid=x",
      $pathname: "/",
      utm_source: "instagram",
    });
  });

  it("ignores another Supabase project's leftover cookie", async () => {
    const { onRoute } = await client();
    cookie = "sb-oldproject-auth-token=base64-stale";
    await onRoute("/home");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sdk.ph!.identify).not.toHaveBeenCalled();
  });

  it("stops the recorder inside the commit that leaves for a public page", async () => {
    const { onRoute, stopRecordingIfPublic } = await client();
    await onRoute("/start");
    sdk.ph!.stopSessionRecording.mockClear();
    stopRecordingIfPublic("/start/next");
    expect(sdk.ph!.stopSessionRecording).not.toHaveBeenCalled();
    stopRecordingIfPublic("/privacy");
    expect(sdk.ph!.stopSessionRecording).toHaveBeenCalledTimes(1);
  });

  it("/start and signed-in pages record", async () => {
    const { onRoute } = await client();
    await onRoute("/start");
    expect(sdk.ph!.startSessionRecording).toHaveBeenCalledTimes(1);
    await onRoute("/pricing");
    expect(sdk.ph!.stopSessionRecording).toHaveBeenCalledTimes(1);
    cookie = "sb-ref-auth-token=base64-abc";
    viewer(200, { admin: false, id: "user-1" });
    await onRoute("/home/a/new");
    expect(sdk.ph!.startSessionRecording).toHaveBeenCalledTimes(2);
  });

  it("an admin account sends nothing, and the device stays off afterwards", async () => {
    const { onRoute, track } = await client();
    cookie = "sb-ref-auth-token=base64-abc";
    viewer(200, { admin: true });
    await onRoute("/home");
    track("plans_viewed", {});
    expect(loads()).toBe(0);
    expect(store.get(ANALYTICS_OFF_KEY)).toBe("1");

    cookie = "";
    await onRoute("/");
    expect(loads()).toBe(0);
  });

  it("an admin who signs in after an anonymous page is cut off at once", async () => {
    const { onRoute, track } = await client();
    await onRoute("/login");
    const beforeSend = initOptions().before_send as (e: CaptureResult) => CaptureResult | null;
    // The sign-in writes the cookie; before the next route has even asked who
    // this is, nothing leaves: no recording chunk, no step.
    cookie = "sb-ref-auth-token=base64-abc";
    expect(beforeSend(event({ event: "$snapshot", properties: {} }))).toBeNull();
    track("plans_viewed", {});
    expect(sdk.ph!.capture).toHaveBeenCalledTimes(1); // the /login pageview only
    viewer(200, { admin: true });
    await onRoute("/home");
    expect(sdk.ph!.stopSessionRecording).toHaveBeenCalled();
    expect(sdk.ph!.capture).toHaveBeenCalledTimes(1); // the /login pageview only
    expect(beforeSend(event({ event: "$snapshot", properties: {} }))).toBeNull();
    expect(beforeSend(event({ event: "$exception", properties: {} }))).toBeNull();
  });

  it("when the account cannot be checked, nothing is sent", async () => {
    const { onRoute } = await client();
    cookie = "sb-ref-auth-token=base64-abc";
    viewer(503, { ok: false });
    await onRoute("/home");
    expect(loads()).toBe(0);
  });

  it("identifies a customer by the user id and nothing else", async () => {
    const { onRoute } = await client();
    cookie = "sb-ref-auth-token=base64-abc";
    viewer(200, { admin: false, id: "user-1" });
    await onRoute("/home");
    expect(fetchMock).toHaveBeenCalledWith("/api/analytics/viewer", { cache: "no-store" });
    expect(sdk.ph!.identify).toHaveBeenCalledTimes(1);
    expect(sdk.ph!.identify.mock.calls[0]).toEqual(["user-1"]);
  });

  it("joins a /start visitor to the account they create", async () => {
    const { onRoute } = await client();
    await onRoute("/start");
    expect(sdk.ph!.identify).not.toHaveBeenCalled();
    cookie = "sb-ref-auth-token=base64-abc";
    viewer(200, { admin: false, id: "user-1" });
    await onRoute("/home");
    expect(sdk.ph!.identify.mock.calls).toEqual([["user-1"]]);
  });

  it("sends a step's codes, refuses free text, and holds early steps until the gate opens", async () => {
    const { onRoute, track } = await client();
    track("start_step_viewed", { step: "business" });
    expect(sdk.ph!.capture).not.toHaveBeenCalled();
    await onRoute("/start");
    expect(sdk.ph!.capture).toHaveBeenCalledWith(
      "start_step_viewed",
      { step: "business" },
      undefined,
    );

    track("checkout_started", { plan: "העסק של דנה" });
    track("checkout_started", { plan: "pro" }, { beacon: true });
    const names = sdk.ph!.capture.mock.calls.map((call) => call[0]);
    expect(names.filter((name) => name === "checkout_started")).toHaveLength(1);
    expect(sdk.ph!.capture).toHaveBeenLastCalledWith(
      "checkout_started",
      { plan: "pro" },
      { send_instantly: true, transport: "sendBeacon" },
    );
  });

  it("does not carry over an identity whose session ended without signOut()", async () => {
    const { onRoute } = await client();
    sdk.ph!.get_property.mockImplementation((key: string) =>
      key === "$user_id" ? "user-A" : undefined,
    );
    await onRoute("/start");
    expect(sdk.ph!.reset).toHaveBeenCalledTimes(1);
  });

  it("starts another account fresh, then identifies it", async () => {
    const { onRoute } = await client();
    sdk.ph!.get_property.mockImplementation((key: string) =>
      key === "$user_id" ? "user-A" : undefined,
    );
    cookie = "sb-ref-auth-token=base64-b";
    viewer(200, { admin: false, id: "user-B" });
    await onRoute("/home");
    expect(sdk.ph!.reset).toHaveBeenCalledTimes(1);
    expect(sdk.ph!.identify.mock.calls).toEqual([["user-B"]]);
  });

  it("keeps an error caught before the SDK loaded and sends it once the gate opens", async () => {
    const { onRoute, captureError } = await client();
    const error = new Error("render failed");
    captureError(error);
    expect(sdk.ph!.captureException).not.toHaveBeenCalled();
    cookie = "sb-ref-auth-token=base64-abc";
    viewer(200, { admin: false, id: "user-1" });
    await onRoute("/home/renders");
    expect(sdk.ph!.captureException).toHaveBeenCalledWith(error);
  });

  it("drops a held error when the gate says no", async () => {
    const { onRoute, captureError } = await client();
    captureError(new Error("x"));
    cookie = "sb-ref-auth-token=base64-abc";
    viewer(200, { admin: true });
    await onRoute("/home");
    expect(sdk.ph!.captureException).not.toHaveBeenCalled();
  });

  it("forgets the person on sign-out", async () => {
    const { onRoute, resetAnalytics } = await client();
    await onRoute("/home/settings");
    resetAnalytics();
    expect(sdk.ph!.reset).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Where things live
// ---------------------------------------------------------------------------

describe("the SDK's boundaries", () => {
  it("is imported in one file, lazily, and nowhere statically", () => {
    const importers = sourceFiles(SRC)
      .map((file) => ({
        name: relative(SRC, file).split("\\").join("/"),
        source: readFileSync(file, "utf8"),
      }))
      .filter(({ source }) => /from "posthog-js|import\("posthog-js/.test(source));
    const runtime = importers.filter(({ source }) => /import\("posthog-js/.test(source));
    expect(runtime.map(({ name }) => name)).toEqual(["lib/analytics-client.ts"]);
    for (const { name, source } of importers) {
      // Type-only imports erase at build time and load nothing.
      for (const line of source.split("\n").filter((l) => /from "posthog-js/.test(l))) {
        expect(line, name).toMatch(/^import type /);
      }
    }
  });

  it("is not in apps/admin at all", () => {
    const admin = join(WEB, "..", "admin");
    const pkg = JSON.parse(readFileSync(join(admin, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect({ ...pkg.dependencies, ...pkg.devDependencies }).not.toHaveProperty("posthog-js");
    for (const file of sourceFiles(join(admin, "src"))) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/posthog/i);
    }
  });
});

// ---------------------------------------------------------------------------
// The visitor is told
// ---------------------------------------------------------------------------

function elements(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: ReactNode };
  return [node, ...elements(props.children)];
}

describe("the notice line", () => {
  it("is on the first screen of /start, below the first question", async () => {
    const { RecordingNotice } = await import("../src/components/recording-notice");
    const { StepBusiness } = await import("../src/components/onboarding/steps/step-business");
    const tree = elements(StepBusiness({ selected: null, onSelect: () => {} }));
    const notice = tree.findIndex((node) => node.type === RecordingNotice);
    const question = tree.findIndex(
      (node) => (node.props as { role?: string }).role === "radiogroup",
    );
    expect(notice).toBeGreaterThan(-1);
    expect(notice).toBeGreaterThan(question);
  });

  it.each([
    ["/login", "../src/app/login/page"],
    ["/forgot-password", "../src/app/forgot-password/page"],
    ["/reset-password", "../src/app/reset-password/page"],
  ])("is on %s", async (_route, path) => {
    const { RecordingNotice } = await import("../src/components/recording-notice");
    const { default: Page } = (await import(path)) as {
      default: (props: { searchParams: Promise<object> }) => Promise<ReactNode>;
    };
    const tree = elements(await Page({ searchParams: Promise.resolve({}) }));
    expect(tree.some((node) => node.type === RecordingNotice)).toBe(true);
  });

  it("is named in /privacy with every storage key the SDK and the gate write", () => {
    const privacy = readFileSync(join(SRC, "app", "(legal)", "privacy", "page.tsx"), "utf8");
    expect(privacy).toContain("PostHog");
    expect(privacy).toContain("ANALYTICS_OFF_KEY");
    expect(privacy).toContain("ph_");
  });
});

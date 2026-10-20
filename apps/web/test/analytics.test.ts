import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureResult } from "posthog-js";
import {
  analyticsSettings,
  ANALYTICS_OFF_KEY,
  BLOCK_SELECTOR,
  isHidden,
  isPlayableMedia,
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
 * PostHog in apps/web (vault 0103, 0104, 0110; docs/10-analytics.md). What
 * the founder's "done when" asks the tests to prove: no key, nothing loads;
 * every page records and nothing stops it between public and app pages; a
 * customer's sign-in leaves no gap while an admin's still stops everything and
 * marks the device; the account is identified by id only; passwords, codes,
 * emails and identity fields are masked while business content and interface
 * copy are not; a named step cannot carry free text; an address is sent
 * without its codes. The browser check (docs/10-analytics.md, "The hiding
 * check") measures the masking end to end.
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
// Recordings: shown as on screen, the sensitive hidden
// ---------------------------------------------------------------------------

/**
 * A stand-in element: its ancestor chain, nearest first, each written as a tag
 * and its attributes (`input type=password`, `form data-ph-mask`). closest()
 * understands tags, [name], [name=value] and [name~="value"], which is all the
 * policy's selectors use.
 */
function el(...chain: Array<string>): { closest(selector: string): unknown } {
  const nodes = chain.map((spec) => {
    const [tag, ...pairs] = spec.split(" ");
    const attrs = new Map(
      pairs.map((pair) => {
        const [name, value = ""] = pair.split("=");
        return [name!, value] as const;
      }),
    );
    return { tag: tag!, attrs };
  });
  const matchesPart = (node: (typeof nodes)[number], part: string) => {
    const parsed = /^([a-z]*)((?:\[[^\]]+\])*)$/.exec(part);
    if (!parsed || (parsed[1] && parsed[1] !== node.tag)) return false;
    for (const [, name, op, value] of parsed[2]!.matchAll(
      /\[([a-z-]+)(?:(~?=)"?([^"\]]*)"?)?\]/g,
    )) {
      const actual = node.attrs.get(name!);
      if (actual === undefined) return false;
      if (op === "=" && actual !== value) return false;
      if (op === "~=" && !actual.split(/\s+/).includes(value!)) return false;
    }
    return true;
  };
  return {
    closest: (selector) =>
      nodes.find((node) =>
        selector
          .split(",")
          .map((part) => part.trim())
          .some((part) => matchesPart(node, part)),
      ) ?? null,
  };
}

describe("recording masks", () => {
  it("shows interface copy and business content as they are on screen", () => {
    expect(maskText("איזו מודעה אתם יוצרים היום?", el("h1", "div", "body"))).toBe(
      "איזו מודעה אתם יוצרים היום?",
    );
    expect(maskText("העסק של דנה", el("span", "aside", "body"))).toBe("העסק של דנה");
    expect(maskText("קהל היעד: אמהות", el("li", "ul", "div"))).toBe("קהל היעד: אמהות");
    expect(maskText("פילאטיס", el("option", "select"))).toBe("פילאטיס");
  });

  it("shows what a customer types into a business field", () => {
    expect(maskInput("סטודיו יוגה בחיפה", el("textarea", "form"))).toBe("סטודיו יוגה בחיפה");
    expect(maskInput("קורס אונליין", el("input type=text", "div"))).toBe("קורס אונליין");
  });

  it("hides everything inside data-ph-mask: text, fields, words and links", () => {
    expect(isHidden(el("span", "p data-ph-mask"))).toBe(true);
    expect(maskText("dana@example.co.il", el("p data-ph-mask"))).toBe("******************");
    expect(maskText("@dana_yoga", el("bdi", "span data-ph-mask"))).toBe("**********");
    expect(maskInput("אפשר לחזור אליי ב-0501234567", el("textarea", "form data-ph-mask"))).toBe(
      "*****",
    );
    expect(maskAttribute("title", "דנה יוגה · מתוזמן", el("a data-ph-mask"))).toBe(
      "*** **** * ******",
    );
    expect(
      maskAttribute("href", "https://www.instagram.com/dana_yoga", el("a", "dd data-ph-mask")),
    ).toBe("");
  });

  it("hides passwords, emails, phone numbers and codes in any field, marked or not", () => {
    for (const field of [
      el("input type=password"),
      el("input type=email"),
      el("input type=tel"),
      el("input type=text data-rr-is-password=true"),
      el("input autocomplete=one-time-code"),
      el("input autocomplete=username"),
      el("input autocomplete=new-password"),
    ]) {
      expect(maskInput("a-13-char-pw!", field)).toBe("*****");
      expect(maskInput("", field)).toBe("");
      expect(maskAttribute("value", "a-13-char-pw!", field)).toBe("*************");
    }
  });

  it("hides an email address wherever it shows", () => {
    expect(maskText("כתבו לנו: hello@studio-dana.co.il ונחזור", el("p"))).toBe(
      `כתבו לנו: ${"*".repeat("hello@studio-dana.co.il".length)} ונחזור`,
    );
    expect(maskInput("פרטים במייל dana@x.com", el("textarea"))).toBe("פרטים במייל **********");
    expect(maskAttribute("aria-label", "dana@x.com", el("button"))).toBe("**********");
  });

  it("hides an address being typed from the moment its @ is, and shows a handle", () => {
    const address = "dana.cohen@studio-dana.co.il";
    for (let end = address.indexOf("@") + 1; end <= address.length; end++) {
      const typed = `פרטים: ${address.slice(0, end)}`;
      expect(maskInput(typed, el("textarea"))).toBe(`פרטים: ${"*".repeat(end)}`);
    }
    expect(maskText("עקבו אחרינו @dana_yoga", el("p"))).toBe("עקבו אחרינו @dana_yoga");
    // Bounded: a long run with no address costs no backtracking.
    const long = "x".repeat(30_000);
    const started = performance.now();
    expect(maskInput(`${long}@`, el("textarea"))).toBe(
      `${"x".repeat(30_000 - 64)}${"*".repeat(65)}`,
    );
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("cuts the codes out of an address typed into a field", () => {
    expect(
      maskInput("https://shop.co.il/p/yoga?preview_key=SECRET&utm_source=ig", el("input")),
    ).toBe("https://shop.co.il/p/yoga?utm_source=ig");
    expect(maskText("הקישור: https://shop.co.il/s?token=T", el("li"))).toBe(
      "הקישור: https://shop.co.il/s",
    );
  });

  it("hides text it cannot place", () => {
    expect(isHidden(null)).toBe(true);
    expect(maskText("טקסט", null)).toBe("****");
  });

  it("shows words in attributes, keeps structure, and cuts an address down", () => {
    const plain = el("a", "nav");
    expect(maskAttribute("aria-label", "שלבי היצירה", plain)).toBe("שלבי היצירה");
    expect(maskAttribute("data-step", "studio", plain)).toBe("studio");
    expect(maskAttribute("class", "text-sm text-ink", plain)).toBe("text-sm text-ink");
    expect(maskAttribute("rr_width", "120px", plain)).toBe("120px");
    expect(maskAttribute("href", "/home/renders?x=1#y", plain)).toBe("/home/renders");
    expect(maskAttribute("href", "/reset-password?token_hash=abc&type=recovery", plain)).toBe(
      "/reset-password",
    );
    expect(
      maskAttribute("style", "background-image: url(https://x/?token=t); width: 40%", plain),
    ).toBe("background-image: url(); width: 40%");
  });
});

describe("media in a recording", () => {
  const page = "https://tavnit.ai/home/b/new";

  it.each([
    ["Tavnit's own file", "/landing/presenter.mp4", true],
    ["Tavnit's own file, absolute", "https://tavnit.ai/previews/hook-demo.jpg", true],
    ["a build asset", "/_next/static/media/brand-mark.3f2a1c9d.png", true],
    [
      "the public catalogue",
      "https://ref.supabase.co/storage/v1/object/public/catalog/bank/persona_image/9b2d0c3e-1d4f-4a5b-8c6d-7e8f9a0b1c2d/0123456789abcdef.jpg",
      true,
    ],
    [
      "Next's optimiser serving the catalogue",
      "/_next/image?url=https%3A%2F%2Fref.supabase.co%2Fstorage%2Fv1%2Fobject%2Fpublic%2Fcatalog%2Fa.jpg&w=640&q=60",
      true,
    ],
    ["a stand-in still", "https://picsum.photos/seed/hook/270/480", true],
    [
      "a signed link",
      "https://ref.supabase.co/storage/v1/object/sign/renders/out.mp4?token=eyJhbGci",
      false,
    ],
    [
      "Next's optimiser serving a signed link",
      "/_next/image?url=https%3A%2F%2Fref.supabase.co%2Fstorage%2Fv1%2Fobject%2Fsign%2Fa.jpg%3Ftoken%3DeyJ&w=640&q=60",
      false,
    ],
    [
      "the Meta CDN",
      "https://scontent.cdninstagram.com/v/t51/p.jpg?stp=dst&oh=00_A&oe=6720",
      false,
    ],
    ["a blob from the visitor's tab", "blob:https://tavnit.ai/1f0e", false],
    ["a data: image", "data:image/png;base64,iVBORw0KGgo=", false],
    ["an /api/ route", "/api/renders/abc/video", false],
    ["an insecure host", "http://example.com/a.jpg", false],
  ])("%s → %s", (_label, link, playable) => {
    expect(isPlayableMedia(link, page)).toBe(playable);
  });

  describe("on the page", () => {
    beforeEach(() => {
      vi.stubGlobal("location", { href: page });
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("keeps a playable link whole and absolute, so the replay fetches it", () => {
      const video = el("video", "div");
      expect(maskAttribute("poster", "/landing/presenter.jpg", video)).toBe(
        "https://tavnit.ai/landing/presenter.jpg",
      );
      const catalogue =
        "/_next/image?url=https%3A%2F%2Fref.supabase.co%2Fstorage%2Fv1%2Fobject%2Fpublic%2Fcatalog%2Fa.jpg&w=640&q=60";
      expect(maskAttribute("src", catalogue, el("img"))).toBe(`https://tavnit.ai${catalogue}`);
      expect(
        maskAttribute(
          "srcset",
          `${catalogue} 1x, ${catalogue.replace("640", "1080")} 2x`,
          el("img"),
        ),
      ).toBe(`${catalogue} 1x, ${catalogue.replace("640", "1080")} 2x`);
    });

    it("cuts a link that would not play down to an address without its codes", () => {
      expect(
        maskAttribute(
          "src",
          "https://x.supabase.co/storage/v1/object/sign/renders/9b2d0c3e-1d4f-4a5b-8c6d-7e8f9a0b1c2d/out.mp4?token=eyJ",
          el("video"),
        ),
      ).toBe("https://x.supabase.co/storage/v1/object/sign/renders/:id/out.mp4");
      expect(
        maskAttribute("srcset", "/_next/image?url=a%3Ftoken%3Dt&w=640&q=60 1x", el("img")),
      ).toBe("");
    });

    it("drops every link inside a hidden container", () => {
      expect(maskAttribute("src", "/landing/presenter.jpg", el("img", "dd data-ph-mask"))).toBe("");
      expect(maskAttribute("srcset", "/landing/a.jpg 1x", el("img data-ph-mask"))).toBe("");
    });
  });

  it("boxes media that will not play, media inside a hidden container, and what is never recorded", () => {
    const parts = BLOCK_SELECTOR.split(", ");
    // Never media as such: Tavnit's own files and the public catalogue play.
    for (const tag of ["img", "video", "audio", "source", "picture"])
      expect(parts).not.toContain(tag);
    for (const part of [
      `img[src*="?"]:not([src^="/_next/image?"])`,
      `video[src*="?"]:not([src^="/_next/image?"])`,
      `source[src*="?"]:not([src^="/_next/image?"])`,
      `img[src^="/_next/image?"][src*="%3F"]`,
      `img[srcset*="?"]:not([srcset^="/_next/image?"])`,
      `video[poster^="data:"]`,
      `video[src^="blob:"]`,
      `audio[src^="/api/"]`,
      "[data-ph-mask] img",
      "video[data-ph-mask]",
      "canvas",
      "iframe",
      "input[type=file]",
      "input[type=hidden]",
    ]) {
      expect(parts).toContain(part);
    }
    // Plain compound selectors only: one part a browser cannot parse voids the whole list.
    expect(BLOCK_SELECTOR).not.toContain(":is(");
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
      [
        ...new Set([
          ...aWizardSteps("steps"),
          ...wizardSteps({ cutaways: true }),
          ...C_WIZARD_STEPS,
        ]),
      ].sort(),
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
> & { requestRouter: { endpointFor: ReturnType<typeof vi.fn> } };

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
    const runtime = await import("../src/lib/analytics-client");
    // A route as the browser reports it: the address changes, then <Analytics /> calls in.
    const visit = (path: string) => {
      location.href = `https://tavnit.ai${path}`;
      return runtime.onRoute();
    };
    return { ...runtime, visit };
  }

  function initOptions() {
    return sdk.ph!.init!.mock.calls[0]![1] as ReturnType<typeof posthogOptions>;
  }

  beforeEach(() => {
    // As the SDK does: identify() makes the id the distinct id and stores it as
    // $user_id; reset() starts a new anonymous id and forgets it.
    let distinctId = "anon-1";
    let userId: string | undefined;
    sdk.ph = {
      init: vi.fn(),
      identify: vi.fn((id: string) => {
        distinctId = id;
        userId = id;
      }),
      capture: vi.fn(),
      startSessionRecording: vi.fn(),
      stopSessionRecording: vi.fn(),
      get_distinct_id: vi.fn(() => distinctId),
      captureException: vi.fn(),
      reset: vi.fn(() => {
        distinctId = "anon-2";
        userId = undefined;
      }),
      get_property: vi.fn((key: string) => (key === "$user_id" ? userId : undefined)),
      requestRouter: {
        endpointFor: vi.fn((_target: string, path: string) => `https://eu.i.posthog.com${path}`),
      },
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
    const { visit, track } = await client("");
    cookie = "sb-ref-auth-token=base64-abc";
    await visit("/start");
    track("plans_viewed", {});
    expect(loads()).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("records every page, the landing and the other public pages included", async () => {
    const { visit } = await client();
    await visit("/");
    expect(loads()).toBe(1);
    // Nothing records before the gate has answered; then the page records.
    expect(initOptions().disable_session_recording).toBe(true);
    expect(sdk.ph!.startSessionRecording).toHaveBeenCalledTimes(1);
    expect(sdk.ph!.capture).toHaveBeenCalledWith("$pageview", {
      $current_url: "https://tavnit.ai/",
      $pathname: "/",
    });
    for (const path of [
      "/pricing",
      "/about",
      "/contact",
      "/privacy",
      "/terms",
      "/social/deletion/x",
    ]) {
      await visit(path);
    }
    expect(sdk.ph!.startSessionRecording).toHaveBeenCalledTimes(7);
    expect(sdk.ph!.stopSessionRecording).not.toHaveBeenCalled();
  });

  it("counts the page the route was reported on, even if the visitor moved on before the SDK loaded", async () => {
    const { onRoute } = await client();
    location.href = "https://tavnit.ai/?utm_source=instagram&fbclid=x";
    const done = onRoute();
    location.href = "https://tavnit.ai/start";
    await done;
    expect(sdk.ph!.capture).toHaveBeenCalledWith("$pageview", {
      $current_url: "https://tavnit.ai/?utm_source=instagram&fbclid=x",
      $pathname: "/",
      utm_source: "instagram",
    });
  });

  it("ignores another Supabase project's leftover cookie", async () => {
    const { visit } = await client();
    cookie = "sb-oldproject-auth-token=base64-stale";
    await visit("/home");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sdk.ph!.identify).not.toHaveBeenCalled();
  });

  it("never stops between public and app pages", async () => {
    const { visit } = await client();
    await visit("/pricing");
    await visit("/start");
    cookie = "sb-ref-auth-token=base64-abc";
    viewer(200, { admin: false, id: "user-1" });
    await visit("/home/a/new");
    await visit("/");
    await visit("/calendar");
    expect(sdk.ph!.stopSessionRecording).not.toHaveBeenCalled();
    expect(sdk.ph!.startSessionRecording).toHaveBeenCalledTimes(5);
  });

  /** The recorder's own request for a batch (posthog-js's _captureSnapshot, pinned below). */
  const RECORDING_REQUEST = {
    _url: "https://eu.i.posthog.com/s/",
    _noTruncate: true,
    _batchKey: "recordings",
    skip_client_rate_limiting: true,
  };

  it("a customer's sign-in leaves no gap: what was recorded meanwhile goes out once the account is known", async () => {
    const { visit, track } = await client();
    await visit("/login");
    const beforeSend = initOptions().before_send as (e: CaptureResult) => CaptureResult | null;
    // The sign-in writes the cookie. Until the gate knows who it is, nothing
    // leaves, but the recording batch is held, not lost, and so is the step.
    cookie = "sb-ref-auth-token=base64-abc";
    viewer(200, { admin: false, id: "user-1" });
    const batch = { $snapshot_data: [{ type: 3, data: "the sign-in" }], $session_id: "s1" };
    expect(beforeSend(event({ event: "$snapshot", properties: batch }))).toBeNull();
    track("home_first_arrival", { to: "home" });
    expect(sdk.ph!.capture).toHaveBeenCalledTimes(1); // the /login pageview only
    await visit("/home");
    expect(sdk.ph!.identify.mock.calls).toEqual([["user-1"]]);
    expect(sdk.ph!.capture).toHaveBeenCalledWith("$snapshot", batch, RECORDING_REQUEST);
    expect(sdk.ph!.capture).toHaveBeenCalledWith("home_first_arrival", { to: "home" }, undefined);
    expect(sdk.ph!.stopSessionRecording).not.toHaveBeenCalled();
    // The session matches the answer again: events leave at once.
    expect(beforeSend(event({ event: "$snapshot", properties: {} }))).not.toBeNull();
  });

  it("asks at once, not on the next route, when the session changes under a page", async () => {
    const { visit } = await client();
    await visit("/reset-password");
    const beforeSend = initOptions().before_send as (e: CaptureResult) => CaptureResult | null;
    cookie = "sb-ref-auth-token=base64-abc";
    viewer(200, { admin: false, id: "user-1" });
    const batch = { $snapshot_data: [{ type: 3 }] };
    expect(beforeSend(event({ event: "$snapshot", properties: batch }))).toBeNull();
    await vi.waitFor(() => {
      expect(sdk.ph!.capture).toHaveBeenCalledWith("$snapshot", batch, RECORDING_REQUEST);
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/analytics/viewer", { cache: "no-store" });
  });

  it("an admin's sign-in drops what was held, stops the recording and marks the device", async () => {
    const { visit } = await client();
    await visit("/login");
    const beforeSend = initOptions().before_send as (e: CaptureResult) => CaptureResult | null;
    cookie = "sb-ref-auth-token=base64-abc";
    viewer(200, { admin: true });
    expect(
      beforeSend(event({ event: "$snapshot", properties: { $snapshot_data: [] } })),
    ).toBeNull();
    await visit("/home");
    expect(sdk.ph!.capture).toHaveBeenCalledTimes(1); // the /login pageview only
    expect(sdk.ph!.stopSessionRecording).toHaveBeenCalled();
    expect(store.get(ANALYTICS_OFF_KEY)).toBe("1");
  });

  it("drops what a sign-in held when that session is gone before it was checked", async () => {
    const { visit, track } = await client();
    await visit("/login");
    const beforeSend = initOptions().before_send as (e: CaptureResult) => CaptureResult | null;
    cookie = "sb-ref-auth-token=base64-abc";
    let answer: (value: unknown) => void = () => {};
    fetchMock.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    expect(
      beforeSend(event({ event: "$snapshot", properties: { $snapshot_data: [] } })),
    ).toBeNull();
    track("plans_viewed", {});
    // Signed out again before the check answered: the next answer is anonymous,
    // and nothing a sign-in held goes out on an anonymous answer.
    cookie = "";
    answer({ status: 401, ok: false, json: async () => ({}) });
    await visit("/");
    const names = sdk.ph!.capture.mock.calls.map(([name]) => name);
    expect(names).not.toContain("$snapshot");
    expect(names).not.toContain("plans_viewed");
  });

  it("a sign-out through signOut() sends what it held with the anonymous answer", async () => {
    const { visit, resetAnalytics } = await client();
    cookie = "sb-ref-auth-token=base64-abc";
    viewer(200, { admin: false, id: "user-1" });
    await visit("/home/settings");
    const beforeSend = initOptions().before_send as (e: CaptureResult) => CaptureResult | null;
    resetAnalytics(); // signOut() resets before Supabase clears the cookie
    cookie = "";
    const batch = { $snapshot_data: [{ type: 3, data: "after the sign-out" }] };
    expect(beforeSend(event({ event: "$snapshot", properties: batch }))).toBeNull();
    await visit("/");
    expect(sdk.ph!.capture).toHaveBeenCalledWith("$snapshot", batch, RECORDING_REQUEST);
  });

  it("a session that ended any other way drops what it held: the identity changed", async () => {
    const { visit } = await client();
    cookie = "sb-ref-auth-token=base64-abc";
    viewer(200, { admin: false, id: "user-1" });
    await visit("/home/settings");
    const beforeSend = initOptions().before_send as (e: CaptureResult) => CaptureResult | null;
    cookie = "";
    expect(
      beforeSend(event({ event: "$snapshot", properties: { $snapshot_data: [] } })),
    ).toBeNull();
    await visit("/");
    expect(sdk.ph!.reset).toHaveBeenCalled();
    expect(sdk.ph!.capture.mock.calls.map(([name]) => name)).not.toContain("$snapshot");
  });

  it("an admin's session written over a customer's is stopped at once, not on the next route", async () => {
    const { visit, track } = await client();
    cookie = "sb-ref-auth-token=base64-customer";
    viewer(200, { admin: false, id: "user-1" });
    await visit("/home");
    const beforeSend = initOptions().before_send as (e: CaptureResult) => CaptureResult | null;
    const sent = sdk.ph!.capture.mock.calls.length;
    // Another sign-in replaces the cookie's value; it is never absent in between.
    cookie = "sb-ref-auth-token=base64-admin";
    viewer(200, { admin: true });
    expect(
      beforeSend(event({ event: "$snapshot", properties: { $snapshot_data: [] } })),
    ).toBeNull();
    track("plans_viewed", {});
    await vi.waitFor(() => expect(store.get(ANALYTICS_OFF_KEY)).toBe("1"));
    expect(sdk.ph!.stopSessionRecording).toHaveBeenCalled();
    expect(sdk.ph!.capture.mock.calls.length).toBe(sent);
    expect(beforeSend(event({ event: "$snapshot", properties: {} }))).toBeNull();
  });

  it("a token refresh holds for one answer and then sends what it held", async () => {
    const { visit } = await client();
    cookie = "sb-ref-auth-token=base64-before";
    viewer(200, { admin: false, id: "user-1" });
    await visit("/home");
    const beforeSend = initOptions().before_send as (e: CaptureResult) => CaptureResult | null;
    cookie = "sb-ref-auth-token=base64-refreshed";
    const batch = { $snapshot_data: [{ type: 3, data: "during the refresh" }] };
    expect(beforeSend(event({ event: "$snapshot", properties: batch }))).toBeNull();
    await vi.waitFor(() => {
      expect(sdk.ph!.capture).toHaveBeenCalledWith("$snapshot", batch, RECORDING_REQUEST);
    });
    expect(sdk.ph!.reset).not.toHaveBeenCalled();
  });

  it("stops when another tab has marked the device", async () => {
    const { visit } = await client();
    cookie = "sb-ref-auth-token=base64-abc";
    viewer(200, { admin: false, id: "user-1" });
    await visit("/home");
    const beforeSend = initOptions().before_send as (e: CaptureResult) => CaptureResult | null;
    store.set(ANALYTICS_OFF_KEY, "1");
    expect(
      beforeSend(event({ event: "$snapshot", properties: { $snapshot_data: [] } })),
    ).toBeNull();
    await vi.waitFor(() => expect(sdk.ph!.stopSessionRecording).toHaveBeenCalled());
    expect(sdk.ph!.capture.mock.calls.map(([name]) => name)).not.toContain("$snapshot");
  });

  it("queues nothing once the gate has said no, even where the device cannot be marked", async () => {
    const { visit, track } = await client();
    // No working localStorage: the device mark cannot be kept.
    vi.stubGlobal("window", { location, localStorage: null });
    cookie = "sb-ref-auth-token=base64-admin";
    viewer(200, { admin: true });
    await visit("/home/a/new");
    track("wizard_step_viewed", { service: "a", step: "persona" });
    // The admin's session ends; the next visitor is anonymous.
    cookie = "";
    await visit("/");
    expect(sdk.ph!.capture.mock.calls.map(([name]) => name)).toEqual(["$pageview"]);
  });

  it("re-sends a held batch exactly as the recorder sends one", () => {
    const recorder = readFileSync(
      join(
        WEB,
        "node_modules/posthog-js/lib/src/extensions/replay/external/lazy-loaded-session-recorder.js",
      ),
      "utf8",
    );
    expect(recorder).toContain("var BASE_ENDPOINT = '/s/';");
    expect(recorder).toContain("exports.SESSION_RECORDING_BATCH_KEY = 'recordings';");
    expect(recorder).toMatch(
      /this\._instance\.capture\('\$snapshot', properties, \{\s*_url: this\._instance\.requestRouter\.endpointFor\('api', this\._endpoint\),\s*_noTruncate: true,\s*_batchKey: exports\.SESSION_RECORDING_BATCH_KEY,\s*skip_client_rate_limiting: true,\s*\}\);/,
    );
  });

  it("an admin account sends nothing, and the device stays off afterwards", async () => {
    const { visit, track } = await client();
    cookie = "sb-ref-auth-token=base64-abc";
    viewer(200, { admin: true });
    await visit("/home");
    track("plans_viewed", {});
    expect(loads()).toBe(0);
    expect(store.get(ANALYTICS_OFF_KEY)).toBe("1");

    cookie = "";
    await visit("/");
    expect(loads()).toBe(0);
  });

  it("an admin who signs in after an anonymous page is cut off at once", async () => {
    const { visit, track } = await client();
    await visit("/login");
    const beforeSend = initOptions().before_send as (e: CaptureResult) => CaptureResult | null;
    // The sign-in writes the cookie; before the next route has even asked who
    // this is, nothing leaves: no recording chunk, no step.
    cookie = "sb-ref-auth-token=base64-abc";
    expect(beforeSend(event({ event: "$snapshot", properties: {} }))).toBeNull();
    track("plans_viewed", {});
    expect(sdk.ph!.capture).toHaveBeenCalledTimes(1); // the /login pageview only
    viewer(200, { admin: true });
    await visit("/home");
    expect(sdk.ph!.stopSessionRecording).toHaveBeenCalled();
    expect(sdk.ph!.capture).toHaveBeenCalledTimes(1); // the /login pageview only
    expect(beforeSend(event({ event: "$snapshot", properties: {} }))).toBeNull();
    expect(beforeSend(event({ event: "$exception", properties: {} }))).toBeNull();
  });

  it("when the account cannot be checked, nothing is sent", async () => {
    const { visit } = await client();
    cookie = "sb-ref-auth-token=base64-abc";
    viewer(503, { ok: false });
    await visit("/home");
    expect(loads()).toBe(0);
  });

  it("identifies a customer by the user id and nothing else", async () => {
    const { visit } = await client();
    cookie = "sb-ref-auth-token=base64-abc";
    viewer(200, { admin: false, id: "user-1" });
    await visit("/home");
    expect(fetchMock).toHaveBeenCalledWith("/api/analytics/viewer", { cache: "no-store" });
    expect(sdk.ph!.identify).toHaveBeenCalledTimes(1);
    expect(sdk.ph!.identify.mock.calls[0]).toEqual(["user-1"]);
  });

  it("joins a /start visitor to the account they create", async () => {
    const { visit } = await client();
    await visit("/start");
    expect(sdk.ph!.identify).not.toHaveBeenCalled();
    cookie = "sb-ref-auth-token=base64-abc";
    viewer(200, { admin: false, id: "user-1" });
    await visit("/home");
    expect(sdk.ph!.identify.mock.calls).toEqual([["user-1"]]);
  });

  it("sends a step's codes, refuses free text, and holds early steps until the gate opens", async () => {
    const { visit, track } = await client();
    track("start_step_viewed", { step: "business" });
    expect(sdk.ph!.capture).not.toHaveBeenCalled();
    await visit("/start");
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
    const { visit } = await client();
    sdk.ph!.get_property.mockImplementation((key: string) =>
      key === "$user_id" ? "user-A" : undefined,
    );
    await visit("/start");
    expect(sdk.ph!.reset).toHaveBeenCalledTimes(1);
  });

  it("starts another account fresh, then identifies it", async () => {
    const { visit } = await client();
    sdk.ph!.get_property.mockImplementation((key: string) =>
      key === "$user_id" ? "user-A" : undefined,
    );
    cookie = "sb-ref-auth-token=base64-b";
    viewer(200, { admin: false, id: "user-B" });
    await visit("/home");
    expect(sdk.ph!.reset).toHaveBeenCalledTimes(1);
    expect(sdk.ph!.identify.mock.calls).toEqual([["user-B"]]);
  });

  it("keeps an error caught before the SDK loaded and sends it once the gate opens", async () => {
    const { visit, captureError } = await client();
    const error = new Error("render failed");
    captureError(error);
    expect(sdk.ph!.captureException).not.toHaveBeenCalled();
    cookie = "sb-ref-auth-token=base64-abc";
    viewer(200, { admin: false, id: "user-1" });
    await visit("/home/renders");
    expect(sdk.ph!.captureException).toHaveBeenCalledWith(error);
  });

  it("drops a held error when the gate says no", async () => {
    const { visit, captureError } = await client();
    captureError(new Error("x"));
    cookie = "sb-ref-auth-token=base64-abc";
    viewer(200, { admin: true });
    await visit("/home");
    expect(sdk.ph!.captureException).not.toHaveBeenCalled();
  });

  it("forgets the person on sign-out", async () => {
    const { visit, resetAnalytics } = await client();
    await visit("/home/settings");
    resetAnalytics();
    expect(sdk.ph!.reset).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Where things live
// ---------------------------------------------------------------------------

describe("who someone is stays out of a recording", () => {
  it.each([
    ["the account email in the shell", "app/home/sidebar.tsx", 4],
    ["the account email in settings", "app/home/settings/page.tsx", 1],
    ["the connected account in settings", "app/home/settings/social-accounts.tsx", 5],
    [
      "the account in the schedule picker",
      "app/(posting)/schedule/[renderId]/schedule-flow.tsx",
      3,
    ],
    ["the account in the calendar", "app/(posting)/calendar/calendar-month.tsx", 2],
    ["the account and the post's link", "app/(posting)/calendar/[postId]/post-detail.tsx", 2],
    ["the expired-account notice on /home", "app/home/posting-notice.tsx", 1],
    ["the contact form and its confirmation", "app/(marketing)/contact/contact-form.tsx", 2],
    ["the feedback form and its confirmation", "app/home/feedback/feedback-form.tsx", 2],
    ["the deletion code", "app/(legal)/social/deletion/[code]/page.tsx", 1],
  ])("%s is marked", (_label, file, marks) => {
    const source = readFileSync(join(SRC, file), "utf8");
    // `data-ph-mask` itself, or ConfirmDialog's `sensitive`, which sets it.
    expect(source.match(/data-ph-mask|^\s+sensitive$/gm)?.length ?? 0).toBeGreaterThanOrEqual(
      marks,
    );
  });

  it("leaves no readable-by-default marker behind", () => {
    for (const file of sourceFiles(SRC)) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/data-ph-unmask|\breadable\b=/);
    }
  });
});

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

  it("is in the footer every public page shares", async () => {
    const { RecordingNotice } = await import("../src/components/recording-notice");
    const { SiteFooter } = await import("../src/components/landing/site-footer");
    expect(elements(SiteFooter()).some((node) => node.type === RecordingNotice)).toBe(true);
    // The landing, /about, /contact, /pricing, /privacy, /terms and /social/deletion/:code.
    for (const file of ["page.tsx", "(marketing)/layout.tsx", "(legal)/layout.tsx"]) {
      expect(readFileSync(join(SRC, "app", file), "utf8"), file).toContain("<SiteFooter />");
    }
  });

  it("is the site's smallest, faintest readable line", async () => {
    const { RecordingNotice } = await import("../src/components/recording-notice");
    const line = RecordingNotice({}) as ReactElement<{ className: string }>;
    expect(line.props.className.split(" ")).toEqual(
      expect.arrayContaining(["text-[11px]", "text-ink/45"]),
    );
  });

  it("is named in /privacy with every storage key the SDK and the gate write", () => {
    const privacy = readFileSync(join(SRC, "app", "(legal)", "privacy", "page.tsx"), "utf8");
    expect(privacy).toContain("PostHog");
    expect(privacy).toContain("ANALYTICS_OFF_KEY");
    expect(privacy).toContain("ph_");
  });
});

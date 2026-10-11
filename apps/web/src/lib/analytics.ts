import type { BeforeSendFn, CaptureResult, PostHogConfig } from "posthog-js";

/**
 * PostHog in apps/web, the policy half: what may be sent, from which pages, and
 * how every payload is scrubbed before it leaves the browser (vault 0103, 0104;
 * docs/10-analytics.md lists the named steps). Pure: a type-only posthog-js
 * import and no `window` at module load, so all of it is unit-tested in node.
 * The runtime half, which loads the SDK and calls it, is lib/analytics-client.ts.
 *
 * What never leaves (0104): anything typed, a customer's own content shown back
 * to them, their videos and images and the signed links to them, and passwords,
 * one-time codes and tokens, including those carried in an address. Change a
 * rule here and /privacy §3, §6 and §9 change in the same commit.
 */

/** PostHog's EU cloud, the only one allowed (0103). */
export const POSTHOG_EU_HOST = "https://eu.i.posthog.com";
export const POSTHOG_EU_UI_HOST = "https://eu.posthog.com";

/**
 * localStorage, set on a device once an admin account is seen signed in there.
 * Nothing loads on that device afterwards, signed in or not. Named in /privacy §9.
 */
export const ANALYTICS_OFF_KEY = "aiugc.analytics.off";

export type AnalyticsSettings = { key: string; host: string };

/**
 * Null is "analytics off": the SDK is never imported and nothing is sent, the
 * way an unset SENTRY_DSN leaves the worker silent (0037). A host other than the
 * EU cloud is refused rather than used, except a loopback one, which is the
 * local stand-in ingest the hiding check runs against (docs/10-analytics.md).
 */
export function analyticsSettings(env: { key?: string; host?: string }): AnalyticsSettings | null {
  const key = env.key?.trim();
  if (!key) return null;
  const host = env.host?.trim().replace(/\/+$/, "") || POSTHOG_EU_HOST;
  if (host !== POSTHOG_EU_HOST && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) {
    return null;
  }
  return { key, host };
}

/**
 * Where a session is recorded (0104 §2): the questionnaire, the three auth pages
 * and everything signed in. Every other page only counts the visit. Decided
 * here, not in PostHog's dashboard, so it can be read and tested.
 */
const RECORDED_PREFIXES = [
  "/start",
  "/login",
  "/forgot-password",
  "/reset-password",
  "/home",
  "/connect",
];

export function isRecordedPath(pathname: string): boolean {
  return RECORDED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

const CODE = /^[a-z0-9_-]{1,40}$/;
const CAMPAIGN = /^.{1,100}$/su;

/**
 * The only query parameters an address keeps: where the visitor came from, the
 * plan code /pricing hands to /start, and the payment outcome code. Every other
 * parameter is dropped, so a one-time code, a token_hash, a Sumit id or a
 * `next=` carrying one never leaves, whatever it is called.
 */
const KEPT_QUERY: Record<string, RegExp> = {
  utm_source: CAMPAIGN,
  utm_medium: CAMPAIGN,
  utm_campaign: CAMPAIGN,
  utm_content: CAMPAIGN,
  utm_term: CAMPAIGN,
  plan: CODE,
  checkout: CODE,
};

/** A path segment that is an id or a code (a uuid, the 32-hex deletion code) reads `:id`. */
export function sanitizePath(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) =>
      /^[0-9a-f-]{16,}$/i.test(segment) || (segment.length >= 20 && /\d/.test(segment))
        ? ":id"
        : segment,
    )
    .join("/");
}

/** Origin, the path with ids replaced, and the kept parameters. Never the fragment. */
export function sanitizeUrl(raw: string): string {
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) return sanitizePath(raw.split(/[?#]/)[0] ?? "");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "";
  const kept = new URLSearchParams();
  for (const [name, value] of url.searchParams) {
    if (KEPT_QUERY[name]?.test(value)) kept.append(name, value);
  }
  const query = kept.toString();
  return `${url.origin}${sanitizePath(url.pathname)}${query ? `?${query}` : ""}`;
}

/** Where the visitor came from is the referring site, never its full address. */
export function sanitizeReferrer(raw: string): string {
  if (raw === "$direct") return raw;
  try {
    return new URL(raw).origin;
  } catch {
    return "";
  }
}

function scrubUrlsInText(text: string): string {
  return text.replace(/https?:\/\/[^\s"'<>)\]]+/g, (url) => sanitizeUrl(url));
}

// ---------------------------------------------------------------------------
// Events: the before_send scrubber
// ---------------------------------------------------------------------------

/**
 * Click ids and the search keyword ride along as campaign properties. The ids
 * identify one ad click and the keyword is something a person typed into a
 * search engine; neither is "where they came from" in the sense kept above.
 */
const DROPPED_PROPERTY =
  /^(\$initial_|\$session_entry_)?(gclid|gclsrc|dclid|gbraid|wbraid|fbclid|msclkid|twclid|li_fat_id|igshid|ttclid|rdt_cid|epik|qclid|sccid|irclid|_kx|mc_cid|oppref|ph_keyword)$/;

type Bag = Record<string, unknown>;

function scrubProperties(bag: Bag): void {
  for (const [key, value] of Object.entries(bag)) {
    if (DROPPED_PROPERTY.test(key) || key === "$fbc") {
      delete bag[key];
    } else if (typeof value === "string") {
      if (/referrer$/i.test(key)) bag[key] = sanitizeReferrer(value);
      else if (/(url|href)$/i.test(key)) bag[key] = sanitizeUrl(value);
      else if (/pathname$/i.test(key)) bag[key] = sanitizePath(value);
    }
  }
}

/**
 * A scrubbed COPY of one of the SDK's own custom events: an address under a key
 * ending in url/href is cut down, and an address inside any other string is cut
 * out. `$recording_started` carries the raw page address as `matchedUrl` when a
 * dashboard URL trigger fires, so no field can be trusted by name. A copy,
 * because `$posthog_config` holds the SDK's live config object.
 */
function scrubPayload(value: unknown, key = ""): unknown {
  if (typeof value === "string") {
    return /(url|href)$/i.test(key) ? sanitizeUrl(value) : scrubUrlsInText(value);
  }
  if (Array.isArray(value)) return value.map((item) => scrubPayload(item, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([name, inner]) => [name, scrubPayload(inner, name)]),
    );
  }
  return value;
}

/**
 * A recording batch. The page address in each Meta event (rrweb type 4) is cut
 * down like any other, and so is every address in the SDK's own custom events
 * (type 5); plugin events (type 6: captured network requests and console lines)
 * never leave. The DOM itself arrives compressed and is hidden earlier, by the
 * masking below.
 */
function scrubSnapshot(properties: Bag): void {
  const data = properties.$snapshot_data;
  if (!Array.isArray(data)) return;
  properties.$snapshot_data = data.flatMap((event) => {
    const e = event as { type?: number; data?: { href?: unknown; payload?: unknown } };
    if (e?.type === 6) return [];
    if (e?.type === 4 && e.data && typeof e.data.href === "string") {
      return [{ ...e, data: { ...e.data, href: sanitizeUrl(e.data.href) } }];
    }
    if (e?.type === 5 && e.data) {
      return [{ ...e, data: { ...e.data, payload: scrubPayload(e.data.payload) } }];
    }
    return [event];
  });
}

/** An error's message keeps its words and loses any address in it (a signed link, say). */
function scrubException(properties: Bag): void {
  const list = properties.$exception_list;
  if (!Array.isArray(list)) return;
  for (const exception of list as Array<{
    value?: unknown;
    stacktrace?: { frames?: Array<{ filename?: unknown }> };
  }>) {
    if (typeof exception?.value === "string") exception.value = scrubUrlsInText(exception.value);
    for (const frame of exception?.stacktrace?.frames ?? []) {
      if (typeof frame.filename === "string") frame.filename = frame.filename.split(/[?#]/)[0];
    }
  }
}

/**
 * Runs on every event the SDK captures, recordings and errors included. The
 * property bags are copied first: the SDK may hand over objects it keeps.
 */
export function scrubEvent(event: CaptureResult | null): CaptureResult | null {
  if (!event) return null;
  event.properties = { ...event.properties };
  if (event.$set) event.$set = { ...event.$set };
  if (event.$set_once) event.$set_once = { ...event.$set_once };
  for (const bag of [event.properties, event.$set, event.$set_once]) {
    if (bag) scrubProperties(bag);
  }
  if (event.event === "$snapshot" && event.properties) scrubSnapshot(event.properties);
  if (event.event === "$exception" && event.properties) scrubException(event.properties);
  return event;
}

// ---------------------------------------------------------------------------
// Recordings: hidden by default
// ---------------------------------------------------------------------------

/**
 * The two markers. `data-ph-unmask` makes Tavnit's own interface inside it
 * readable in a recording; `data-ph-mask` hides everything inside it again, and
 * wins wherever the two meet. Text nobody marked comes out as asterisks (one per
 * character, spaces kept, so the replay keeps its layout), and a form field never
 * comes out readable, marked or not: its value is a fixed run of asterisks.
 */
export const UNMASK = "data-ph-unmask";
export const MASK = "data-ph-mask";

type ElementLike = { closest(selector: string): unknown };

const HIDDEN_ALWAYS = `[${MASK}], input, textarea, select, option, [contenteditable]`;

export function isReadable(element: ElementLike | null | undefined): boolean {
  if (!element) return false;
  return element.closest(`[${UNMASK}]`) !== null && element.closest(HIDDEN_ALWAYS) === null;
}

function hide(text: string): string {
  return text.replace(/\S/g, "*");
}

/** Every text node goes through here (maskTextSelector "*"). */
export function maskText(text: string, element?: ElementLike | null): string {
  return isReadable(element) ? text : hide(text);
}

const URL_ATTRIBUTES = new Set(["href", "src", "action", "formaction", "poster", "xlink:href"]);
const TEXT_ATTRIBUTES = new Set([
  "alt",
  "title",
  "placeholder",
  "value",
  "label",
  "content",
  "aria-label",
  "aria-description",
  "aria-valuetext",
  "aria-placeholder",
  "aria-roledescription",
]);

/**
 * Every attribute goes through here. Addresses lose their tokens, `srcset` goes
 * whole, inline styles lose their `url(...)`, and words — alt text, a title, a
 * placeholder, an aria-label, any `data-*` — are hidden unless readable.
 * Structure (class, role, type, svg geometry) passes, or the replay could not
 * draw the page.
 */
export function maskAttribute(name: string, value: string, element?: ElementLike | null): string {
  const attribute = name.toLowerCase();
  if (URL_ATTRIBUTES.has(attribute)) return sanitizeUrl(value);
  if (attribute === "srcset" || attribute === "imagesrcset") return "";
  if (attribute === "style") return value.replace(/url\([^)]*\)/gi, "url()");
  if (attribute.startsWith("data-ph-")) return value;
  if (TEXT_ATTRIBUTES.has(attribute) || attribute.startsWith("data-")) {
    return isReadable(element) ? value : hide(value);
  }
  return value;
}

/**
 * Replaced by a blank box of the same size, attributes and children dropped:
 * every image, video and sound (customer media, signed links, and Tavnit's own
 * alike — cheaper than telling them apart), and the two input types the
 * recorder never masks (a file input's value is the file's name).
 */
export const BLOCK_SELECTOR =
  "img, picture, video, audio, source, canvas, iframe, object, embed, input[type=file], input[type=hidden], [data-ph-block]";

/** A masked field's value: the same five asterisks whatever was typed, or nothing for an empty field. */
export function maskInput(text: string): string {
  return text ? "*****" : "";
}

/**
 * The page's address and its kept campaign parameters, read when the route is
 * reported rather than when the SDK gets round to sending: a visitor who taps
 * on before the SDK has loaded must not have the next page counted twice and
 * the landing's campaign lost.
 */
export function pageviewProperties(href: string): Record<string, string> {
  const properties: Record<string, string> = { $current_url: href };
  try {
    const url = new URL(href);
    properties.$pathname = url.pathname;
    for (const [name, value] of url.searchParams) {
      if (name.startsWith("utm_") && KEPT_QUERY[name]?.test(value)) properties[name] = value;
    }
  } catch {
    // An unparseable address keeps only $current_url, which before_send cuts down.
  }
  return properties;
}

/**
 * The SDK calls this with `{ name: url }` for the page address it writes into a
 * recording; anything else it passes is a captured network request, and those
 * never leave (null drops it).
 */
export function maskReplayRequest<T extends { name?: string }>(request: T): T | null {
  const keys = Object.keys(request);
  if (keys.length === 1 && keys[0] === "name" && typeof request.name === "string") {
    return { name: sanitizeUrl(request.name) } as T;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The SDK's options
// ---------------------------------------------------------------------------

/**
 * Every switch that matters is set here, explicitly, so PostHog's project
 * settings cannot turn it on from the dashboard (a local value wins for each of
 * these; network capture is the exception, so maskReplayRequest and the
 * snapshot scrubber drop it instead). The dashboard still has to have session
 * replay ON for any recording to start: the SDK refuses without it. Its
 * sampling, minimum duration and URL triggers decide WHICH sessions record,
 * never what goes into one.
 *
 * `allowed` is consulted on every event. While it says no, before_send drops
 * the event, recordings and errors included.
 */
export function posthogOptions(
  settings: AnalyticsSettings,
  allowed: () => boolean,
): Partial<PostHogConfig> {
  const beforeSend: BeforeSendFn = (event) => (allowed() ? scrubEvent(event) : null);
  return {
    api_host: settings.host,
    ui_host: settings.host === POSTHOG_EU_HOST ? POSTHOG_EU_UI_HOST : null,
    // localStorage only: no cookie, so nothing PostHog keeps rides along on
    // requests to our own server.
    persistence: "localStorage",
    person_profiles: "identified_only",
    // Pageviews are sent by lib/analytics-client.ts, route by route, after the gate.
    capture_pageview: false,
    capture_pageleave: false,
    // No click events: a click would carry the clicked element's text and href.
    autocapture: false,
    capture_dead_clicks: false,
    capture_heatmaps: false,
    capture_performance: false,
    capture_exceptions: {
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: false,
    },
    enable_recording_console_log: false,
    disable_session_recording: true,
    disable_surveys: true,
    // No feature flags (0103 §7). This also stops the /flags request, which
    // carries the first address seen and does not pass through before_send.
    advanced_disable_feature_flags: true,
    disable_external_dependency_loading: true,
    disable_capture_url_hashes: true,
    // What the SDK reads for targeting (a dashboard URL trigger, say) is the
    // cut-down address too.
    get_current_url: sanitizeUrl,
    mask_personal_data_properties: true,
    custom_personal_data_properties: [
      "code",
      "token",
      "token_hash",
      "type",
      "access_token",
      "refresh_token",
      "error_description",
      "next",
    ],
    save_referrer: true,
    before_send: beforeSend,
    session_recording: {
      maskAllInputs: true,
      maskInputFn: maskInput,
      maskTextSelector: "*",
      maskTextFn: maskText,
      maskAttributeFn: maskAttribute,
      maskAllElementAttributes: false,
      blockSelector: BLOCK_SELECTOR,
      recordHeaders: false,
      recordBody: false,
      maskCapturedNetworkRequestFn: maskReplayRequest,
      captureCanvas: { recordCanvas: false },
      recordCrossOriginIframes: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Named steps
// ---------------------------------------------------------------------------

const SERVICES = ["a", "b", "c"] as const;

/**
 * Every named step and what it may carry: each property is a fixed list of
 * codes or a code pattern, never free text. docs/10-analytics.md says where each
 * fires. The lists are pinned against the code's own (test/analytics.test.ts).
 */
export const STEP_EVENTS = {
  start_step_viewed: { step: ["business", "product", "benefits", "audience", "signup"] },
  account_created: { method: ["password", "google"] },
  home_first_arrival: { to: ["home", "plan"] },
  no_credits_wall: { service: SERVICES },
  plans_viewed: {},
  checkout_started: { plan: /^[a-z][a-z0-9_-]{0,39}$/ },
  payment_returned: { outcome: ["success", "refused", "failed", "unconfirmed"] },
  wizard_step_viewed: {
    service: SERVICES,
    step: [
      "persona",
      "hook",
      "hookStudio",
      "demo",
      "plan",
      "render",
      "pointers",
      "script",
      "audio",
      "effect",
      "clip",
      "studio",
    ],
  },
  render_requested: { service: SERVICES, result: ["ok", "no_credits", "refused", "error"] },
} as const satisfies Record<string, Record<string, readonly string[] | RegExp>>;

type StepRules = typeof STEP_EVENTS;
export type StepName = keyof StepRules;
export type StepProps<N extends StepName> = {
  [K in keyof StepRules[N]]: StepRules[N][K] extends readonly (infer V)[] ? V : string;
};

/**
 * A Google account that came into being in the last ten minutes. The OAuth
 * return cannot tell a new Google account from a returning one otherwise; a
 * reload of /start inside the window counts it again (docs/10-analytics.md).
 */
export function isNewGoogleAccount(
  user: { app_metadata?: { provider?: unknown }; created_at?: string },
  now = Date.now(),
): boolean {
  const created = Date.parse(user.created_at ?? "");
  return user.app_metadata?.provider === "google" && now - created < 10 * 60_000;
}

/** A render request's answer, as a code: 402 is the credits wall, 422 the content policy. */
export function renderRequestResult(
  result: { ok: true } | { ok: false; status: number },
): StepProps<"render_requested">["result"] {
  if (result.ok) return "ok";
  if (result.status === 402) return "no_credits";
  if (result.status === 422) return "refused";
  return "error";
}

/**
 * The step's properties if every one is an allowed code and none is missing or
 * extra; null otherwise, and a null step is never sent.
 */
export function stepProperties(name: string, props: object): Record<string, string> | null {
  const rules = (STEP_EVENTS as Record<string, Record<string, readonly string[] | RegExp>>)[name];
  if (!rules) return null;
  const entries = Object.entries(props);
  if (entries.length !== Object.keys(rules).length) return null;
  for (const [key, value] of entries) {
    const rule = rules[key];
    if (!rule || typeof value !== "string") return null;
    if (Array.isArray(rule) ? !rule.includes(value) : !(rule as RegExp).test(value)) return null;
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

import type { BeforeSendFn, CaptureResult, PostHogConfig } from "posthog-js";

/**
 * PostHog in apps/web, the policy half: what may be sent, and how every payload
 * is scrubbed before it leaves the browser (vault 0103, 0104, 0110;
 * docs/10-analytics.md lists the named steps). Pure: a type-only posthog-js
 * import and no `window` at module load, so all of it is unit-tested in node.
 * The runtime half, which loads the SDK and calls it, is lib/analytics-client.ts.
 *
 * Every page records (0110). What never leaves: passwords, one-time codes and
 * tokens, including those carried in an address; email addresses and the other
 * marks of who someone is; and media whose link would not play in a replay.
 * Change a rule here and /privacy §3 and §6 change in the same commit.
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
// Recordings: shown as on screen, the sensitive hidden
// ---------------------------------------------------------------------------

/**
 * The marker. `data-ph-mask` hides everything inside it: its text, its fields,
 * the words and links in its attributes, and its images (blank boxes). It goes
 * on whatever shows who someone is — an email, a connected account's name and
 * picture — and on a whole form that carries such things (vault 0110). The
 * rest of a recording is the page as it was on screen: Tavnit's interface, and
 * the business content a customer types and is shown back.
 */
export const MASK = "data-ph-mask";

/**
 * Hidden wherever they are, marked or not: password, email and phone fields, a
 * password field the page has switched to plain text (rrweb marks it), and any
 * field the browser is told holds a username, an email, a phone number, a
 * password or a one-time code.
 */
const SENSITIVE = [
  `[${MASK}]`,
  "input[type=password]",
  "input[type=email]",
  "input[type=tel]",
  "[data-rr-is-password]",
  ...["username", "email", "tel", "current-password", "new-password", "one-time-code"].map(
    (hint) => `[autocomplete~="${hint}"]`,
  ),
].join(", ");

type ElementLike = { closest(selector: string): unknown };

/** Whether an element is or sits inside something sensitive. With no element, nothing says it is not. */
export function isHidden(element: ElementLike | null | undefined): boolean {
  return !element || element.closest(SENSITIVE) !== null;
}

/**
 * An email address shown anywhere else (typed into an answer, say) is hidden
 * like an email field: from the first character before its "@" to the end of
 * the word, so one being typed is hidden from the moment its "@" is. What was
 * typed before the "@" has already been recorded by then (posthog-js records
 * every keystroke). A word that starts with "@", a handle, shows. Bounded, so a
 * long string cannot make it slow.
 */
const EMAIL = /[^\s@<>()[\]"',;:]{1,64}@[^\s@<>()[\]"',;:]{0,255}/g;

function hide(text: string): string {
  return text.replace(/\S/g, "*");
}

/** Shown text and typed values: an email hidden, and an address cut down like any other. */
function shown(text: string): string {
  return scrubUrlsInText(text).replace(EMAIL, hide);
}

/**
 * Every text node goes through here (maskTextSelector "*"): hidden text keeps
 * one asterisk per character and its spaces, so the replay keeps its layout.
 */
export function maskText(text: string, element?: ElementLike | null): string {
  return isHidden(element) ? hide(text) : shown(text);
}

/**
 * Every field's value. A hidden field's is the same five asterisks whatever was
 * typed, or nothing for an empty one, so not even its length leaves.
 */
export function maskInput(text: string, element?: ElementLike | null): string {
  if (isHidden(element)) return text ? "*****" : "";
  return shown(text);
}

const LOOPBACK = /^(localhost|127\.0\.0\.1)$/;

/**
 * Whether a media link plays in a replay watched the next day (vault 0110). A
 * replay carries the link, not the pixels, and the viewer's browser fetches it
 * then. A link with no query does: Tavnit's own files, the public catalogue
 * bucket, the landing's stand-in stills; and so does Next's image optimiser
 * serving one. A signed link does not: its token rides in the query, and it
 * dies an hour after it was made. Nor does a blob: or data: address (the first
 * lives only in the visitor's tab, the second is the pixels), or an /api/ route.
 */
export function isPlayableMedia(raw: string, base: string): boolean {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return false;
  }
  const web =
    url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.test(url.hostname));
  if (!web || url.username || url.password || url.hash || url.pathname.startsWith("/api/")) {
    return false;
  }
  if (url.pathname === "/_next/image") {
    const inner = url.searchParams.get("url");
    const known = [...url.searchParams.keys()].every((key) => ["url", "w", "q"].includes(key));
    return known && inner !== null && isPlayableMedia(inner, url.href);
  }
  return url.search === "";
}

function pageAddress(): string | undefined {
  return (globalThis as { location?: { href?: string } }).location?.href;
}

/**
 * A playable link stays whole, made absolute (rrweb records `poster` as the page
 * wrote it, and the replay is not on our origin); any other is cut down like an
 * address, and inside a hidden container it goes entirely.
 */
function maskMediaLink(value: string, hidden: boolean): string {
  if (hidden) return "";
  const base = pageAddress();
  if (base && isPlayableMedia(value, base)) return new URL(value, base).href;
  return sanitizeUrl(value);
}

/** A srcset stays only if every candidate in it plays. */
function maskSrcset(value: string, hidden: boolean): string {
  const base = pageAddress();
  if (hidden || !base) return "";
  const links = value.split(",").map((candidate) => candidate.trim().split(/\s+/)[0] ?? "");
  return links.every((link) => link && isPlayableMedia(link, base)) ? value : "";
}

const URL_ATTRIBUTES = new Set(["href", "action", "formaction", "xlink:href"]);
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
 * Every attribute goes through here. A media link that plays stays whole and
 * any other address loses its codes; inline styles lose their `url(...)`; words
 * — alt text, a title, a placeholder, an aria-label, any `data-*` — show unless
 * hidden, an email in them excepted; and inside a hidden container every link
 * goes too. Structure (class, role, type, svg geometry, rrweb's own rr_*)
 * passes, or the replay could not draw the page.
 */
export function maskAttribute(name: string, value: string, element?: ElementLike | null): string {
  const attribute = name.toLowerCase();
  if (attribute.startsWith("data-ph-")) return value;
  const hidden = isHidden(element);
  if (attribute === "src" || attribute === "poster") return maskMediaLink(value, hidden);
  if (attribute === "srcset" || attribute === "imagesrcset") return maskSrcset(value, hidden);
  if (URL_ATTRIBUTES.has(attribute)) return hidden ? "" : sanitizeUrl(value);
  if (attribute === "style") return value.replace(/url\([^)]*\)/gi, "url()");
  if (TEXT_ATTRIBUTES.has(attribute) || attribute.startsWith("data-")) {
    return hidden ? hide(value) : shown(value);
  }
  return value;
}

/**
 * The same media rule as isPlayableMedia, in CSS, read from the attribute as the
 * page wrote it: a link with a query (a signed link's token, the Meta CDN's
 * signature) unless it is Next's image optimiser serving one without; a blob:
 * or data: address; an /api/ route. Plain compound selectors only, no :is(): a
 * browser that cannot parse one part rejects the whole list, and rrweb then
 * blocks nothing.
 */
const NOT_PLAYABLE = ["src", "poster", "srcset"].flatMap((a) => [
  `[${a}^="blob:"]`,
  `[${a}^="data:"]`,
  `[${a}^="/api/"]`,
  `[${a}*="?"]:not([${a}^="/_next/image?"])`,
  ...["%3F", "url=%2Fapi%2F", "url=blob", "url=data"].map(
    (inner) => `[${a}^="/_next/image?"][${a}*="${inner}"]`,
  ),
]);

/**
 * Replaced by a blank box of the same size, attributes and children dropped:
 * media that will not play in a replay (its link is cut down besides), every
 * image and video inside a hidden container, canvases, frames and embeds, and
 * the two input types the recorder never masks (a hidden input's value can be a
 * token, a file input's is the file's name).
 */
export const BLOCK_SELECTOR = [
  ...["img", "video", "audio", "source"].flatMap((tag) => NOT_PLAYABLE.map((rule) => tag + rule)),
  ...["img", "picture", "video", "audio"].flatMap((tag) => [`[${MASK}] ${tag}`, `${tag}[${MASK}]`]),
  "canvas",
  "iframe",
  "object",
  "embed",
  "input[type=file]",
  "input[type=hidden]",
  "[data-ph-block]",
].join(", ");

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
 * `admit` is consulted on every event. While it says no, before_send drops the
 * event, recordings and errors included (the runtime may hold a recording
 * batch and send it again later, which runs it through here again).
 */
export function posthogOptions(
  settings: AnalyticsSettings,
  admit: (event: CaptureResult) => boolean,
): Partial<PostHogConfig> {
  const beforeSend: BeforeSendFn = (event) => (event && admit(event) ? scrubEvent(event) : null);
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
  // The intro_* and continued codes are the ₪5 offer's (decision 0109): the
  // same landings, told apart from a plan's. checkout_started tells them apart
  // by its plan code, "intro".
  payment_returned: {
    outcome: [
      "success",
      "refused",
      "failed",
      "unconfirmed",
      "intro",
      "intro_refused",
      "intro_failed",
      "intro_unconfirmed",
      "continued",
    ],
  },
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

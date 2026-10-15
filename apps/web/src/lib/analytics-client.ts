import type { CaptureOptions, CaptureResult, PostHog } from "posthog-js";
import {
  ANALYTICS_OFF_KEY,
  analyticsSettings,
  pageviewProperties,
  posthogOptions,
  stepProperties,
  type StepName,
  type StepProps,
} from "@/lib/analytics";

/**
 * PostHog in apps/web, the runtime half (the policy half is lib/analytics.ts).
 * The SDK is imported here and nowhere else, lazily, and only once the gate
 * below says yes. With no key the import never happens, so nothing loads.
 * No React import: lib/auth.ts calls in here, and server pages import lib/auth.ts
 * for its constants. The hooks live in components/analytics.tsx.
 */

const settings = analyticsSettings({
  key: process.env.NEXT_PUBLIC_POSTHOG_KEY,
  host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
});

type Viewer =
  | { kind: "anonymous" }
  | { kind: "customer"; id: string }
  | { kind: "admin" }
  | { kind: "unknown" };

/**
 * The Supabase session cookie's exact name, the one supabase-js itself reads
 * (sb-<project ref>-auth-token): a leftover cookie of another project must not
 * count as a session.
 */
const SESSION_COOKIE = (() => {
  try {
    return `sb-${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname.split(".")[0]}-auth-token`;
  } catch {
    return null;
  }
})();

let posthog: PostHog | null = null;
let loading: Promise<PostHog | null> | null = null;
/** The last decision; read with decidedCookie by admit() on every event. */
let allowed = false;
/** The session cookie's value that decision was made for; null when there was none. */
let decidedCookie: string | null = null;
/** The gate has said no: nothing is queued until it says yes again. */
let refused = false;
/** Steps and errors fired before the SDK finished loading; flushed once, dropped if the gate says no. */
let pending: Array<(ph: PostHog) => void> = [];
/**
 * What the recorder flushed, and the steps and errors fired, while the session
 * cookie no longer matched the last decision: a sign-in, a sign-out, another
 * account's session written over this one, a token refresh. Neither sent nor
 * dropped, but held for the next decision, which is asked at once. A sign-in's
 * go out if the account is a customer's; the rest go out if the answer allows
 * them and the identity did not change; anything else drops them. So a
 * customer's sign-in leaves no gap in the recording, and an admin's still sends
 * nothing from the moment the cookie changes (vault 0110).
 */
let held: {
  batches: CaptureResult[];
  steps: Array<(ph: PostHog) => void>;
  signingIn: boolean;
} | null = null;
/** About twenty seconds of recording; an answer that takes longer loses the rest. */
const HELD_LIMIT = 10;
let rechecking = false;
let viewer: { cookie: string; result: Promise<Viewer> } | null = null;
let routes: Promise<void> = Promise.resolve();

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function deviceIsOff(): boolean {
  try {
    return storage()?.getItem(ANALYTICS_OFF_KEY) === "1";
  } catch {
    return false;
  }
}

function markDeviceOff(): void {
  try {
    storage()?.setItem(ANALYTICS_OFF_KEY, "1");
  } catch {
    // Private mode: the account check below still says no on every page.
  }
}

/** The session cookie's value (readable by JS — @supabase/ssr sets it without httpOnly). */
function sessionCookie(): string | null {
  if (!SESSION_COOKIE) return null;
  for (const part of document.cookie.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE || name === `${SESSION_COOKIE}.0`) return value.join("=");
  }
  return null;
}

/**
 * Whether the session is still the one the last decision was made for — the
 * same cookie value, not just a cookie — and no tab has marked this device off.
 */
function sessionUnchanged(): boolean {
  return sessionCookie() === decidedCookie && !deviceIsOff();
}

/** Keeps a batch or a step for the next answer, and asks for it now. */
function hold(batch: CaptureResult | null, step: ((ph: PostHog) => void) | null): void {
  held ??= { batches: [], steps: [], signingIn: decidedCookie === null };
  if (batch && held.batches.length < HELD_LIMIT) held.batches.push(batch);
  if (step && held.steps.length < 20) held.steps.push(step);
  recheck();
}

/**
 * Whether an event may leave right now (before_send asks, for every event): the
 * last decision said yes, AND the session is still the one it was made for. A
 * change of session breaks the second at the moment the cookie changes, and
 * from then nothing leaves until the gate has asked who it is now (an admin's
 * first seconds on /home included). A recording batch is held for that answer
 * meanwhile, and the question is asked at once rather than on the next route.
 */
function admit(event: CaptureResult): boolean {
  if (!allowed) return false;
  if (sessionUnchanged()) return true;
  hold(event.event === "$snapshot" ? event : null, null);
  return false;
}

async function fetchViewer(): Promise<Viewer> {
  try {
    const response = await fetch("/api/analytics/viewer", { cache: "no-store" });
    if (response.status === 401) return { kind: "anonymous" };
    if (!response.ok) return { kind: "unknown" };
    const body = (await response.json()) as { admin?: unknown; id?: unknown };
    if (body.admin === true) return { kind: "admin" };
    if (typeof body.id === "string") return { kind: "customer", id: body.id };
    return { kind: "unknown" };
  } catch {
    return { kind: "unknown" };
  }
}

/** Asked once per session cookie; a failed answer is asked again on the next page. */
async function currentViewer(cookie: string | null): Promise<Viewer> {
  if (!cookie) return { kind: "anonymous" };
  if (viewer?.cookie !== cookie) viewer = { cookie, result: fetchViewer() };
  const result = await viewer.result;
  if (result.kind === "unknown") viewer = null;
  return result;
}

/**
 * THE one place that decides whether capture may start for this visitor
 * (vault 0104, decision 6). Today: a key is set, this device has never shown an
 * admin account, and the visitor is not signed in as one. When we cannot tell,
 * the answer is no. Moving to accept/decline later is one more condition here.
 */
export async function captureDecision(): Promise<
  { allowed: false } | { allowed: true; userId: string | null; cookie: string | null }
> {
  if (!settings || deviceIsOff()) return { allowed: false };
  const cookie = sessionCookie();
  const who = await currentViewer(cookie);
  if (who.kind === "admin") {
    markDeviceOff();
    return { allowed: false };
  }
  if (who.kind === "unknown") return { allowed: false };
  return { allowed: true, userId: who.kind === "customer" ? who.id : null, cookie };
}

function load(): Promise<PostHog | null> {
  loading ??= import("posthog-js/full/no-external")
    .then(({ default: ph }) => {
      ph.init(settings!.key, posthogOptions(settings!, admit));
      posthog = ph;
      return ph;
    })
    .catch(() => null);
  return loading;
}

function stop(): void {
  allowed = false;
  refused = true;
  pending = [];
  held = null;
  posthog?.stopSessionRecording();
}

/**
 * Sends what was held across a session change, if the answer allows it: the
 * batches as the same request the recorder itself makes (posthog-js's
 * _captureSnapshot, pinned in test/analytics.test.ts), through before_send
 * again, then the steps.
 */
function release(ph: PostHog, userId: string | null, switched: boolean): void {
  const kept = held;
  held = null;
  if (!kept || switched || (kept.signingIn && !userId)) return;
  const options: CaptureOptions = {
    _url: ph.requestRouter.endpointFor("api", "/s/"),
    _noTruncate: true,
    _batchKey: "recordings",
    skip_client_rate_limiting: true,
  };
  for (const event of kept.batches) ph.capture("$snapshot", event.properties, options);
  for (const send of kept.steps) send(ph);
}

function flushPending(ph: PostHog): void {
  const queued = pending;
  pending = [];
  for (const send of queued) send(ph);
}

/** Asks the gate and applies the answer: the SDK, the identity, the recording, the held batches. */
async function decide(): Promise<PostHog | null> {
  let decision = await captureDecision();
  // An answer for a session that changed while it was asked is asked again.
  for (let again = 0; decision.allowed && sessionCookie() !== decision.cookie; again++) {
    decision = again < 2 ? await captureDecision() : { allowed: false };
  }
  if (!decision.allowed) {
    stop();
    return null;
  }
  allowed = true;
  refused = false;
  decidedCookie = decision.cookie;
  const ph = await load();
  if (!ph || !allowed) return null;
  // An identity left by a session that ended without signOut() (a server-side
  // sign-out, a revoked token), or by another account, is not carried over.
  const stored = ph.get_property("$user_id") as string | undefined;
  const switched = Boolean(stored && stored !== decision.userId);
  if (switched) ph.reset();
  // The user id and nothing else: no name, no email, no person properties.
  if (decision.userId && ph.get_distinct_id() !== decision.userId) ph.identify(decision.userId);
  // Every page records (vault 0110).
  ph.startSessionRecording();
  release(ph, decision.userId, switched);
  return ph;
}

async function applyRoute(href: string): Promise<void> {
  const ph = await decide();
  if (!ph) return;
  ph.capture("$pageview", pageviewProperties(href));
  flushPending(ph);
}

/** The question asked between two routes, when the session changed under the last answer. */
function recheck(): void {
  if (rechecking) return;
  rechecking = true;
  routes = routes
    .then(async () => {
      rechecking = false;
      const ph = await decide();
      if (ph) flushPending(ph);
    })
    .catch(() => {
      rechecking = false;
    });
}

/**
 * Called by <Analytics /> on every route. Serialised, so a fast click-through
 * keeps its order; the address is read now, not when the SDK gets to it. The
 * promise is only awaited by the tests.
 */
export function onRoute(): Promise<void> {
  if (!settings) return Promise.resolve();
  const href = window.location.href;
  routes = routes.then(() => applyRoute(href)).catch(() => {});
  return routes;
}

/**
 * Fire a named step. Anything but the step's own codes is refused here, before
 * the SDK sees it (lib/analytics.ts STEP_EVENTS). `beacon` is for a step fired
 * just before the page navigates away, so the browser still delivers it.
 */
export function track<N extends StepName>(
  name: N,
  props: StepProps<N>,
  options: { beacon?: boolean } = {},
): void {
  if (!settings) return;
  const clean = stepProperties(name, props);
  if (!clean) return;
  const send = (ph: PostHog) =>
    ph.capture(
      name,
      clean,
      options.beacon ? { send_instantly: true, transport: "sendBeacon" } : undefined,
    );
  queue(send);
}

/**
 * Sends now if the gate allows it; holds it while the SDK loads, or with the
 * recording while a new session is being checked; drops it once the gate has
 * said no.
 */
function queue(send: (ph: PostHog) => void): void {
  if (posthog && allowed) {
    if (sessionUnchanged()) send(posthog);
    else hold(null, send);
  } else if (!posthog && !refused && pending.length < 20) {
    pending.push(send);
  }
}

/**
 * For the error boundaries, which catch what window.onerror never sees. A
 * boundary that mounts on a fresh load runs before the SDK has loaded, so the
 * error waits in the same queue as an early step.
 */
export function captureError(error: unknown): void {
  if (!settings) return;
  queue((ph: PostHog) => ph.captureException(error));
}

/** On sign-out: the next person on this browser starts as a new anonymous visitor. */
export function resetAnalytics(): void {
  viewer = null;
  posthog?.reset();
}

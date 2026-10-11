import type { PostHog } from "posthog-js";
import {
  ANALYTICS_OFF_KEY,
  analyticsSettings,
  isRecordedPath,
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
/** The last decision; read with signedIn by canSend() on every event. */
let allowed = false;
/** Whether that decision was made with a session cookie present. */
let signedIn = false;
/** Steps fired before the SDK finished loading; flushed once, dropped if the gate says no. */
let pending: Array<(ph: PostHog) => void> = [];
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
 * Whether an event may leave right now: the last decision said yes, AND the
 * session is still the one it was made for. A sign-in or sign-out flips the
 * second at the moment the cookie changes, so nothing is sent for the new
 * person until the next route has asked who they are (an admin's first seconds
 * on /home included).
 */
function canSend(): boolean {
  return allowed && (sessionCookie() !== null) === signedIn;
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
async function currentViewer(): Promise<Viewer> {
  const cookie = sessionCookie();
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
  { allowed: false } | { allowed: true; userId: string | null; signedIn: boolean }
> {
  if (!settings || deviceIsOff()) return { allowed: false };
  const cookie = sessionCookie();
  const who = await currentViewer();
  if (who.kind === "admin") {
    markDeviceOff();
    return { allowed: false };
  }
  if (who.kind === "unknown") return { allowed: false };
  return {
    allowed: true,
    userId: who.kind === "customer" ? who.id : null,
    signedIn: cookie !== null,
  };
}

function load(): Promise<PostHog | null> {
  loading ??= import("posthog-js/full/no-external")
    .then(({ default: ph }) => {
      ph.init(settings!.key, posthogOptions(settings!, canSend));
      posthog = ph;
      return ph;
    })
    .catch(() => null);
  return loading;
}

function stop(): void {
  allowed = false;
  pending = [];
  posthog?.stopSessionRecording();
}

async function applyRoute(pathname: string, href: string): Promise<void> {
  const decision = await captureDecision();
  if (!decision.allowed) {
    stop();
    return;
  }
  allowed = true;
  signedIn = decision.signedIn;
  const ph = await load();
  if (!ph || !allowed) return;
  // An identity left by a session that ended without signOut() (a server-side
  // sign-out, a revoked token), or by another account, is not carried over.
  const stored = ph.get_property("$user_id") as string | undefined;
  if (stored && stored !== decision.userId) ph.reset();
  // The user id and nothing else: no name, no email, no person properties.
  if (decision.userId && ph.get_distinct_id() !== decision.userId) ph.identify(decision.userId);
  if (isRecordedPath(pathname)) ph.startSessionRecording();
  else ph.stopSessionRecording();
  ph.capture("$pageview", pageviewProperties(href));
  const queued = pending;
  pending = [];
  for (const send of queued) send(ph);
}

/**
 * Called by <Analytics /> on every route. Serialised, so a fast click-through
 * keeps its order; the address is read now, not when the SDK gets to it. The
 * promise is only awaited by the tests.
 */
export function onRoute(pathname: string): Promise<void> {
  if (!settings) return Promise.resolve();
  const href = window.location.href;
  routes = routes.then(() => applyRoute(pathname, href)).catch(() => {});
  return routes;
}

/**
 * Called during the commit that leaves a recorded page for a public one, so
 * the recorder is torn down before it sees the public page's DOM.
 */
export function stopRecordingIfPublic(pathname: string): void {
  if (posthog && !isRecordedPath(pathname)) posthog.stopSessionRecording();
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
  if (posthog && canSend()) send(posthog);
  else if (!posthog && pending.length < 20) pending.push(send);
}

/**
 * For the error boundaries, which catch what window.onerror never sees. A
 * boundary that mounts on a fresh load runs before the SDK has loaded, so the
 * error waits in the same queue as an early step.
 */
export function captureError(error: unknown): void {
  if (!settings) return;
  const send = (ph: PostHog) => ph.captureException(error);
  if (posthog && canSend()) send(posthog);
  else if (!posthog && pending.length < 20) pending.push(send);
}

/** On sign-out: the next person on this browser starts as a new anonymous visitor. */
export function resetAnalytics(): void {
  viewer = null;
  posthog?.reset();
}

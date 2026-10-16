/**
 * The connect flow's in-app links (decision 0101, PR 2). No imports, so the
 * client Integrations section can use them without pulling @aiugc/core into
 * the browser bundle; the server's OAuth helpers live in ./social-oauth.
 */

/** The pre-screen's link, carrying the return address and the "add another" flag along. */
export function preScreenPath(opts: { returnTo: string | null; add: boolean }): string {
  return `/connect/instagram${query(opts)}`;
}

/** The pre-screen's "המשך": the start route with the same two parameters. */
export function startPath(opts: { returnTo: string | null; add: boolean }): string {
  return `/api/social/instagram/start${query(opts)}`;
}

/**
 * TikTok's "חיבור חשבון" (decision 0115): straight to its start route — no
 * pre-screen; the card's own lead says what happens. Carries the return address.
 */
export function tiktokStartPath(opts: { returnTo: string | null }): string {
  return `/api/social/tiktok/start${query({ returnTo: opts.returnTo, add: false })}`;
}

/** The pre-screen's "ביטול": back where the customer came from. */
export function preScreenCancelPath(returnTo: string | null): string {
  return returnTo ?? "/home/settings#connections";
}

function query(opts: { returnTo: string | null; add: boolean }): string {
  const params = new URLSearchParams();
  if (opts.returnTo) params.set("return", opts.returnTo);
  if (opts.add) params.set("add", "1");
  const value = params.toString();
  return value ? `?${value}` : "";
}

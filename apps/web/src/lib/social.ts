import { cache } from "react";
import type { NextResponse } from "next/server";
import { getDb, getPostingAccess } from "@aiugc/core";
import { jsonError, NOT_FOUND, requireUser } from "@/lib/api";

/**
 * Server-only. The switch (app_config.social_posting, decisions 0101 and
 * 0102) as the web reads it: an account the switch does not allow sees no
 * trace of social posting — no section, no page, a 404 on every route.
 *
 * cache(): the settings page and anything it renders ask once per request.
 */
export const postingAllowed = cache(
  async (userId: string): Promise<boolean> =>
    (await getPostingAccess(getDb(), userId)) === "allowed",
);

/**
 * The gate for every social route but Meta's own deletion callback. A hidden
 * account AND a signed-out visitor both get the same 404 a missing resource
 * gets — a 401 would tell a signed-out prober that the route exists. A failed
 * auth read stays a 503 (requireUser's reason: it is not an absent session).
 */
export async function requirePostingUser(): Promise<
  { userId: string } | { response: NextResponse }
> {
  const auth = await requireUser();
  if ("response" in auth) {
    return auth.response.status === 401 ? { response: jsonError(404, NOT_FOUND) } : auth;
  }
  if (!(await postingAllowed(auth.userId))) return { response: jsonError(404, NOT_FOUND) };
  return auth;
}

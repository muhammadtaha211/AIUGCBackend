import { cache } from "react";
import type { NextResponse } from "next/server";
import { z } from "zod";
import { getAutopilotAccess, getDb } from "@aiugc/core";
import { jsonError, NOT_FOUND, requireUser } from "@/lib/api";
import { soundSnapshotSchema } from "@/lib/social-posting";

/**
 * Server-only. The Instagram autopilot's gate on the web (decision 0127):
 * `app_config.autopilot` (no row = admins only) and Instagram's own switch,
 * both through core's `getAutopilotAccess`. A hidden account and a signed-out
 * visitor get the same 404 a missing resource gets, like every social route.
 */
export const autopilotAllowed = cache(async (userId: string): Promise<boolean> =>
  getAutopilotAccess(getDb(), userId),
);

export async function requireAutopilotUser(): Promise<
  { userId: string } | { response: NextResponse }
> {
  const auth = await requireUser();
  if ("response" in auth) {
    return auth.response.status === 401 ? { response: jsonError(404, NOT_FOUND) } : auth;
  }
  if (!(await autopilotAllowed(auth.userId))) return { response: jsonError(404, NOT_FOUND) };
  return { userId: auth.userId };
}

const uuid = z.string().uuid();

/** The whole setup, as the page sends it. Core owns every rule; this only refuses a body that is not shaped like one. */
export const autopilotSetupBodySchema = z.object({
  /** The view's version the page was loaded from (core refuses a stale one). */
  version: z.string().min(1).max(64),
  businessId: uuid,
  sounds: z.array(soundSnapshotSchema).max(50),
  accounts: z
    .array(
      z.object({
        igUserId: z.string().min(1).max(64),
        enabled: z.boolean(),
        aPerDay: z.number().int().min(0).max(12),
        postTimes: z.array(z.string().max(5)).max(12),
        personaIds: z.array(uuid).max(20),
        demoIds: z.array(uuid).max(50),
      }),
    )
    .max(20),
});

export const autopilotResumeBodySchema = z.object({
  igUserId: z.string().min(1).max(64),
  pausedAt: z.string().datetime({ offset: true }),
});

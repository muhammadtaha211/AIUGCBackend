import { NextResponse } from "next/server";
import { getAutopilotSetup, getDb, resumeAutopilotAccount } from "@aiugc/core";
import { coreErrorResponse, INVALID_BODY, jsonError } from "@/lib/api";
import { autopilotResumeBodySchema, requireAutopilotUser } from "@/lib/autopilot";

/**
 * POST /api/autopilot/resume — "החזרה לפעולה" on a paused account's card
 * (decision 0127: every pause resumes by hand). It names the pause it lifts; a
 * page opened before a newer pause gets a 409 and reloads.
 */
export async function POST(request: Request) {
  const auth = await requireAutopilotUser();
  if ("response" in auth) return auth.response;
  const parsed = autopilotResumeBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, INVALID_BODY);
  try {
    await resumeAutopilotAccount(
      getDb(),
      auth.userId,
      parsed.data.igUserId,
      new Date(parsed.data.pausedAt).toISOString(),
    );
    const setup = await getAutopilotSetup(getDb(), auth.userId);
    return NextResponse.json({ ok: true, setup });
  } catch (err) {
    return coreErrorResponse(err);
  }
}

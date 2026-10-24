import { NextResponse } from "next/server";
import { getAutopilotSetup, getDb, saveAutopilotSetup } from "@aiugc/core";
import { coreErrorResponse, INVALID_BODY, jsonError } from "@/lib/api";
import { autopilotSetupBodySchema, requireAutopilotUser } from "@/lib/autopilot";

/**
 * GET /api/autopilot?businessId= — the setup page's state (decision 0127): the
 * account's Instagram accounts and their cards, the characters with their
 * clip counts, the business's demos (named first), the saved sounds. A
 * businessId of another of his businesses previews its demos.
 */
export async function GET(request: Request) {
  const auth = await requireAutopilotUser();
  if ("response" in auth) return auth.response;
  const businessId = new URL(request.url).searchParams.get("businessId") ?? undefined;
  try {
    const setup = await getAutopilotSetup(getDb(), auth.userId, { businessId });
    return NextResponse.json({ ok: true, setup });
  } catch (err) {
    return coreErrorResponse(err);
  }
}

/**
 * PUT /api/autopilot — save the whole setup. Core refuses what breaks a rule
 * (each with its line) and keeps what the night owns: a pause, a sound Meta
 * refused. Answers the fresh state.
 */
export async function PUT(request: Request) {
  const auth = await requireAutopilotUser();
  if ("response" in auth) return auth.response;
  const parsed = autopilotSetupBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, INVALID_BODY);
  try {
    await saveAutopilotSetup(getDb(), auth.userId, parsed.data);
    const setup = await getAutopilotSetup(getDb(), auth.userId);
    return NextResponse.json({ ok: true, setup });
  } catch (err) {
    return coreErrorResponse(err);
  }
}

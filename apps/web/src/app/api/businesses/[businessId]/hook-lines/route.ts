import { NextResponse } from "next/server";
import { generateHookLines, getDb } from "@aiugc/core";
import { coreErrorResponse, requireBusiness, requireUser } from "@/lib/api";

/** Options per generation — enough for a real pick without burning tokens. */
const HOOK_LINE_OPTIONS = 5;

/**
 * Generate hook-line options from the questionnaire (Service A). Synchronous —
 * one LLM call — and the customer picks one of the returned options.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ businessId: string }> },
) {
  const { businessId } = await params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const db = getDb();
    const owned = await requireBusiness(db, businessId, auth.userId);
    if ("response" in owned) return owned.response;

    const rows = await generateHookLines(db, { businessId, n: HOOK_LINE_OPTIONS });
    return NextResponse.json({
      options: rows.map((row) => ({
        scriptId: row.id,
        text: row.text,
        angle: (row.params as { angle?: string }).angle ?? "",
      })),
    });
  } catch (err) {
    return coreErrorResponse(err);
  }
}

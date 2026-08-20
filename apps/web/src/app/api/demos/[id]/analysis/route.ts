import { NextResponse } from "next/server";
import { analysisTimelineSchema, getDb, getStorage } from "@aiugc/core";
import {
  coreErrorResponse,
  INVALID_BODY,
  jsonError,
  requireAnalysis,
  requireUser,
  SIGNED_URL_TTL_SECONDS,
} from "@/lib/api";
import { parseAnalysisIndexes } from "@/lib/service-a";
import { ANALYSIS_PAGE_SIZE } from "@/lib/service-a-ui";

/**
 * Poll the demo's newest analysis: status while it runs, the Hebrew failReason
 * when rejected/failed, the state inventory when ready. Thumb signing follows
 * the demos-GET precedent — it is the expensive part at 40-80 states:
 * - no query: every state's metadata, NO thumb URLs (cheap status/shape poll).
 * - `?page=N` (1-based): that page's states WITH signed thumbs, plus total.
 * - `?indexes=3,17,29`: exactly those states WITH signed thumbs — the plan
 *   surface's per-step lookup (a plan's 5-8 sourceIndexes span pages). Capped
 *   at ANALYSIS_PAGE_SIZE and 400s on any out-of-range or malformed index.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const db = getDb();
    const found = await requireAnalysis(db, id, auth.userId);
    if ("response" in found) return found.response;
    const { analysis } = found;

    const body: {
      analysisId: string;
      status: string;
      failReason?: string;
      stateCount?: number;
      states?: unknown[];
      total?: number;
    } = { analysisId: analysis.id, status: analysis.status };
    if (analysis.failReason) body.failReason = analysis.failReason;
    if (!analysis.timeline) return NextResponse.json(body);

    // rejected rows keep their timeline for founder debugging — the customer
    // response carries states only when the analysis is usable.
    if (analysis.status !== "ready") return NextResponse.json(body);

    const timeline = analysisTimelineSchema.parse(analysis.timeline);
    body.stateCount = timeline.length;
    body.total = timeline.length;

    // `index` is the absolute timeline position — it IS the sourceIndex the
    // plan routes speak — and survives paging. thumbPath stays server-side.
    const states = timeline.map((state, index) => ({
      index,
      timestampMs: state.timestampMs,
      screenName: state.screenName,
      visibleText: state.visibleText,
      action: state.action,
      actionType: state.actionType,
      screenKind: state.screenKind,
      sameStateAsPrevious: state.sameStateAsPrevious,
      legibility: state.legibility,
      salienceNote: state.salienceNote ?? undefined,
    }));

    const query = new URL(request.url).searchParams;

    const rawIndexes = query.get("indexes");
    if (rawIndexes !== null) {
      const indexes = parseAnalysisIndexes(rawIndexes, timeline.length);
      if (indexes === null) return jsonError(400, INVALID_BODY);
      const storage = getStorage();
      body.states = await Promise.all(
        indexes.map(async (index) => ({
          ...states[index]!,
          thumbUrl: await storage.signedUrl(timeline[index]!.thumbPath, SIGNED_URL_TTL_SECONDS),
        })),
      );
      return NextResponse.json(body);
    }

    const page = Number(query.get("page"));
    if (!Number.isInteger(page) || page < 1) {
      body.states = states;
      return NextResponse.json(body);
    }

    const storage = getStorage();
    const pageStates = states.slice((page - 1) * ANALYSIS_PAGE_SIZE, page * ANALYSIS_PAGE_SIZE);
    body.states = await Promise.all(
      pageStates.map(async (state) => ({
        ...state,
        thumbUrl: await storage.signedUrl(timeline[state.index]!.thumbPath, SIGNED_URL_TTL_SECONDS),
      })),
    );
    return NextResponse.json(body);
  } catch (err) {
    return coreErrorResponse(err);
  }
}

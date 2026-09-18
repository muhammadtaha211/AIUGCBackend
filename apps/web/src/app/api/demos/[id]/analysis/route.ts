import { NextResponse } from "next/server";
import {
  analysisSectionsSchema,
  analysisTimelineSchema,
  getDb,
  getJobProgress,
  getLatestDemoAnalysis,
  getStorage,
  HEAVY_JOB_TYPES,
  type JobProgress,
} from "@aiugc/core";
import {
  coreErrorResponse,
  INVALID_BODY,
  jsonError,
  requireDemo,
  requireUser,
  SIGNED_URL_TTL_SECONDS,
} from "@/lib/api";
import { parseAnalysisIndexes } from "@/lib/service-a";
import { ANALYSIS_PAGE_SIZE, isAnalysisWorkingStatus } from "@/lib/service-a-ui";

/**
 * Poll the demo's newest analysis: status while it runs, the Hebrew failReason
 * when rejected/failed, the state inventory when ready. Thumb signing follows
 * the demos-GET precedent — it is the expensive part at 40-80 states:
 * - no query: every state's metadata, NO thumb URLs (cheap status/shape poll).
 * - `?page=N` (1-based): that page's states WITH signed thumbs, plus total.
 * - `?indexes=3,17,29`: exactly those states WITH signed thumbs — the plan
 *   surface's per-step lookup (a plan's 5-8 sourceIndexes span pages). Capped
 *   at ANALYSIS_PAGE_SIZE and 400s on any out-of-range or malformed index.
 *
 * No analysis row is a NORMAL state, not a 404 (8d): the row appears only when
 * the analyze job starts, so the whole heavy-lane queue wait used to be
 * indistinguishable from a dead pipeline. It now answers 200 with
 * `status:"missing"` plus the analyze job's progress; a working row carries
 * the same `job` payload. 404 remains for a missing/unowned DEMO only.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const db = getDb();
    const found = await requireDemo(db, id, auth.userId);
    if ("response" in found) return found.response;
    const analysis = await getLatestDemoAnalysis(db, id);

    // newestMatching: founder re-runs enqueue as analyze:{id}:rN — pinning the
    // bare key would report the first attempt's corpse while the retry runs.
    const analysisJob = (): Promise<JobProgress> =>
      getJobProgress(db, {
        idempotencyKey: `analyze:${id}`,
        aheadOfTypes: HEAVY_JOB_TYPES,
        newestMatching: true,
      });

    if (!analysis) {
      return NextResponse.json({ status: "missing", job: await analysisJob() });
    }

    const body: {
      analysisId: string;
      status: string;
      failReason?: string;
      job?: JobProgress;
      /** demo_analyses.created_at, ISO — the wall-clock anchor
       *  analysisWaitView uses for "רץ כבר X" instead of the job's own
       *  elapsedMs, which resets on every retry re-claim. Sent alongside
       *  `job`, the only condition under which the client shows it. */
      requestedAt?: string;
      stateCount?: number;
      states?: unknown[];
      total?: number;
      /** Task-level Hebrew groupings (0030). Absent = ungrouped (older
       *  analyses, failed/refused grouping) — the picker renders flat. */
      sections?: { title: string; stateIndexes: number[] }[];
    } = { analysisId: analysis.id, status: analysis.status };
    if (analysis.failReason) body.failReason = analysis.failReason;
    if (isAnalysisWorkingStatus(analysis.status)) {
      body.job = await analysisJob();
      body.requestedAt = analysis.createdAt.toISOString();
    }
    if (!analysis.timeline) return NextResponse.json(body);

    // rejected rows keep their timeline for founder debugging — the customer
    // response carries states only when the analysis is usable.
    if (analysis.status !== "ready") return NextResponse.json(body);

    const timeline = analysisTimelineSchema.parse(analysis.timeline);
    body.stateCount = timeline.length;
    body.total = timeline.length;

    // Malformed/legacy sections are simply omitted — the flat-grid fallback,
    // never an error.
    const sections = analysisSectionsSchema.safeParse(analysis.sections);
    if (sections.success && sections.data.length > 0) body.sections = sections.data;

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

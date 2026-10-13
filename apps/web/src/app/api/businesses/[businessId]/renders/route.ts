import { NextResponse } from "next/server";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import {
  businessOwnerId,
  createBRender,
  creditBalance,
  getDb,
  getJobProgress,
  getStorage,
  HEAVY_JOB_TYPES,
  isAdminOwned,
  pendingPostsByRender,
  schema,
} from "@aiugc/core";
import {
  coreErrorResponse,
  INVALID_BODY,
  jsonError,
  requireBusiness,
  requireUser,
  SIGNED_URL_TTL_SECONDS,
} from "@/lib/api";
import {
  renderRequestSchema,
  renderSourceError,
  type BRenderCreateResponse,
} from "@/lib/service-b";
import {
  hookTextFieldError,
  pickActiveHead,
  RENDER_PAGE_SIZE,
  rendersPageParam,
} from "@/lib/service-b-ui";
import { postingAllowed } from "@/lib/social";

/**
 * Create a Service B render. Core enforces the approved-audio gate and the
 * hook-animation/hook-text pairing; the route verifies the referenced rows
 * belong to this business, holds the card's image to the format (this
 * persona's selfie, stored, not retired — createBRender takes an explicit id
 * on trust), and enqueues with the chosen animation and the FINAL hook text
 * copied into params (vault 0017, 0023).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ businessId: string }> },
) {
  const { businessId } = await params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const db = getDb();
    const owned = await requireBusiness(db, businessId, auth.userId);
    if ("response" in owned) return owned.response;

    const body = renderRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);
    const { scriptId, audioId, personaId, personaImageId, hookEffect, hookText } = body.data;

    const scriptRows = await db
      .select()
      .from(schema.scripts)
      .where(eq(schema.scripts.id, scriptId))
      .limit(1);
    if (!scriptRows[0]) return jsonError(404, "התסריט לא נמצא.");
    if (scriptRows[0].businessId !== businessId) {
      return jsonError(403, "התסריט לא שייך לעסק הזה.");
    }

    const audioRows = await db
      .select()
      .from(schema.audioRenders)
      .where(eq(schema.audioRenders.id, audioId))
      .limit(1);
    if (!audioRows[0]) return jsonError(404, "האודיו לא נמצא.");
    if (audioRows[0].scriptId !== scriptId) {
      return jsonError(400, "האודיו לא שייך לתסריט הזה.");
    }

    const imageRows = await db
      .select({
        personaId: schema.personaImages.personaId,
        kind: schema.personaImages.kind,
        filePath: schema.personaImages.filePath,
        retired: schema.personaImages.retired,
      })
      .from(schema.personaImages)
      .where(eq(schema.personaImages.id, personaImageId))
      .limit(1);
    const sourceProblem = renderSourceError(imageRows[0], personaId);
    if (sourceProblem) return jsonError(sourceProblem.status, sourceProblem.error);

    // The same rule core refuses on at enqueue, answered in Hebrew here —
    // core's English message has no pattern in coreErrorMapping and would
    // reach the customer as a generic 500.
    if (hookText !== undefined) {
      const textProblem = hookTextFieldError(hookText);
      if (textProblem) return jsonError(400, textProblem);
    }

    const render = await createBRender(db, {
      businessId,
      audioRenderId: audioId,
      personaId,
      personaImageId,
      hookEffect,
      hookText,
      hookTextSafeArea: body.data.hookTextSafeArea,
    });
    // The post-debit balance, re-queried after the commit — the wizard pushes
    // it into the sidebar's BalanceProvider, mirroring the A steps route.
    const balance = (await isAdminOwned(db, businessId))
      ? null
      : await creditBalance(db, await businessOwnerId(db, businessId));
    return NextResponse.json({ renderId: render.id, balance } satisfies BRenderCreateResponse);
  } catch (err) {
    return coreErrorResponse(err);
  }
}

/**
 * Progress for the one render the dashboard describes.
 *
 * A render has two possible live jobs and only one of them exists at a time: a
 * Service B render (and a Service A avatar outro) spends its whole first phase
 * under `lipsync:<id>`, and `render:<id>` is not enqueued until that finishes.
 * Asking only for `render:<id>` gets state:"missing" for that whole phase,
 * which the wait view cannot tell apart from a purged job — so the indicator
 * would animate straight through a parked lipsync. The second lookup only
 * happens when the first came back empty.
 */
async function headProgress(db: ReturnType<typeof getDb>, renderId: string) {
  const render = await getJobProgress(db, {
    idempotencyKey: `render:${renderId}`,
    aheadOfTypes: HEAVY_JOB_TYPES,
  });
  if (render.state !== "missing") return render;
  return getJobProgress(db, {
    idempotencyKey: `lipsync:${renderId}`,
    aheadOfTypes: HEAVY_JOB_TYPES,
  });
}

/**
 * This business's renders, newest first, in two shapes. Rejected rows stay
 * internal (a regenerated render replaces them) in both, and thumbnails are
 * signed only after release — the customer never sees Service B output before
 * the QC gate.
 *
 * - no `?page=`: the homepage strip — newest 20, plus job progress for the one
 *   render its "generating now" indicator describes.
 * - `?page=N` (1-based): the /home/renders library — RENDER_PAGE_SIZE per page
 *   plus the unpaged total for the pager, and NO job progress: a library lists
 *   finished work, it is not a live indicator, and progress is the expensive
 *   part of this route.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ businessId: string }> },
) {
  const { businessId } = await params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const db = getDb();
    const owned = await requireBusiness(db, businessId, auth.userId);
    if ("response" in owned) return owned.response;

    const { videoRenders } = schema;
    // One predicate for the slice AND the count, so page N+1 exists exactly
    // when the pager says it does.
    const visible = and(
      eq(videoRenders.businessId, businessId),
      ne(videoRenders.status, "rejected"),
    );
    const page = rendersPageParam(new URL(request.url).searchParams.get("page"));

    const rows = await db
      .select({
        id: videoRenders.id,
        service: videoRenders.service,
        status: videoRenders.status,
        createdAt: videoRenders.createdAt,
        thumbPath: videoRenders.thumbPath,
        refundedAt: videoRenders.refundedAt,
      })
      .from(videoRenders)
      .where(visible)
      // PAGED ONLY, and the id is the point: createSet inserts a whole grid
      // inside ONE transaction (pipelines/sets.ts) and now() is the transaction
      // timestamp, so every render of a grid shares created_at to the
      // microsecond. created_at alone is not a total order, and a tie group
      // straddling a page boundary lets LIMIT/OFFSET repeat one row on page 2
      // and drop another entirely. The strip takes ONE slice with no offset, so
      // it cannot lose or repeat anything and does not need the tiebreaker —
      // and adding it there would reorder tied rows (and so which one
      // pickActiveHead calls the head) on a surface that must not change.
      .orderBy(desc(videoRenders.createdAt), ...(page === null ? [] : [desc(videoRenders.id)]))
      .limit(page === null ? 20 : RENDER_PAGE_SIZE)
      .offset(page === null ? 0 : (page - 1) * RENDER_PAGE_SIZE);

    // The dashboard's "generating now" indicator needs progress for exactly
    // one render, so only the head row pays for it: getJobProgress is 3-4
    // queries, and every other active row is merely queued behind this one.
    const head = page === null ? pickActiveHead(rows) : undefined;

    // The grey "מתוזמן" tag (social posting PR 3): one IN query, only for an
    // account the switch allows (the key is absent for everyone else), and
    // only when a row is released. Started beside the signing below, and
    // best-effort: a failed read drops the tag, never the list.
    const released = rows.filter((row) => row.status === "released").map((row) => row.id);
    const pendingRead =
      released.length === 0
        ? Promise.resolve(null)
        : postingAllowed(auth.userId)
            .then((allowed) => (allowed ? pendingPostsByRender(db, released) : null))
            .catch(() => null);

    // Concurrent, like the sibling demos route: signing is a network call per
    // released row, and a full page of 24 in series is the whole latency of
    // this screen. Promise.all resolves in input order, so the body is
    // byte-identical to the serial loop this replaced — including the single
    // head `job`, which only one row asks for either way.
    const storage = getStorage();
    const pending = await pendingRead;
    const renders = await Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        service: row.service,
        status: row.status,
        createdAt: row.createdAt,
        thumbUrl:
          row.status === "released" && row.thumbPath
            ? await storage.signedUrl(row.thumbPath, SIGNED_URL_TTL_SECONDS)
            : undefined,
        // Same contract as GET /api/renders/[id]: true only when the refund
        // really landed (refunded_at set in the refund transaction).
        refunded: row.status === "failed" ? row.refundedAt !== null : undefined,
        job: row.id === head?.id ? await headProgress(db, row.id) : undefined,
        scheduled: pending ? (pending.get(row.id) ?? 0) > 0 : undefined,
      })),
    );
    if (page === null) return NextResponse.json({ renders });

    const [counted] = await db
      .select({ n: sql<string>`count(*)` })
      .from(videoRenders)
      .where(visible);
    return NextResponse.json({ renders, total: Number(counted?.n ?? 0) });
  } catch (err) {
    return coreErrorResponse(err);
  }
}

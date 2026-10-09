import { z } from "zod";
import { textSafeAreaSchema } from "@aiugc/core/hook-geometry";

/**
 * Pure parts of the Service C (גוש טקסט) HTTP layer, decision 0099: the
 * request bodies and response shapes of the customer wizard's routes. Route
 * handlers (src/app/api) wire these to auth + DB; the wizard's own helpers and
 * copy live in service-c-ui.ts. No server imports, like service-b.ts.
 */

/** POST /api/businesses/[businessId]/text-blocks/next — the clip whose speaker the text is for. */
export const textBlockNextRequestSchema = z.object({ clipId: z.string().uuid() });

/**
 * POST /api/businesses/[businessId]/text-blocks/renders. The rect is required:
 * the wizard seeds its editor from the clip's own area, so it always has one to
 * send, and the one it sends is the one that burns.
 */
export const textBlockRenderRequestSchema = z.object({
  clipId: z.string().uuid(),
  scriptId: z.string().uuid(),
  textSafeArea: textSafeAreaSchema,
});

/** The next stored text, its scripts row and the skeleton it was written to. */
export type TextBlockNextResponse = { scriptId: string; text: string; skeleton: string };

/** The render-create response; `balance` as in BRenderCreateResponse (null = admin bypass). */
export type TextBlockRenderCreateResponse = { renderId: string; balance: number | null };

import { questionnaireSchema } from "@aiugc/core";
import { z } from "zod";
import { MAX_BUSINESS_NAME_CHARS } from "./onboarding";

/**
 * The /home/settings write path, pure and testable (no `@/` imports — the
 * same split as api-errors.ts). Server-only: it pulls the core schema in.
 */

/** The onboarding route's INVALID_MESSAGE, reworded for a flat form with no "previous screens". */
export const INVALID_QUESTIONNAIRE = "חסרים פרטים בשאלון — מלאו את כל שדות החובה ונסו שוב.";

/**
 * PATCH /api/businesses/[businessId] body. demo_notes is omitted from the
 * questionnaire shape ON PURPOSE: z.object strips keys it does not know, so a
 * client that sends demo_notes (a stale copy of the stored notes, or an empty
 * array) has it dropped before the value reaches setQuestionnaire — which then
 * keeps the notes already stored. The form never edits them; the plan pass
 * writes them (addDemoNote), and a resave must not erase the customer's answers.
 */
export const businessPatchRequestSchema = z.object({
  name: z.string().trim().min(1).max(MAX_BUSINESS_NAME_CHARS).optional(),
  questionnaire: questionnaireSchema.omit({ demo_notes: true }),
});

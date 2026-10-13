import { z } from "zod";
import { CAPTION_MAX_CHARS, getStorage, type ScheduledPostListItem } from "@aiugc/core";
import { failureLine } from "@aiugc/core/social-copy";
import { SIGNED_URL_TTL_SECONDS } from "@/lib/api";

/**
 * Server-only. The schedule flow's wire (social posting PR 3): what the
 * routes accept and what a post looks like on the way to a page. Core owns
 * every rule (the horizon, the caps, who may change what); these schemas only
 * refuse a body that is not shaped like a request at all.
 */

/** A picked catalogue row, as the picker got it from our own sounds route. */
const httpsUrl = z
  .string()
  .max(2048)
  .refine((value) => value.startsWith("https://"), "https only");

export const soundSnapshotSchema = z.object({
  audioId: z.string().min(1).max(200),
  kind: z.enum(["original_sound", "music"]),
  title: z.string().max(300),
  creator: z.string().max(300).optional(),
  durationMs: z.number().int().nonnegative().optional(),
  pictureUrl: httpsUrl.optional(),
  previewUrl: httpsUrl.optional(),
});

const instant = z.string().datetime({ offset: true });

export const scheduleBodySchema = z.object({
  renderId: z.string().uuid(),
  accountIds: z.array(z.string().uuid()).min(1).max(20),
  scheduledAt: instant,
  timezone: z.string().min(1).max(64),
  caption: z.string().max(CAPTION_MAX_CHARS),
  sound: soundSnapshotSchema.nullable().optional(),
  // The customer's tick (0102 §1): absent or false = no label on Instagram.
  aiLabel: z.boolean().optional(),
});

export const editBodySchema = z
  .object({
    scheduledAt: instant.optional(),
    timezone: z.string().min(1).max(64).optional(),
    caption: z.string().max(CAPTION_MAX_CHARS).optional(),
    sound: soundSnapshotSchema.nullable().optional(),
    aiLabel: z.boolean().optional(),
  })
  .refine((body) => (body.scheduledAt === undefined) === (body.timezone === undefined), {
    message: "a time moves with its zone",
  });

/** A post as a page reads it: never the diagnostic, never the container id. */
export type PostWire = {
  id: string;
  status: string;
  scheduledAt: string;
  timezone: string;
  caption: string;
  sound: z.infer<typeof soundSnapshotSchema> | null;
  aiLabel: boolean;
  deferredUntil: string | null;
  permalink: string | null;
  /** The Hebrew line of `failure_kind` (docs/09), only on a failed post. */
  failureLine: string | null;
  account: {
    id: string;
    platform: "instagram" | "tiktok";
    username: string | null;
    displayName: string | null;
    pictureUrl: string | null;
  };
  render: { id: string; service: "a" | "b" | "c"; thumbUrl: string | null };
};

export async function toPostWire(item: ScheduledPostListItem): Promise<PostWire> {
  const { post, account, render } = item;
  return {
    id: post.id,
    status: post.status,
    scheduledAt: post.scheduledAt.toISOString(),
    timezone: post.timezone,
    caption: post.caption,
    sound: (post.sound as PostWire["sound"]) ?? null,
    aiLabel: post.aiLabel,
    deferredUntil: post.deferredUntil?.toISOString() ?? null,
    permalink: post.permalink,
    failureLine:
      post.status === "failed"
        ? failureLine(post.failureKind ?? "internal_error", account.platform)
        : null,
    account,
    render: {
      id: render.id,
      service: render.service,
      thumbUrl: render.thumbPath
        ? await getStorage().signedUrl(render.thumbPath, SIGNED_URL_TTL_SECONDS)
        : null,
    },
  };
}

import { z } from "zod";
import { getEnv } from "../config";
import { PermanentError, TransientError } from "../jobs/errors";
import { logger } from "../logger";

/**
 * HeyGen avatar lip-sync behind a swappable interface: one reference image
 * (persona image or approved product-in-hand composite) + TTS audio → talking
 * head, via `POST /v3/videos` with `type: "image"`. Image+audio is the only
 * mode — no video-to-video (locked decision). HeyGen generates to the audio's
 * length (no frame-count parameter) and bills per second of output video.
 * Polling, not webhooks: the CLI phase has no public URL and the worker polls
 * identically pre- and post-launch.
 */
export interface LipsyncSubmitInput {
  /** Reference image: persona image or approved product-in-hand composite. */
  imageUrl: string;
  audioUrl: string;
  resolution: LipsyncResolution;
  /**
   * HeyGen `motion_prompt` (native v3 name — the wrappers' `custom_motion_prompt`
   * does not exist on this endpoint): free-text gesture/motion direction.
   * Absent = the field is not sent at all.
   */
  motionPrompt?: string;
  /**
   * HeyGen `expressiveness` (Avatar IV): energy/range of movement. Absent = not
   * sent — HeyGen then defaults to "low", today's behavior.
   */
  expressiveness?: LipsyncExpressiveness;
}

export const lipsyncResolutionSchema = z.enum(["720p", "1080p"]);
export type LipsyncResolution = z.infer<typeof lipsyncResolutionSchema>;

export const lipsyncExpressivenessSchema = z.enum(["low", "medium", "high"]);
export type LipsyncExpressiveness = z.infer<typeof lipsyncExpressivenessSchema>;

/**
 * Runaway-cost guard, NOT a product limit: HeyGen renders to the audio's
 * length (up to 30 minutes) at ~$0.0667/s, so one bad input could buy half an
 * hour of GPU. `handleLipsync` fails anything longer before submitting. Never
 * surface this as a duration cap in the UI.
 */
export const MAX_LIPSYNC_SECONDS = 600;

export interface LipsyncProvider {
  submit(input: LipsyncSubmitInput): Promise<{ providerJobId: string }>;
  poll(
    providerJobId: string,
  ): Promise<
    | { status: "pending" }
    | { status: "done"; videoUrl: string }
    | { status: "failed"; reason: string }
  >;
}

const HEYGEN_VIDEOS = "https://api.heygen.com/v3/videos";

export class HeyGenLipsync implements LipsyncProvider {
  private headers(): Record<string, string> {
    const key = getEnv().HEYGEN_API_KEY;
    if (!key) throw new Error("HEYGEN_API_KEY is not set");
    return { "x-api-key": key, "content-type": "application/json" };
  }

  async submit(input: LipsyncSubmitInput): Promise<{ providerJobId: string }> {
    // `type: "image"` runs on HeyGen's default engine (the docs' engine matrix
    // supports arbitrary-image input on Avatar IV only — Avatar V is digital-
    // twin only), so no `engine` field is sent. No fps field exists in the v3
    // API: native output is 25fps, and 30/60fps would be AI interpolation,
    // which is never requested. 1080p @ 9:16 is exactly the 1080x1920 frame
    // the Remotion composition wants.
    const body = {
      type: "image",
      image: { type: "url", url: input.imageUrl },
      audio_url: input.audioUrl,
      aspect_ratio: "9:16",
      resolution: input.resolution,
      // Unset means absent — the body must stay byte-identical to the
      // no-knob submit, not carry a null.
      ...(input.motionPrompt !== undefined && { motion_prompt: input.motionPrompt }),
      ...(input.expressiveness !== undefined && { expressiveness: input.expressiveness }),
    };
    // The exact parameters, in the worker terminal, without a debugger.
    logger.info(
      {
        endpoint: HEYGEN_VIDEOS,
        body: {
          ...body,
          image: { ...body.image, url: withoutQuery(body.image.url) },
          audio_url: withoutQuery(body.audio_url),
        },
      },
      "heygen avatar submit",
    );
    const response = await this.request(HEYGEN_VIDEOS, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const json = (await response.json()) as { data: { video_id: string } };
    return { providerJobId: json.data.video_id };
  }

  async poll(providerJobId: string) {
    const response = await this.request(`${HEYGEN_VIDEOS}/${providerJobId}`, { method: "GET" });
    const { data } = (await response.json()) as {
      data: {
        status: string;
        video_url?: string;
        failure_code?: string;
        failure_message?: string;
      };
    };

    // Documented statuses: pending | processing | completed | failed. The
    // create response has also shown "waiting", so it counts as pending too.
    if (data.status === "pending" || data.status === "waiting" || data.status === "processing") {
      return { status: "pending" } as const;
    }
    if (data.status !== "completed") {
      const reason = data.failure_message ?? data.failure_code ?? `heygen status ${data.status}`;
      return { status: "failed", reason } as const;
    }
    if (!data.video_url) {
      return { status: "failed", reason: "heygen result has no video url" } as const;
    }
    return { status: "done", videoUrl: data.video_url } as const;
  }

  private async request(url: string, init: { method: string; body?: string }): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(url, { ...init, headers: this.headers() });
    } catch (err) {
      throw new TransientError(`heygen request failed: ${String(err)}`);
    }
    if (!response.ok) {
      const body = await response.text();
      const message = `heygen ${response.status}: ${body.slice(0, 500)}`;
      if (response.status >= 500 || response.status === 429) throw new TransientError(message);
      throw new PermanentError(message);
    }
    return response;
  }
}

/** Inputs are signed URLs — the path is useful in a log, the token is not. */
function withoutQuery(url: string): string {
  const q = url.indexOf("?");
  return q === -1 ? url : `${url.slice(0, q)}?<signed>`;
}

/** DRY_RUN: completes immediately with a placeholder URL. */
class DryRunLipsync implements LipsyncProvider {
  async submit(): Promise<{ providerJobId: string }> {
    return { providerJobId: `dry_${Date.now()}` };
  }
  async poll(providerJobId: string) {
    return { status: "done", videoUrl: `dryrun://lipsync/${providerJobId}.mp4` } as const;
  }
}

let override: LipsyncProvider | undefined;

/** Test hook (same shape as `setStorage`): the failure paths DRY_RUN can't reach. */
export function setLipsyncProvider(provider: LipsyncProvider | undefined): void {
  override = provider;
}

export function getLipsyncProvider(): LipsyncProvider {
  if (override) return override;
  return getEnv().DRY_RUN ? new DryRunLipsync() : new HeyGenLipsync();
}

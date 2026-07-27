import { z } from "zod";
import { getEnv } from "../config";
import { PermanentError, TransientError } from "../jobs/errors";
import { logger } from "../logger";

/**
 * InfiniteTalk lip-sync behind a swappable interface. Reference implementation
 * is the hosted fal.ai single-image endpoint (`fal-ai/infinitalk`): one
 * reference image (persona image or approved composite) + TTS audio → talking
 * head. Image+audio is the only mode — no video-to-video (locked decision).
 * Polling, not webhooks: the CLI phase has no public URL and the worker polls
 * identically pre- and post-launch.
 */
export interface LipsyncSubmitInput {
  /** Reference image: persona image or approved product-in-hand composite. */
  imageUrl: string;
  audioUrl: string;
  /** Derived from the approved audio — see `framesForAudio`. */
  numFrames: number;
  resolution: LipsyncResolution;
}

/** fal-ai/infinitalk `num_frames` bounds (live schema, verified 2026-07-25). */
export const LIPSYNC_MIN_FRAMES = 41;
export const LIPSYNC_MAX_FRAMES = 721;

export const lipsyncResolutionSchema = z.enum(["480p", "720p"]);
export type LipsyncResolution = z.infer<typeof lipsyncResolutionSchema>;

/**
 * fal renders exactly `num_frames` — it does NOT extend to the audio length.
 * Left unset it uses the schema default (145 ≈ 5.8s @25fps) and cuts the script
 * mid-sentence, which is what the first paid render did. Past the schema
 * maximum we fail loudly rather than truncate: silent truncation is the bug.
 */
export function framesForAudio(durationMs: number, fps: number): number {
  const frames = Math.round((durationMs / 1000) * fps);
  if (frames > LIPSYNC_MAX_FRAMES) {
    const maxSeconds = Math.floor(LIPSYNC_MAX_FRAMES / fps);
    throw new PermanentError(
      `הסקריפט ארוך מדי לסרטון אחד: אורך האודיו ${(durationMs / 1000).toFixed(1)} שניות, ` +
        `והמקסימום הוא ${maxSeconds} שניות. קצרו את הסקריפט ונסו שוב.`,
    );
  }
  return Math.max(frames, LIPSYNC_MIN_FRAMES);
}

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

const FAL_BASE = "https://queue.fal.run/fal-ai/infinitalk";

/** The endpoint requires a text prompt; ours is fixed. */
const IMAGE_MODE_PROMPT =
  "A person talks to the camera naturally, subtle head movement, UGC selfie style.";

class FalLipsync implements LipsyncProvider {
  private headers(): Record<string, string> {
    const key = getEnv().FAL_KEY;
    if (!key) throw new Error("FAL_KEY is not set");
    return { Authorization: `Key ${key}`, "content-type": "application/json" };
  }

  async submit(input: LipsyncSubmitInput): Promise<{ providerJobId: string }> {
    const body = {
      image_url: input.imageUrl,
      audio_url: input.audioUrl,
      prompt: IMAGE_MODE_PROMPT,
      num_frames: input.numFrames,
      resolution: input.resolution,
    };
    // The exact parameters, in the worker terminal, without a debugger.
    logger.info(
      {
        endpoint: FAL_BASE,
        body: {
          ...body,
          image_url: withoutQuery(body.image_url),
          audio_url: withoutQuery(body.audio_url),
        },
      },
      "fal infinitalk submit",
    );
    const response = await this.request(FAL_BASE, { method: "POST", body: JSON.stringify(body) });
    const json = (await response.json()) as { request_id: string };
    return { providerJobId: json.request_id };
  }

  async poll(providerJobId: string) {
    const statusResponse = await this.request(`${FAL_BASE}/requests/${providerJobId}/status`, {
      method: "GET",
    });
    const status = (await statusResponse.json()) as { status: string; error?: unknown };

    if (status.status === "IN_QUEUE" || status.status === "IN_PROGRESS") {
      return { status: "pending" } as const;
    }
    if (status.status !== "COMPLETED") {
      return { status: "failed", reason: `fal status ${status.status}` } as const;
    }

    const resultResponse = await this.request(`${FAL_BASE}/requests/${providerJobId}`, {
      method: "GET",
    });
    const result = (await resultResponse.json()) as { video?: { url?: string } };
    if (!result.video?.url) {
      return { status: "failed", reason: "fal result has no video url" } as const;
    }
    return { status: "done", videoUrl: result.video.url } as const;
  }

  private async request(url: string, init: { method: string; body?: string }): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(url, { ...init, headers: this.headers() });
    } catch (err) {
      throw new TransientError(`fal request failed: ${String(err)}`);
    }
    if (!response.ok) {
      const body = await response.text();
      const message = `fal ${response.status}: ${body.slice(0, 500)}`;
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

export function getLipsyncProvider(): LipsyncProvider {
  return getEnv().DRY_RUN ? new DryRunLipsync() : new FalLipsync();
}

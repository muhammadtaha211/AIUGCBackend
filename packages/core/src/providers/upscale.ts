import { getEnv } from "../config";
import { PermanentError, TransientError } from "../jobs/errors";
import { logger } from "../logger";

/**
 * Topaz Starlight video upscale behind a swappable interface. Reference
 * implementation is the hosted fal.ai queue endpoint
 * (`fal-ai/topaz/upscale/video`): the InfiniteTalk plate goes in at its native
 * width and comes back at ~1080 wide, so Remotion composes a sharp talking head
 * instead of an upscaled-by-the-browser one. Polling, not webhooks — same shape
 * as lipsync and imagegen.
 */
export interface UpscaleSubmitInput {
  /** Signed URL of the stored 480p plate — fal fetches the input itself. */
  videoUrl: string;
  /** Computed per clip from the plate's dimensions — see `upscaleFactorFor`. */
  upscaleFactor: number;
}

export interface UpscaleProvider {
  submit(input: UpscaleSubmitInput): Promise<{ providerJobId: string }>;
  poll(
    providerJobId: string,
  ): Promise<
    | { status: "pending" }
    | { status: "done"; videoUrl: string }
    | { status: "failed"; reason: string }
  >;
}

/** Status/result URLs drop the sub-path (fal convention — same as nano-banana/edit). */
const FAL_BASE = "https://queue.fal.run/fal-ai/topaz";
const FAL_ENDPOINT = `${FAL_BASE}/upscale/video`;

class FalUpscale implements UpscaleProvider {
  private headers(): Record<string, string> {
    const key = getEnv().FAL_KEY;
    if (!key) throw new Error("FAL_KEY is not set");
    return { Authorization: `Key ${key}`, "content-type": "application/json" };
  }

  async submit(input: UpscaleSubmitInput): Promise<{ providerJobId: string }> {
    const body = {
      video_url: input.videoUrl,
      model: "Starlight Precise 2.5",
      upscale_factor: input.upscaleFactor,
      // fal defaults to H265, and Chrome Headless Shell cannot be relied on to
      // decode HEVC — Remotion's OffthreadVideo would fail on the result.
      H264_output: true,
      // Deliberately not sent: `target_fps` (enables frame interpolation, which
      // changes the frame count <Freeze> and the caption timings depend on) and
      // compression/noise/halo/grain/recover_detail (model defaults, validated).
    };
    // The exact parameters, in the worker terminal, without a debugger.
    logger.info(
      { endpoint: FAL_ENDPOINT, body: { ...body, video_url: withoutQuery(body.video_url) } },
      "fal topaz upscale submit",
    );
    const response = await this.request(FAL_ENDPOINT, {
      method: "POST",
      body: JSON.stringify(body),
    });
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

/**
 * DRY_RUN: completes immediately with a placeholder URL. The handler recognises
 * the `dryrun://` scheme and copies the input plate through unchanged, so the
 * whole chain runs with no API key.
 */
class DryRunUpscale implements UpscaleProvider {
  async submit(): Promise<{ providerJobId: string }> {
    return { providerJobId: `dry_${Date.now()}` };
  }
  async poll(providerJobId: string) {
    return { status: "done", videoUrl: `dryrun://upscale/${providerJobId}.mp4` } as const;
  }
}

let override: UpscaleProvider | undefined;

/** Test hook (same shape as `setStorage`): the failure paths DRY_RUN can't reach. */
export function setUpscaleProvider(provider: UpscaleProvider | undefined): void {
  override = provider;
}

export function getUpscaleProvider(): UpscaleProvider {
  if (override) return override;
  return getEnv().DRY_RUN ? new DryRunUpscale() : new FalUpscale();
}

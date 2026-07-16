import { getEnv } from "../config";
import { PermanentError, TransientError } from "../jobs/errors";

/**
 * InfiniteTalk lip-sync behind a swappable interface. Reference implementation
 * is the hosted fal.ai endpoint (video-to-video: persona base clip + TTS audio
 * -> lip-synced video). Polling, not webhooks: the CLI phase has no public URL
 * and the worker polls identically pre- and post-launch.
 */
export interface LipsyncProvider {
  submit(input: { videoUrl: string; audioUrl: string }): Promise<{ providerJobId: string }>;
  poll(
    providerJobId: string,
  ): Promise<
    | { status: "pending" }
    | { status: "done"; videoUrl: string }
    | { status: "failed"; reason: string }
  >;
}

const FAL_BASE = "https://queue.fal.run/fal-ai/infinitalk";
const FAL_ENDPOINT = `${FAL_BASE}/video-to-video`;

class FalLipsync implements LipsyncProvider {
  private headers(): Record<string, string> {
    const key = getEnv().FAL_KEY;
    if (!key) throw new Error("FAL_KEY is not set");
    return { Authorization: `Key ${key}`, "content-type": "application/json" };
  }

  async submit(input: { videoUrl: string; audioUrl: string }): Promise<{ providerJobId: string }> {
    const response = await this.request(FAL_ENDPOINT, {
      method: "POST",
      body: JSON.stringify({ video_url: input.videoUrl, audio_url: input.audioUrl }),
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

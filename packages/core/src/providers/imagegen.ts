import { getEnv } from "../config";
import { PermanentError, TransientError } from "../jobs/errors";

/**
 * Product-in-hand composite images behind a swappable interface. Reference
 * implementation is nano-banana (Gemini 2.5 Flash Image) on fal's hosted queue
 * endpoint (`fal-ai/nano-banana/edit`, verified 2026-07: `image_urls` +
 * `prompt`, $0.039/image): persona reference stills + product photo + a fixed
 * prompt -> one 9:16 image. Polling, not webhooks — same shape as lipsync.
 */
export interface ImagegenProvider {
  submit(input: { imageUrls: string[]; prompt: string }): Promise<{ providerJobId: string }>;
  poll(
    providerJobId: string,
  ): Promise<
    | { status: "pending" }
    | { status: "done"; imageUrl: string }
    | { status: "failed"; reason: string }
  >;
}

const FAL_BASE = "https://queue.fal.run/fal-ai/nano-banana";
const FAL_ENDPOINT = `${FAL_BASE}/edit`;

class FalImagegen implements ImagegenProvider {
  private headers(): Record<string, string> {
    const key = getEnv().FAL_KEY;
    if (!key) throw new Error("FAL_KEY is not set");
    return { Authorization: `Key ${key}`, "content-type": "application/json" };
  }

  async submit(input: { imageUrls: string[]; prompt: string }): Promise<{ providerJobId: string }> {
    const response = await this.request(FAL_ENDPOINT, {
      method: "POST",
      body: JSON.stringify({
        prompt: input.prompt,
        image_urls: input.imageUrls,
        aspect_ratio: "9:16",
        num_images: 1,
      }),
    });
    const json = (await response.json()) as { request_id: string };
    return { providerJobId: json.request_id };
  }

  async poll(providerJobId: string) {
    const statusResponse = await this.request(`${FAL_BASE}/requests/${providerJobId}/status`, {
      method: "GET",
    });
    const status = (await statusResponse.json()) as { status: string };

    if (status.status === "IN_QUEUE" || status.status === "IN_PROGRESS") {
      return { status: "pending" } as const;
    }
    if (status.status !== "COMPLETED") {
      return { status: "failed", reason: `fal status ${status.status}` } as const;
    }

    const resultResponse = await this.request(`${FAL_BASE}/requests/${providerJobId}`, {
      method: "GET",
    });
    const result = (await resultResponse.json()) as { images?: { url?: string }[] };
    if (!result.images?.[0]?.url) {
      return { status: "failed", reason: "fal result has no image url" } as const;
    }
    return { status: "done", imageUrl: result.images[0].url } as const;
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
class DryRunImagegen implements ImagegenProvider {
  async submit(): Promise<{ providerJobId: string }> {
    return { providerJobId: `dry_${Date.now()}` };
  }
  async poll(providerJobId: string) {
    return { status: "done", imageUrl: `dryrun://imagegen/${providerJobId}.png` } as const;
  }
}

let override: ImagegenProvider | undefined;

/** Test hook (same shape as `setLipsyncProvider`). */
export function setImagegenProvider(provider: ImagegenProvider | undefined): void {
  override = provider;
}

export function getImagegenProvider(): ImagegenProvider {
  if (override) return override;
  return getEnv().DRY_RUN ? new DryRunImagegen() : new FalImagegen();
}

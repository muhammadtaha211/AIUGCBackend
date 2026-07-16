import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { getEnv } from "../config";

/** Locked product decision (handover §6): all copywriting runs on claude-sonnet-4-6. */
export const CLAUDE_MODEL = "claude-sonnet-4-6";

let client: Anthropic | undefined;

function getClient(): Anthropic {
  if (!client) {
    const key = getEnv().ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set (or run with DRY_RUN=1)");
    client = new Anthropic({ apiKey: key });
  }
  return client;
}

export interface GenerateResult<T> {
  object: T;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * One structured-output call. Prefills are not supported on claude-sonnet-4-6;
 * output_config.format guarantees schema-valid JSON instead. Copy pipelines
 * handle DRY_RUN themselves (canned Hebrew) — this function always calls the API.
 */
export async function generateObject<T>(opts: {
  prompt: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
}): Promise<GenerateResult<T>> {
  const response = await getClient().messages.parse({
    model: CLAUDE_MODEL,
    max_tokens: opts.maxTokens ?? 4096,
    messages: [{ role: "user", content: opts.prompt }],
    output_config: { format: zodOutputFormat(opts.schema) },
  });

  if (!response.parsed_output) {
    throw new Error(`structured output parse failed (stop_reason: ${response.stop_reason})`);
  }
  return {
    object: response.parsed_output,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { getEnv } from "../config";

export interface VisionFrame {
  /** Shown to the model directly above its image (e.g. "Frame 3 — t=12.4s"). */
  label: string;
  jpeg: Buffer;
}

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

/** What a structured-output call puts on the wire under `output_config.format`. */
export type WireOutputFormat = Anthropic.JSONOutputFormat;

/**
 * The SDK's own wire format for a zod schema — the shape every structured call
 * in this repo has sent since structured outputs landed. Its transform keeps
 * the API's supported subset of JSON Schema and folds every other keyword into
 * the field's `description` as prose: `enum` and `const` included (0.111.0,
 * lib/transform-json-schema.js), so an enum here is a hint the model reads,
 * not a rule the decoding grammar enforces, and the API can and does return a
 * value outside it. Identical bytes to passing zodOutputFormat() straight to
 * the call — JSON.stringify drops the parse callback either way.
 */
export function foldedOutputFormat(schema: z.ZodType): WireOutputFormat {
  const { parse: _parse, ...wire } = zodOutputFormat(schema);
  return wire;
}

export interface RawResult {
  /** The first text block, verbatim — null when the response carried none (a refusal can). */
  text: string | null;
  stopReason: Anthropic.StopReason | null;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * One structured-output vision call, returned RAW: labeled JPEG frames + a
 * system prompt shared across the batches of one analysis, the caller's wire
 * format passed through opaquely, and the response's first text block handed
 * back unparsed with its stop_reason and usage. No JSON.parse, no zod, no
 * opinion about the content: the caller records the usage first — a billed
 * call belongs in the ledger whatever its body holds — and then owns the
 * parse and the validation, per element if it wants to. The system block
 * carries cache_control so parallel batches pay for the prompt + questionnaire
 * prefix once; thinking is explicitly disabled — frame transcription is
 * reading, not reasoning, and thinking across many images is slow for no
 * accuracy gain. Like generateObject, DRY_RUN is the caller's concern — this
 * always calls.
 */
export async function generateRawWithImages(opts: {
  system: string;
  prompt: string;
  frames: VisionFrame[];
  format: WireOutputFormat;
  maxTokens?: number;
}): Promise<RawResult> {
  const content: Anthropic.ContentBlockParam[] = opts.frames.flatMap(
    (frame): Anthropic.ContentBlockParam[] => [
      { type: "text", text: frame.label },
      {
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: frame.jpeg.toString("base64") },
      },
    ],
  );
  content.push({ type: "text", text: opts.prompt });

  const response = await getClient().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: opts.maxTokens ?? 8192,
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    thinking: { type: "disabled" },
    messages: [{ role: "user", content }],
    output_config: { format: opts.format },
  });

  const text = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );
  return {
    text: text ? text.text : null,
    stopReason: response.stop_reason,
    usage: {
      // Cache writes/reads are billed input too (at 1.25x/0.1x); folding them
      // into inputTokens keeps the spend cap conservative and the cost visible.
      inputTokens:
        response.usage.input_tokens +
        (response.usage.cache_creation_input_tokens ?? 0) +
        (response.usage.cache_read_input_tokens ?? 0),
      outputTokens: response.usage.output_tokens,
    },
  };
}

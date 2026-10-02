import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
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
 * output_config.format constrains the JSON instead — to the schema's types,
 * required keys and no extra keys. That is all the grammar enforces on this
 * wire: enum, const and min/max reach the API as description prose (see
 * foldedOutputFormat) and are checked only by the client-side parse, which
 * rejects the whole object and records no usage when it fails. Copy pipelines
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

type SchemaNode = Record<string, unknown>;
/** A path into the schema: keywords and array indexes as-is, map entries as
 *  `{ name }` — so a property or definition literally called "oneOf" is never
 *  mistaken for the keyword the transform renames. */
type SchemaPath = (string | number | { name: string })[];
type LiftedKeyword = { path: SchemaPath; keyword: "enum" | "const"; value: unknown };
const isSchemaNode = (v: unknown): v is SchemaNode =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const segmentName = (segment: SchemaPath[number]): string | number =>
  typeof segment === "object" ? segment.name : segment;

/** Walk zod's JSON schema, lifting `enum`/`const` out of every schema node and
 *  recording where each came from. Only schema positions are walked —
 *  `properties`/`$defs` are maps of NAMES, so a field called "enum" is data.
 *  Positions the SDK transform drops (`prefixItems`, `propertyNames`, a
 *  schema-valued `additionalProperties`) are walked too, on purpose: an enum
 *  found there is lifted, and reattachEnums then fails loudly instead of the
 *  wire going silently lenient. */
function liftEnums(node: SchemaNode, path: SchemaPath, out: LiftedKeyword[]): SchemaNode {
  const copy: SchemaNode = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "enum" || key === "const") {
      out.push({ path, keyword: key, value });
    } else if (
      (key === "properties" || key === "$defs" || key === "definitions") &&
      isSchemaNode(value)
    ) {
      copy[key] = Object.fromEntries(
        Object.entries(value).map(([name, sub]) => [
          name,
          isSchemaNode(sub) ? liftEnums(sub, [...path, key, { name }], out) : sub,
        ]),
      );
    } else if (
      (key === "anyOf" || key === "oneOf" || key === "allOf" || key === "prefixItems") &&
      Array.isArray(value)
    ) {
      copy[key] = value.map((sub, i) =>
        isSchemaNode(sub) ? liftEnums(sub, [...path, key, i], out) : sub,
      );
    } else if (
      (key === "items" ||
        key === "not" ||
        key === "propertyNames" ||
        key === "additionalProperties") &&
      isSchemaNode(value)
    ) {
      copy[key] = liftEnums(value, [...path, key], out);
    } else {
      copy[key] = value;
    }
  }
  return copy;
}

/** Put each lifted keyword back on the node the transform produced for the
 *  same path. The transform renames the `oneOf` keyword to `anyOf` (a property
 *  NAMED oneOf is a `{ name }` segment and is left alone); a node the transform
 *  dropped is a loud failure here, never a silently lenient wire. */
function reattachEnums(root: SchemaNode, lifted: LiftedKeyword[]): SchemaNode {
  for (const { path, keyword, value } of lifted) {
    let node: unknown = root;
    for (const segment of path) {
      const key = segment === "oneOf" ? "anyOf" : segmentName(segment);
      node = isSchemaNode(node)
        ? node[key as string]
        : Array.isArray(node)
          ? node[key as number]
          : undefined;
      if (node === undefined) {
        throw new Error(
          `strict wire: node ${path.map(segmentName).join(".")} did not survive the SDK transform`,
        );
      }
    }
    (node as SchemaNode)[keyword] = value;
  }
  return root;
}

/**
 * The strict wire for a zod schema: the SDK's own transform, with `enum` and
 * `const` lifted out before it runs and re-attached afterwards, so they reach
 * the decoding grammar as keywords instead of the description as prose. All of
 * the transform's sanitising survives — an unsupported `.min()` still becomes
 * description text rather than a 400 — which is why this is not the SDK's
 * `transform: false`. Measured 2026-09-20: the folded wire returned an
 * out-of-enum value on request; this one refused it (vault
 * facts/sdk-folds-enum-and-const-into-description). Vision batch call only, by
 * decision — generateObject's callers keep the folded wire.
 */
export function strictOutputFormat(schema: z.ZodType): WireOutputFormat {
  const lifted: LiftedKeyword[] = [];
  // The same toJSONSchema call zodOutputFormat makes, so the two wires differ
  // only where the lift touched them. The transform is reached through the
  // public jsonSchemaOutputFormat helper (its `schema` is the transformed
  // copy): the SDK's lib/transform-json-schema subpath resolves under Node and
  // tsx but not under vitest's resolver — measured 2026-09-20.
  const raw = z.toJSONSchema(schema, { reused: "ref" }) as SchemaNode;
  const stripped = liftEnums(raw, [], lifted) as Parameters<typeof jsonSchemaOutputFormat>[0];
  const transformed = jsonSchemaOutputFormat(stripped).schema as SchemaNode;
  return { type: "json_schema", schema: reattachEnums(transformed, lifted) };
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
  /** Per-call overrides of the SDK's 10-minute timeout and 2 retries, for a
   *  caller that would rather go without an answer than hold its lane. */
  timeoutMs?: number;
  maxRetries?: number;
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

  const response = await getClient().messages.create(
    {
      model: CLAUDE_MODEL,
      max_tokens: opts.maxTokens ?? 8192,
      system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
      thinking: { type: "disabled" },
      messages: [{ role: "user", content }],
      output_config: { format: opts.format },
    },
    {
      ...(opts.timeoutMs !== undefined ? { timeout: opts.timeoutMs } : {}),
      ...(opts.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {}),
    },
  );

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

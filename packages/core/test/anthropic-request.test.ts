import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const parse = vi.hoisted(() => vi.fn());
const create = vi.hoisted(() => vi.fn());
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { parse, create };
  },
}));

import { resetEnvCache } from "../src/config";
import {
  CLAUDE_MODEL,
  generateObject,
  generateRawWithImages,
  strictOutputFormat,
} from "../src/providers/anthropic";

/**
 * What the two wrappers ask for besides the schema (vault 0093, 0095): every
 * call names claude-sonnet-5-5 and turns thinking off with `between_tools`. On
 * 5.5 `disabled` is a 400 and an omitted field runs adaptive thinking.
 */

const savedKey = process.env.ANTHROPIC_API_KEY;
beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  resetEnvCache();
});
afterAll(() => {
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
  resetEnvCache();
});

const schema = z.object({ ok: z.boolean() });

describe("the model", () => {
  it("is claude-sonnet-5-5", () => {
    expect(CLAUDE_MODEL).toBe("claude-sonnet-5-5");
  });
});

describe("generateObject", () => {
  it("asks claude-sonnet-5-5 with thinking off", async () => {
    parse.mockResolvedValueOnce({
      parsed_output: { ok: true },
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 2 },
    });
    const result = await generateObject({ prompt: "p", schema });
    expect(result).toEqual({ object: { ok: true }, usage: { inputTokens: 10, outputTokens: 2 } });
    const request = parse.mock.calls[0]![0];
    expect(request.model).toBe("claude-sonnet-5-5");
    expect(request.thinking).toEqual({ type: "between_tools" });
  });
});

describe("generateRawWithImages", () => {
  it("asks claude-sonnet-5-5 with thinking off", async () => {
    create.mockResolvedValueOnce({
      content: [{ type: "text", text: '{"ok":true}' }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 2 },
    });
    const result = await generateRawWithImages({
      system: "s",
      prompt: "p",
      frames: [{ label: "Frame 1", jpeg: Buffer.from([0xff, 0xd8]) }],
      format: strictOutputFormat(schema),
    });
    expect(result.text).toBe('{"ok":true}');
    const request = create.mock.calls[0]![0];
    expect(request.model).toBe("claude-sonnet-5-5");
    expect(request.thinking).toEqual({ type: "between_tools" });
  });
});

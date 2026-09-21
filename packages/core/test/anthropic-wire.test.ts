import { describe, expect, it } from "vitest";
import { z } from "zod";
import { foldedOutputFormat, strictOutputFormat } from "../src/providers/anthropic";

/**
 * The two wire builders, generically: what the SDK's transform does to a zod
 * schema (measured against @anthropic-ai/sdk 0.111.0 — vault
 * facts/sdk-folds-enum-and-const-into-description), and what the strict
 * builder changes about it, which must be exactly the enum/const keywords and
 * nothing else.
 */

const probe = z.object({
  kind: z.enum(["a", "b"]),
  count: z.number().int().min(1),
  title: z.string().min(1),
  note: z.string().nullable(),
  preset: z.union([z.literal(15), z.literal(30)]),
  tags: z.array(z.enum(["x", "y"])),
  nested: z.object({ level: z.enum(["low", "high"]).optional() }),
});

const schemaOf = (format: { schema: Record<string, unknown> }) =>
  JSON.parse(JSON.stringify(format.schema)) as Record<string, unknown>;
const node = (schema: Record<string, unknown>, ...path: (string | number)[]) =>
  path.reduce<unknown>((n, k) => (n as Record<string | number, unknown>)[k], schema) as Record<
    string,
    unknown
  >;

describe("foldedOutputFormat — the SDK's transform as it ships", () => {
  it("keeps the API's subset and folds enum, const and the numeric/string constraints into description prose", () => {
    const s = schemaOf(foldedOutputFormat(probe));
    expect(node(s, "properties", "kind")).toEqual({
      type: "string",
      description: '{enum: ["a","b"]}',
    });
    expect(node(s, "properties", "count")).toEqual({
      type: "integer",
      description: "{minimum: 1, maximum: 9007199254740991}",
    });
    expect(node(s, "properties", "title")).toEqual({
      type: "string",
      description: "{minLength: 1}",
    });
    expect(node(s, "properties", "preset", "anyOf", 0)).toEqual({
      type: "number",
      description: "{const: 15}",
    });
    expect(JSON.stringify(s)).not.toContain('"enum"');
    expect(JSON.stringify(s)).not.toContain('"const"');
  });

  it("is what zodOutputFormat puts on the wire — the type/schema pair with no parse callback", () => {
    expect(Object.keys(foldedOutputFormat(probe))).toEqual(["type", "schema"]);
  });
});

describe("strictOutputFormat — enum and const in the grammar, everything else as the SDK left it", () => {
  const folded = schemaOf(foldedOutputFormat(probe));
  const strict = schemaOf(strictOutputFormat(probe));

  it("puts every enum and const back as a keyword, at every depth the schema has them", () => {
    expect(node(strict, "properties", "kind")).toEqual({ type: "string", enum: ["a", "b"] });
    expect(node(strict, "properties", "tags", "items")).toEqual({
      type: "string",
      enum: ["x", "y"],
    });
    expect(node(strict, "properties", "nested", "properties", "level")).toEqual({
      type: "string",
      enum: ["low", "high"],
    });
    expect(node(strict, "properties", "preset", "anyOf", 0)).toEqual({
      type: "number",
      const: 15,
    });
    expect(node(strict, "properties", "preset", "anyOf", 1)).toEqual({
      type: "number",
      const: 30,
    });
    expect(JSON.stringify(strict)).not.toContain("{enum");
    expect(JSON.stringify(strict)).not.toContain("{const");
  });

  it("keeps the SDK's sanitising for the keywords the API does not support", () => {
    expect(node(strict, "properties", "count")).toEqual(node(folded, "properties", "count"));
    expect(node(strict, "properties", "title")).toEqual(node(folded, "properties", "title"));
    expect(strict.additionalProperties).toBe(false);
    expect(strict.required).toEqual(folded.required);
  });

  it("differs from the folded wire ONLY at the enum/const nodes", () => {
    // Strip the lifted keywords back off the strict wire and fold them the way
    // the SDK does (transform-json-schema.js:102-110: the existing description,
    // "\n\n", then "{key: json, ...}" of the leftovers): the result must be
    // byte-identical to the folded wire. Faithful for nodes whose only
    // leftovers are enum/const — every node of this probe and of the batch
    // schema; a node that also carried e.g. minLength would fold both into
    // one brace on the folded wire and legitimately differ here.
    const refold = (n: unknown): unknown => {
      if (Array.isArray(n)) return n.map(refold);
      if (typeof n !== "object" || n === null) return n;
      const out: Record<string, unknown> = {};
      const leftovers: string[] = [];
      for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
        if (k === "enum" || k === "const") leftovers.push(`${k}: ${JSON.stringify(v)}`);
        else out[k] = refold(v);
      }
      if (leftovers.length > 0) {
        const existing = typeof out.description === "string" ? `${out.description}\n\n` : "";
        out.description = `${existing}{${leftovers.join(", ")}}`;
      }
      return out;
    };
    expect(JSON.stringify(refold(strict))).toBe(JSON.stringify(folded));
  });

  it("walks $defs when zod reuses a sub-schema, and re-attaches at the exact node", () => {
    const shared = z.object({ tone: z.enum(["warm", "cold"]) });
    const reused = z.object({ first: shared, second: shared });
    const s = schemaOf(strictOutputFormat(reused));
    const defs = s.$defs as Record<string, Record<string, unknown>>;
    expect(Object.keys(defs)).toHaveLength(1);
    const def = Object.values(defs)[0]!;
    expect(node(def, "properties", "tone")).toEqual({ type: "string", enum: ["warm", "cold"] });
    expect("enum" in def).toBe(false);
    expect(JSON.stringify(s)).not.toContain("{enum");
  });

  it("leaves a property NAMED oneOf or anyOf alone — only the keyword is renamed", () => {
    const named = z.object({ anyOf: z.enum(["m", "n"]), oneOf: z.enum(["a", "b"]) });
    const s = schemaOf(strictOutputFormat(named));
    expect(node(s, "properties", "anyOf")).toEqual({ type: "string", enum: ["m", "n"] });
    expect(node(s, "properties", "oneOf")).toEqual({ type: "string", enum: ["a", "b"] });
  });

  it("fails loudly when an enum sits on a node the transform drops — a tuple or a record key", () => {
    const tuple = z.object({ pair: z.tuple([z.enum(["a", "b"]), z.string()]) });
    expect(() => strictOutputFormat(tuple)).toThrow(
      "strict wire: node properties.pair.prefixItems.0 did not survive the SDK transform",
    );
    const record = z.object({ byKey: z.record(z.enum(["a", "b"]), z.string()) });
    expect(() => strictOutputFormat(record)).toThrow("did not survive the SDK transform");
  });

  it("follows the transform's oneOf -> anyOf rename when re-attaching a discriminator's const", () => {
    const disc = z.object({
      v: z.discriminatedUnion("t", [
        z.object({ t: z.literal("a") }),
        z.object({ t: z.literal("b") }),
      ]),
    });
    const s = schemaOf(strictOutputFormat(disc));
    expect(node(s, "properties", "v", "anyOf", 0, "properties", "t")).toEqual({
      type: "string",
      const: "a",
    });
    expect(node(s, "properties", "v", "anyOf", 1, "properties", "t")).toEqual({
      type: "string",
      const: "b",
    });
    expect("oneOf" in node(s, "properties", "v")).toBe(false);
  });

  it("does not mistake a property NAMED enum or const for a keyword", () => {
    const tricky = z.object({ enum: z.string(), const: z.number() });
    const s = schemaOf(strictOutputFormat(tricky));
    expect(node(s, "properties", "enum")).toEqual({ type: "string" });
    expect(node(s, "properties", "const")).toEqual({ type: "number" });
  });
});

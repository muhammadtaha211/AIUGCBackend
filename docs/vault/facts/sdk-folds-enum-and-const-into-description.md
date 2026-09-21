---
type: fact
status: verified
verified: 2026-09-20
method: "Scratch print (packages/core/.work/print-batch-schema.ts, gitignored) of JSON.stringify(zodOutputFormat(batchOutputSchema)) minus its parse callback, against @anthropic-ai/sdk 0.111.0 as installed (node_modules/.pnpm/@anthropic-ai+sdk@0.111.0_zod@4.4.3), read with lib/transform-json-schema.js:25-113 — the fold is :102-110. Upstream checked the same day: raw src/lib/transform-json-schema.ts on branch main and on tag sdk-v0.127.0 (the newest release, 2026-09-18) — no pop of 'enum' or 'const' in either. The A/B: packages/core/.work/enum-wire-ab.ts (gitignored), two real messages.create calls authorized by the founder on 2026-09-20, text-only, claude-sonnet-4-6, thinking disabled, max_tokens 400, the output_config.format objects as sent (not whole request bodies — the prompt, model and thinking setting live in the script) saved as .work/ab-wire-A.json and .work/ab-wire-B.json; these two calls are OUTSIDE usage_events. Sibling callers: .work/print-sibling-schemas.ts printed plan_demo_steps, group_analysis_states and a literal/optional-enum probe; copy.ts and tts.ts were READ, not printed — grep for z.enum / z.literal across packages/core/src/pipelines/copy.ts and tts.ts hits only copy.ts:384, an input parse (:508), never a model-facing schema. The vitest resolution asymmetry: one scratch vitest file with two dynamic imports — import('@anthropic-ai/sdk/helpers/json-schema') resolved, import('@anthropic-ai/sdk/lib/transform-json-schema') failed with 'Failed to load url'; the same two under node --input-type=module both resolved (vitest 2.1.9, Node 24)."
source: code
---

# The SDK folds `enum` and `const` into `description`; the decoding grammar never saw them

`@anthropic-ai/sdk` 0.111.0's `zodOutputFormat()` runs `transformJSONSchema()` over zod's JSON
schema before it goes on the wire. That transform keeps `type`, `properties`, `required`,
`additionalProperties`, `items`, `minItems` (0 or 1), the supported string `format`s,
`description`, `title`, `$ref`/`$defs`, `anyOf`/`allOf` (and renames `oneOf` to `anyOf`) — and
folds **every other keyword** into the node's `description` as prose
(`lib/transform-json-schema.js:102-110`). `enum` and `const` are not on its keep list, so a
`z.enum([...])` reaches the API as

```json
{
  "type": "string",
  "description": "{enum: [\"navigate\",\"tap\",\"type\",\"select\",\"scroll\",\"result\",\"idle\"]}"
}
```

The API **does** support `enum` and `const` in structured-output schemas (the documented
supported-features list). So every enum in this repo's structured calls has been a hint the model
reads, never a rule the grammar enforces — the model was free to write any string there, and did.

## Measured, 2026-09-20 [MEASURED]

| wire                                    | bytes | frame 1 `actionType` asked for `"click"` | HTTP | stop_reason | zod (whole object) |
| --------------------------------------- | ----: | ---------------------------------------- | ---: | ----------- | ------------------ |
| A — today's, enums as description prose |  1027 | `"click"`                                |  200 | `end_turn`  | INVALID            |
| B — strict, enums in the grammar        |   940 | `"tap"`                                  |  200 | `end_turn`  | VALID              |

Same prompt to both (two imaginary frames, an instruction to set `actionType` to exactly `"click"`
on the second), `claude-sonnet-4-6`, thinking disabled, text-only. The saved `ab-wire-*.json` files
are the `output_config.format` objects as sent, not whole request bodies. Usage: A 777 in / 138 out, B
792 in / 138 out — the strict schema costs ~15 input tokens more in the injected system prompt. B
did not 400. **Two real calls, outside `usage_events`.**

What this measures: the lenient wire admits an out-of-enum value and the strict wire refuses one.
What it does NOT prove: what job `85d9ec0b`'s frame 5 actually carried — that value is
unrecoverable ([[analysis-parse-failure-discards-the-whole-attempt]]).

## Where it applies in this repo [MEASURED for the first three rows — scratch prints; READ for copy.ts / tts.ts]

| call                    | model-facing schema                    | enum/const on the wire | what the fold did instead                                                                  |
| ----------------------- | -------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------ |
| `analyze_demo` batches  | `batchOutputSchema`                    | **no → yes**           | three enums as prose; **put into the grammar by `strictOutputFormat`** (commit 2)          |
| `plan_demo_steps`       | `planOutputSchema`                     | none to fold           | — (`actionType`'s enum is on the STORED `planStepSchema`, derived in code)                 |
| `group_analysis_states` | `{ sections: analysisSectionsSchema }` | none to fold           | `.min(1)` → `{minLength: 1}` and `.int().nonnegative()` → `{minimum: 0, maximum: …}` prose |
| `copy.ts`, `tts.ts`     | their output schemas                   | none to fold (READ)    | — no `z.enum` / `z.literal` on any model-facing schema; the one literal is an input parse  |

The three `generateObject` callers keep the folded wire by decision: their `.min()` /
`.nonnegative()` prose is enforced client-side only, and changing their wire is a separate decision
the founder has not made ([[state-of-play]], queue).

## How the strict wire is built, and why not `transform: false`

`strictOutputFormat(schema)` (`packages/core/src/providers/anthropic.ts:174`) lifts `enum`/`const` out
of every node of zod's raw schema, recording the path, runs the SDK's own transform on the rest so
all of its sanitising survives, and re-attaches each keyword at the same node (mapping the
transform's `oneOf → anyOf` rename). The transform is reached through the public
`jsonSchemaOutputFormat` helper (`helpers/json-schema.js:14-36`, whose `schema` is the transformed
copy) rather than the `lib/transform-json-schema` subpath: **that subpath resolves under Node's ESM
loader and under tsx but NOT under vitest 2.1.9's resolver** — measured 2026-09-20 with a scratch
test importing both (`helpers/json-schema` resolved, `lib/transform-json-schema` did not, in the
same run) — so the helper is the route that the test gate can exercise. The SDK's other route,
`jsonSchemaOutputFormat(raw, { transform: false })` (`helpers/json-schema.js:18`), would send zod's
raw output untouched — and the first future `.min()` / `.nonnegative()` on the schema would then
become a production 400 instead of description prose. Lift-and-reattach keeps the sanitiser.

Upstream has not changed this: `main` and `sdk-v0.127.0` (2026-09-18) still fold `enum` and
`const`, so an SDK upgrade would not have fixed it.

## Related

- [[analysis-parse-failure-discards-the-whole-attempt]] — the job this was found on, and the
  cause section this note rewrites.
- The docs' "Enum value casing" caveat is the residual hole once the grammar holds the enums:
  structured outputs do not guarantee the capitalization of enum/const values; the per-element
  canonicalization in `validateBatchFrames` closes it at zero API calls.

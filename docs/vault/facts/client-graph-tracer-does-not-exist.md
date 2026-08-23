---
type: fact
status: verified
verified: 2026-08-23
method: "find . -name 'client-graph*' -not -path '*/node_modules/*' → empty; git log --all --diff-filter=A -- '*client-graph*' → empty"
source: code
---

# There is no client import-graph tracer in this repo, and there never was

`client-graph.cjs` is cited in session handovers as the tool that produced the web app's client
import graph. It is not in the working tree, it is not in `.gitignore`d output, and
`git log --all --diff-filter=A` finds no commit that ever added a file matching `*client-graph*`.
No `package.json` script traces the client graph and there is no `scripts/` entry that does.

It existed only inside a session scratchpad and died with that session. **Any claim sourced to it is
unreproducible.**

## The claim it produced, and why it was wrong

A rev-4 handover reported "zero `@aiugc/remotion` edges" reachable from the browser bundle. There
are **three**, found by `grep -rn "@aiugc/remotion" apps/web/src apps/admin/src`:

```
apps/web/src/components/a-wizard/placement-editor.tsx:14  import { fitFontSize, HOOK_FONT } from "@aiugc/remotion/text-fit";
apps/web/src/components/a-wizard/step-plan.tsx:6          import { fitFontSize, HOOK_FONT, STEP_LABEL_RECT } from "@aiugc/remotion/text-fit";
apps/admin/src/app/(admin)/hooks/safe-area-editor.tsx:4   import { fitFontSize, HOOK_FONT } from "@aiugc/remotion/text-fit";
```

These are **value** imports, not type-only — `fitFontSize` runs in the browser — so nothing erases
at build.

## But the direction of the claim was right

All three edges land on one module, and it cannot pull anything else in:

- `packages/remotion/package.json` declares only two export subpaths, `./render` and `./text-fit`.
  **There is no `"."` entry**, so `@aiugc/remotion/text-fit` cannot reach `src/index.ts` or any
  `@remotion/*` dependency.
- `packages/remotion/src/text-fit.ts` is 2,342 bytes with **zero imports**.

So the honest statement is "three edges, all to one dependency-free leaf module, sub-1KB minified" —
not "zero edges", and not "the browser bundle pulls in Remotion". The old claim was wrong about the
count and right about the weight, which is the worst combination: correct conclusion, unusable
reasoning.

## What to do instead

If the graph is needed again, write the tracer **into the repo** so its output is reproducible, or
don't cite a graph at all — a targeted grep for `@aiugc/remotion` across `apps/web/src` and
`apps/admin/src`, plus a read of `packages/remotion/package.json`'s `exports`, answers every
question the tracer was used for and can be re-run by anyone.

Note the earlier grep in this note was itself run against `apps/web/src` alone at first and missed
the `apps/admin` edge. Two directories, both apps.

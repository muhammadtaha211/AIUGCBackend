---
type: defect
status: verified
verified: 2026-09-01
method: "production ENOENT in Vercel function logs (scandir /var/task/apps/web/prompts/hook_lines); pnpm --filter @aiugc/web build, then read .next/server/app/api/businesses/[businessId]/{hook-lines,vo-script,scripts}/route.js.nft.json for prompts/ entries"
source: code
---

# A runtime file read on a computed path is invisible to Vercel's file tracer

`renderPrompt`/`latestPromptVersion` (`packages/core/src/prompts.ts`) read
`prompts/<name>/v<N>.md` with `readFileSync`/`readdirSync` on paths joined at
runtime. Vercel's output file tracing only follows statically analyzable
requires and literal-path reads, so nothing under `prompts/` was packaged into
the lambda, and no marker file above `apps/web` was either. First production
hit, 2026-09-01:

    ENOENT: no such file or directory, scandir '/var/task/apps/web/prompts/hook_lines'
      at async j (.next/server/app/api/businesses/[businessId]/hook-lines/route.js)

Three routes could fire it — the only web routes that read prompts in-request
(full audit 2026-09-01, forward + reverse call-graph trace, adversarially
re-verified): `POST /api/businesses/[businessId]/hook-lines`
(`prompts/hook_lines`), `POST .../vo-script` (`prompts/vo_script`), and
`POST .../scripts` (`prompts/b_script`). Everything else either only enqueues a
worker job or never touches the prompt pipelines.

Two details that matter more than the instance:

- **The loader's fallback logic was correct.** `resolveRepoRoot`
  (`packages/core/src/paths.ts`) walks up from cwd looking for
  `pnpm-workspace.yaml` and would have landed on the repo root — the marker
  file simply was never traced into the bundle, so the walk exhausted and
  degraded to `process.cwd()` (= `/var/task/apps/web`). The actual cause was a
  missing traced file, not wrong path logic.
- **DRY_RUN would have half-hidden it.** `generateHookLines` and
  `generateBScript` render the template even under DRY_RUN (deliberately, for
  prompt_version traceability), so a DRY_RUN deploy still ENOENTs on
  hook-lines and scripts — but `generateVoScript` returns canned text before
  the read, so vo-script would have looked healthy.

The class is what matters: any file read on a computed path passes `next dev`
(runs from the checkout), passes every test (same), and fails only once
deployed, because what gets packaged is decided by static tracing at build
time. The worker and CLI are immune — they run `tsx` from a plain checkout and
resolve the repo root from `import.meta.url` (the try branch), never entering
the fallback.

## FIXED

Config-only, `packages/core/src/paths.ts` untouched (which is what keeps the
worker/CLI try-branch and the other `REPO_ROOT` consumers — `WORK_DIR`,
`FIXTURES_DIR`, `SEED_STRUCTURES_DIR`, `LOCAL_STORAGE_DIR`, none of them read
by any web route at request time — out of the blast radius).
`apps/web/next.config.ts` now sets:

    outputFileTracingRoot: path.join(__dirname, "../..")
    outputFileTracingIncludes: { "/api/**": ["../../prompts/**/*", "../../pnpm-workspace.yaml"] }

The root pins `/var/task` to the monorepo layout; the includes pack all
version files plus the marker the fallback walks to. The key is deliberately
broad (`/api/**`, not the three routes) so the first future prompt-reading
route is covered instead of ENOENTing one deploy at a time. Verified in the
build traces: all three routes' `.nft.json` files list 46 `prompts/*/v*.md`
entries plus `pnpm-workspace.yaml`, each `..`-relative exactly to the repo
root; `demos/[id]/plan` (enqueue-only today) carries them too, proving the
broad key.

Residual hazards, deliberately accepted:

- The includes hang off the `/api/**` key — a prompt-reading **server
  component or page** would not be covered until the key is widened.
- `apps/admin` transpiles `@aiugc/core` identically and is queued for the same
  Vercel deployment; it has zero prompt-reading paths today, but inherits this
  exact defect the moment it gains one and its `next.config.ts` gains no
  equivalent includes.

Related: [[prompt-versions-on-disk]] — why the loader scans for the highest
`v<N>.md` at call time and must keep doing so.

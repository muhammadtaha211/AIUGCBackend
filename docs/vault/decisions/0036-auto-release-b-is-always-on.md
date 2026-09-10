---
type: decision
status: verified
verified: 2026-09-09
method: "founder decision in chat, 2026-09-09: `auto_release_b` should always be on, that's the final decision — and it should read as settled, not as a placeholder. Code state read at 182e5fb: packages/core/src/pipelines/renders.ts:491-493 is the only consumer; supabase/migrations/0031_seed_unseeded_config.sql:68-77 is the guarded seed that makes ON survive a rebuild. Live value `true` per [[app-config-live-state]] (unchanged since 2026-08-26)."
source: founder
---

# 0036 — `auto_release_b` is ON, and that is a decision, not a placeholder

## The decision

`app_config.auto_release_b` is **`true`**, permanently. Service B renders release straight to the
customer; the `qc_pending` gate does not run. This is the settled answer, not a value awaiting the
Service B revamp.

What changes is only how it should be **read**. The value has been `true` since 2026-08-26 and no
session was ever allowed to flip it — but [[0004-service-b-config-is-provisional]] filed it
alongside `lipsync_resolution` as "whatever was lying around when Service B was parked", which made
a settled operating decision look undecided. It is not.

## What still stands

**CLAUDE.md locked decision #8 and its amendment are unchanged.** The QC machinery stays in the
tree — `packages/core/src/pipelines/qc.ts`, `aiugc qc list|approve|reject`, and the RLS rule that
hides `qc_pending`/`rejected` from customers — because the flag is the switch and its off-position
has to keep working. Do not write code that assumes the gate runs, and do not set the flag `false`.

## Where it lives, exactly

- **The only read** is `packages/core/src/pipelines/renders.ts:491-493`:

  ```ts
  const autoReleaseB = await getConfigValue(ctx.db, "auto_release_b", z.boolean());
  const released = render.service === "a" || autoReleaseB;
  ```

  Service A never had a gate; Service B's is this boolean and nothing else.

- **The seed** is `supabase/migrations/0031_seed_unseeded_config.sql:75-77`, guarded so it only
  fires against the original `false` from `0001_extras_and_seed.sql:32`:

  ```sql
  UPDATE "app_config"
  SET "value" = 'true'::jsonb, "updated_at" = now()
  WHERE "key" = 'auto_release_b' AND "value" = 'false'::jsonb;
  ```

  So a rebuild reproduces ON by construction rather than by someone remembering to flip it. 0031's
  own comment already said ON "is the live setting" — this note is what makes that a decision the
  vault can be grepped for.

## The consequence, stated plainly

Every Service B render reaches the customer unreviewed. `events` holds zero `qc_release` /
`qc_reject` rows and always will while this stands ([[events-table-is-empty]]). The founder-eyeball
pass that Service B gets today happens _after_ release, not before it. That is the accepted
trade-off, not an oversight — and it is the reason
[[content-policy-classifier-never-runs]] matters more than it otherwise would, since QC is not
standing behind it.

Related: [[app-config-live-state]] (the live value), [[0004-service-b-config-is-provisional]]
(amended by this note — `lipsync_resolution` remains the only genuinely provisional key),
[[0017-service-b-single-setting-selfie-talking-head]],
[[0022-heygen-expressiveness-medium-generic-motion-prompt]].

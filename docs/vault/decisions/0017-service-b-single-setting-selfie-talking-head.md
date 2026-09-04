---
type: decision
status: verified
verified: 2026-09-04
method: "founder decisions stated in chat across the 2026-09-03/04 planning session. The one repo-checkable number in the note — the HeyGen/InfiniteTalk per-second price ratio — is read off supabase/migrations/0020_backfill_heygen_usage.sql:12-14, not asserted."
source: founder
supersedes: "[[0004-service-b-config-is-provisional]]"
---

# 0017 — Service B ships as a single-setting selfie talking head with an optional opener clip

This is the shape of the Service B revamp that [[0004-service-b-config-is-provisional]] parked
until Service A was finished. It settles the **format**. It does not settle the engine, the schema,
or the wizard — those are queue items, and this note is what they build to.

Every item below is marked **founder-decided** (stated in chat) or **reasoned** (derived here from
the repo, and therefore falsifiable by the repo).

## The flow

**Founder-decided.** Six steps, in order:

```
persona -> pointers -> script -> audio -> opener effect -> render
```

There is **no image step and no composite step.** Today's wizard has both
(`apps/web/src/components/b-wizard/`); the revamp removes them, and the picker they fed goes with
them.

**One background per persona** — the persona's default selfie image. A persona is one look in one
setting, not a set of looks the customer chooses between.

**Reasoned — this does not exist in the schema yet.** `persona_images.kind` is
`'preview' | 'background'` today (`packages/core/src/db/schema.ts:286`, added by
`0009_persona_image_kind.sql`); there is **no `selfie` value**. `is_default` already exists and is
already "at most one per persona" via a partial unique index (`schema.ts:284`,
`0006_persona_images_default.sql`). So the schema work is a new `kind`, not a new defaulting
mechanism. Do not read "the persona's default `kind='selfie'` image" anywhere in this note as a
description of the running database — it is the target.

**And `kind` is not free text in practice.** The column is `text` with a default and no DB check
constraint, but the two literals are enforced at the app boundary in three places a migration alone
would miss: `apps/admin/src/lib/admin.ts:65` (`kind: z.enum(["preview", "background"]).optional()`),
and `apps/web/src/lib/service-b.ts:61` and `:68-69`, which select the avatar thumbnail and the
background picker by comparing against the literals. Adding `selfie` is therefore a migration **plus
a zod enum plus two filter helpers** — budget for that in the schema step, and expect the picker
helpers to be the thing that actually changes behaviour.

## Physical products are out of Service B

**Founder-decided.** A talking head holding a physical product is a **different service**, not a
Service B option. The reason given: **product-in-hand isn't proof.** A generated image of a persona
holding a thing demonstrates nothing about the thing.

This retires the composite path from the Service B flow — `composites`, the
`category === "physical_product"` gate, and the nano-banana step (`providers/imagegen.ts`,
`docs/04-integrations.md` §nano-banana composites). **Retired from the flow, not from the tree**:
the founder has parked a physical-product service as a separate thing (see _Still open_), so the
machinery keeps working the way `pipelines/qc.ts` keeps working under locked decision #8.

**Reasoned:** locked decision #11 (runtime image generation is founder-approved _for Service B
product-in-hand composites only_) is now scoped to something Service B no longer does. It is not
repealed here — only the founder repeals a locked decision — but it currently authorises a path
with no caller in the new flow.

## The opener clip

**Founder-decided.** An optional short clip in front of the talking head.

- **Founder-made, one per (selfie image × effect).** Not generated at runtime, not prompted. A
  bank, exactly like Service A's hook clips.
- **Stored play-ready** — already reversed where the effect is a reveal. The file on disk is what
  plays. Nothing reverses at render time.
- **Tagged `reveal_at_ms` and a text safe area.** The hook text burns over the clip during the
  **palm phase** (the covered part) and **hard-cuts at the reveal**.

**Reasoned — the precedent is already in the tree.** `hook_clips` carries a required
`text_safe_area` at register, with `DEFAULT_HOOK_TEXT_RECT` seeding only the editor
(`docs/01-schema.md:52`), and the Remotion side already threads a `hookTextSafeArea` prop through
`ServiceA` (`packages/core/src/providers/remotion.ts:29`, `packages/remotion/src/schema.ts:63`).
The opener's safe area is the same idea against a new bank; `reveal_at_ms` is the new field.

**Reasoned:** storing the clip play-ready is what keeps that part of the render deterministic.
Service B's lipsync output is explicitly non-deterministic (`docs/04-integrations.md:245-246` —
HeyGen exposes no seed), so the opener is the one part of a B render that can be byte-identical
every time, and it stays that way only if the pipeline does no video processing on it.

## The hook text — spoken, on-screen, and where the final string lives

**Founder-decided:**

- **The spoken hook stays in the script.** It is not moved out and not deleted.
- **`hook_text` is a shortened on-screen version**, produced in the **same `b_script` call**.
- **Re-derived when the script is edited.**
- **Editable by the customer** in the effect step.
- **The FINAL hook text lives in render params — never on the script row.**

**Reasoned — `hook_text` does not exist today and needs a prompt version.** `b_script`'s current
output contract is a single field: `scriptOutput = z.object({ script: z.string() })`
(`packages/core/src/pipelines/copy.ts:264`, called at `:447`), and `prompts/b_script/v8.md:144-151`
tells the model "Plain Hebrew text only. One continuous script." Adding a second field is a v9 plus
a schema widening, not a parameter. `scripts.params` already carries a per-generation bag
(`copy.ts:460-462` stores `{ pointers, durationPreset, wordBudget, hookTemplates }`), so a _draft_
`hook_text` has somewhere to sit without a new column.

**Trap: `scriptOutput` is shared with Service A.** It is declared under the header
`// Voiced variant script (Service A, step 6) — word budget from demo duration`
(`copy.ts:260-262`) and passed to `callClaude` **twice** — at `:349` for `vo_script` and at `:447`
for `b_script`. Adding `hook_text` to it in place would widen **Service A's voiced-script contract
too**, and because the field would be required, a `vo_script` response that omits it would start
failing validation. `b_script` needs its **own** output schema; do not edit `scriptOutput`.

### Why the final string is copied, not pointed at

**This is the whole reason the rule exists, and it is a rule Service A currently breaks.**

Service A's render params store a **pointer** — `hookLineScriptId` — and the render dereferences it
to get the text at render time:

```
packages/core/src/pipelines/renders.ts:464-467
  const hookLine = (
    await db.select().from(scripts).where(eq(scripts.id, params.hookLineScriptId)).limit(1)
  )[0];
  if (!hookLine) throw new PermanentError("hook line script not found");
```

...and passes `hookLine.text` into the Remotion props at `:523` and `:592`. Anything that edits that
row, or repoints that id, between approval and render changes what gets burned into the video
**after the customer approved it**.

That is not hypothetical. It is the exact failure locked decision #4's amendment removed from the
audio path: the length-fit regeneration in `handleSynthTts` silently repointed
`audio_renders.scriptId`, so **customers approved audio for text they never saw**. The tripwire left
behind is `recordAudioScriptPointerMove`, and the vault records that its zero rows are a _passing
assertion_, quoting the code comment at `apps/web/src/app/api/audio/[id]/route.ts:25-29`:

> "It is not dead code — it is the assertion that stays true. If a row ever shows up in `events`
> for this kind, something started moving the pointer, and the customer was shown a script they did
> not write."

— [[events-table-is-empty]], §"One of the seven is a tripwire, and zero is the pass".

`hook_text` is worse-placed than either, because it is **editable by the customer at the effect
step, after the script step is behind them**. A pointer to the script row would mean a later script
re-derivation silently overwrites an edit the customer already made. Copying the literal string into
render params at enqueue closes that by construction, and render params are already treated as
immutable references elsewhere: `persona_images.retired` exists precisely because "render params
reference image ids, so rows are never removed" (`schema.ts:288`).

**Reasoned, not founder-stated:** the mechanism above — pointer vs literal, and the
`retired`-column precedent — is this note's derivation. What the founder decided is the rule: final
hook text in render params, never on the script row.

## HeyGen stays; InfiniteTalk is not coming back

**Founder-decided.** HeyGen remains the lipsync provider, **image + audio only**. Locked decision
#12 (no video-to-video) is **re-affirmed**, not relaxed — the opener clip is a _cut_, played before
the talking head, never an input to it.

The founder's reason for not reversing the 2026-08 switch is **judgement on quality and speed**.
That half is not measured here and is not presented as measured.

**The price half is checkable from the repo.**
`supabase/migrations/0020_backfill_heygen_usage.sql:12-14` records the three per-second rates the
backfill used to separate the eras, and says why the rate is the only safe discriminator:

```
--   150 agorot/s  fal, InfiniteTalk era   (2026-07-24 .. 07-27)   4 rows
--    75 agorot/s  fal, revised rate       (2026-07-30 .. 08-01)   3 rows
--    25 agorot/s  HeyGen                  (2026-08-02 onward)    14 rows
```

So HeyGen is **6× cheaper than InfiniteTalk's original rate and 3× cheaper than its revised rate**
(150 / 25 = 6; 75 / 25 = 3). Those are the rates the ledger was actually priced at, which is a
stronger artifact than a price list — and `docs/04-integrations.md:217-218` independently gives
HeyGen's list price as $0.0667/s at both 720p and 1080p, ≈25 agorot/s at ₪3.75/$.

**Caveat, stated so it is not over-read:** these are per-second _billing_ rates across 21 real GPU
rows, not a like-for-like benchmark. Nothing here measures output quality, and the row counts are
small.

## Rejected alternatives

| Alternative                                             | Why not                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Multi-angle cuts** (several camera angles per script) | N × the non-determinism — HeyGen has no seed (`docs/04:245-246`), so every cut is an independent generation that can differ. Also needs an image set per persona, which the one-background decision above removes.                                                                |
| **A motion bank per persona** (pre-made motion clips)   | Multiplies by backgrounds — the bank to curate by hand becomes personas × backgrounds × motions.                                                                                                                                                                                  |
| **Hedra Omnia / Kling video-to-video**                  | Viable, untested, **parked** — not rejected on merit. Both would also need locked decision #12 reopened.                                                                                                                                                                          |
| **HeyGen `motion_prompt` to produce the opener**        | Timing and camera are **not promptable** — founder, from the HeyGen help center. `motion_prompt` directs gesture and motion; it cannot place a reveal at a known millisecond, which is the one thing the opener needs.                                                            |
| **Reusing the Service A hook bank**                     | A's hook→cut works _because the demo is a different thing_ — a different person, a different room, so the cut reads as an edit. Here the same persona is on both sides of the cut, so a clip that isn't this persona in this setting is a **continuity error**, not a transition. |

## Still open — do not decide

Listed so a later session does not read this note as settling them.

- **`auto_release_b` / QC for Service B.** **Stays `true`.** Unchanged by this note; the standing
  founder instruction (CLAUDE.md decision #8 amendment, 2026-08-09) still holds and a session may
  not flip it. See [[0004-service-b-config-is-provisional]].
- **The 30s preset.** It left with InfiniteTalk's frame ceiling. That ceiling is gone
  (`docs/04-integrations.md:202-204`), so the original reason is spent — but 30s is **not offered
  pending the founder**. Do not re-enable it as a cleanup.
- **A physical-product service.** Parked as its own thing, not scoped.
- **Sound under the palm phase.** If it happens it is **attached natively at post time**, per the
  existing sounds doctrine (`docs/01-schema.md:66-69`: "Sounds are attached natively at post time,
  never baked in") and locked decision #7. Nothing gets baked into an organic export.

## Related

[[0004-service-b-config-is-provisional]] — the note this supersedes; its three keys stay
placeholders until the engine work lands.
[[heygen-avatar-iv-idles-on-leading-silence]] — the measurement that makes the opener's hard cut
land cleanly on frame 0.
[[events-table-is-empty]] — the pointer-move tripwire quoted above.
[[0013-hook-clips-near-9-16-not-exact-1080x1920]] — the Service A bank's registration constraints,
which the opener bank should be read against before its schema is written.

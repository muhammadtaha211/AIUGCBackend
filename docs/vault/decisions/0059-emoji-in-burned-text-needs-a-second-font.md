---
type: decision
status: verified
verified: 2026-09-18
method: "founder observation of an emoji rendering as tofu in a Service A output mp4; then a Claude Code render through the real selectComposition/renderMedia path (packages/core/src/providers/remotion.ts) to a 1080x1920 H.264 mp4, inspected as frame grabs; then curl HEAD against the CSS URLs @remotion/google-fonts/NotoColorEmoji embeds; then packages/remotion/src/overlays.tsx:1-18, packages/core/src/hook-text.ts:39,74, packages/core/src/pipelines/copy.ts:89-96 and apps/web/src/lib/service-b-ui.ts:262 read in the tree at f84e931"
source: browser
---

# 0059 — Emoji in burned text needs a second font in the stack

## What happened [MEASURED, founder]

The founder placed an emoji by hand in a Service A **step label**. It rendered as an **empty box**
in the output mp4.

The cause is not mysterious. `packages/remotion/src/overlays.tsx:1` loads exactly one font —

```ts
import { loadFont } from "@remotion/google-fonts/Heebo";
export const { fontFamily } = loadFont("normal", {
  weights: ["800"],
  subsets: ["hebrew", "latin"],
});
```

— Heebo has no emoji glyphs, and `docs/07-worker-box.md` §8 establishes that the render box
deliberately has **no system fonts** to fall back to. Nothing was going to draw that codepoint.

## What fixes it [MEASURED, this session]

Loading `@remotion/google-fonts/NotoColorEmoji` **second**, behind Heebo in the same family stack,
fixes it completely. Verified on a real 1080×1920 H.264 mp4 rendered through the same
`selectComposition` / `renderMedia` path production uses, inspected as frame grabs:

- full-colour glyphs, not outlines;
- a **ZWJ sequence** (person + laptop) shaped as one fused glyph, not two;
- the COLR/CBDT bitmap font **survives the h264 encode** with no washout;
- correct **RTL placement** for both a leading and a trailing emoji;
- `TEXT_OUTLINE` (`overlays.tsx:29-35`) applies to the emoji glyphs like any other.

Hebrew still renders in Heebo, because browsers fall back **per glyph**, not per run. And
`fontFamily` is **one exported binding** (`overlays.tsx:15`) consumed by `Captions`
(`overlays.tsx:60`), `Watermark` (`:103`) and `HookLine` (`ServiceA.tsx:198`, `:220`) — and
`HookLine` is what draws Service A's step labels (`ServiceASteps.tsx:11` imports it, `:105` draws
the label with it) _and_ Service B's hook text (`ServiceB.tsx:12`, `:147`). So **one change covers
every burned-text surface** — A and B alike.

## The cost, and the part that is NOT decided [MEASURED]

Google splits Noto Color Emoji into **10 unicode-range chunks**, and `subsets: ["emoji"]` is the
only way to address it — it pulls **all 10**. Measured with `curl -I` against the URLs the package
embeds: **~2.06 MB across 10 requests**, on **every render**, Service A and B alike, whether or not
an emoji is present — because `loadFont()` runs unconditionally at module load, exactly as Heebo's
does.

The alternative: a **curated emoji set** whose glyphs live in 1–2 chunks could be requested by
those subset keys directly — roughly **200–700 KB over 1–2 requests**.

That inverts the build order. A curated set means **choose the emoji first, then load only what it
needs**; the all-chunks route means ship the font and let anything render.

> **FOUNDER DECISION PENDING.** This note does not decide it, and nothing downstream should assume
> either answer. It is queue item 4 in [[state-of-play]], gated on this decision.

## What this collides with in the tree, and nobody has resolved yet

Shipping an emoji font makes "emoji cannot be burned" **false**, while three places still assert it
and a fourth is the reason this was ever discovered. Read at `f84e931`:

| place                                       | what it does                                                                                             |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `packages/core/src/hook-text.ts:39,74`      | `EMOJI` regex → `"hook_text contains an emoji"`, refused at enqueue                                      |
| `packages/core/src/pipelines/copy.ts:89-96` | `ILLEGAL_HOOK_LINE_CHAR` excludes every codepoint outside Hebrew/Latin/a few marks — an emoji is illegal |
| `apps/web/src/lib/service-b-ui.ts:262`      | the customer-facing Hebrew: _"בלי אימוג'י, הטקסט נצרב על הסרטון."_                                       |
| **step labels**                             | **no character guard at all** — [[character-guard-covers-only-generated-hook-lines]]                     |

The last row is why the founder's emoji reached the frame: that defect note, written 2026-08-23,
names this exact scenario in advance ("The realistic trigger is mundane, not exotic: an emoji
pasted into a hook line…"). The tofu is that note's prediction coming true.

So the emoji work is **not** one font import. Whoever lands it has to say which of those three
refusals stays and which is relaxed, and the Hebrew string at `service-b-ui.ts:262` states a reason
that would no longer be the reason. **Not decided here.**

## The verification method is part of the finding

The reporting model's **first read of the full frames was WRONG about RTL placement**, and only
came out right after cropping the left and right halves separately and looking at each. A
full-frame glance is not evidence for bidi. Any future claim about RTL placement in a rendered
frame needs the crops.

## docs/07-worker-box.md §8 — accurate for Hebrew, incomplete if this ships

§8 was **not edited** in the task that wrote this note, deliberately. Two things about it:

- Its proof is **Hebrew-specific and still accurate for Hebrew**: Heebo covers the Hebrew block, so
  a bare Ubuntu with zero fonts renders Hebrew correctly by construction.
- Its **font-fetch inventory becomes incomplete** the moment a second font ships, and its safety
  claim needs narrowing. §8 says the failure mode "does not silently ship tofu" — that is true of a
  **font fetch failure** (which errors loudly and retries as transient), and false of a **missing
  glyph**, which is what actually happened here: the fetch succeeded and the box shipped anyway.

**Whoever lands the emoji change amends §8 in the same commit.**

## Locked-decision check

Nothing here reopens one. Decision 3 ("Hebrew captions are rendered in Remotion, never ffmpeg
`drawtext`") is the reason a second web font is even possible, and this stays inside it. No new
dependency and no new service: `@remotion/google-fonts` is already a dependency of
`packages/remotion` (`package.json:25`, `^4.0.499`) — the emoji font is another import from the
package Heebo already comes from.

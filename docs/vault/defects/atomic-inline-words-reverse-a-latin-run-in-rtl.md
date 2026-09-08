---
type: defect
status: verified
verified: 2026-09-06
method: "a four-case probe page served on 127.0.0.1 and read in the browser pane, measuring each word span's getBoundingClientRect().left in an RTL line reading 'קניתי Nike Air Max בזול': (A) today's HookLine markup, one span of plain text; (B) per-word display:inline-block, the kinetic hook text; (C) per-word flex items, today's Captions; (D) per-word display:inline. Screenshot read directly."
source: browser
---

# Per-word spans reverse a run of two or more Latin words in a Hebrew line

An **atomic inline** — `display: inline-block`, or a flex item, which is
blockified — takes part in bidi as one neutral object, not as the text inside
it. Neutrals between RTL runs resolve RTL, so consecutive Latin-bearing spans
are laid out right to left and a multi-word brand name comes out backwards.

| case                                          | rendered          |
| --------------------------------------------- | ----------------- |
| A — one span of plain text (`HookLine` today) | `Nike Air Max` ✅ |
| B — per-word `display: inline-block`          | `Max Air Nike` ❌ |
| C — per-word flex items (`Captions` today)    | `Max Air Nike` ❌ |
| D — per-word `display: inline`                | `Nike Air Max` ✅ |

`unicode-bidi: isolate` on each word does **not** fix it — every case above
already carries it, and isolate makes the span a neutral too. It is the
atomicity that does the damage, not the isolation.

## Where it bites

- **`Captions` (`packages/remotion/src/overlays.tsx`) ships this today**, in
  both services: the karaoke words are flex items. Any Hebrew ad whose script
  names a two-word Latin brand renders that brand backwards in the captions.
  Not reported by anyone yet — the scripts so far have been all-Hebrew, and a
  single Latin token is unaffected (which is the case `ServiceA.tsx`'s bidi
  comment was written about).
- **The kinetic hook text mock** ([[service-b-hook-animation-mocks-2026-09-06]])
  inherits it: its words are `inline-block` so the pop can scale them.
  `b_script` emits `hook_text` freely, so this reaches the hook line too.

## Update 2026-09-08 — the aside about all-Hebrew scripts was wrong, and v15 raises the odds

Two corrections to the bullet above, neither touching the measurement:

- **"the scripts so far have been all-Hebrew" was never measured.** Counted 2026-09-08 with
  `select kind, count(*) from scripts where text ~ '[A-Za-z]' group by 1` (read-only,
  `packages/core/.work/latin-check.ts`): **19 `hook_line` and 6 `b_script`** rows already carry
  Latin, and 7 of the 26 `audio_renders` with a `rendered_text` do
  ([[pronunciation-map-is-empty-on-the-new-project]]). The runs are single tokens — `tavnit.ai`,
  `excited` — so the two-word case that reverses has genuinely not shipped, which is why nobody has
  reported it. The premise was right; the evidence for it was not.
- **`b_script` v15 (2026-09-08) invites a Latin brand into `script` for the first time**
  ([[0033-b-script-may-write-an-allowed-brand-name-in-latin]]), and `ranked-countdown`'s second
  place exists to name one ([[0032-ranked-countdown-joins-the-structure-bank]]). Captions come from
  the script, so this is now an ordinary path rather than a hypothetical one. `ChatGPT`, `Google`,
  `Excel` and `WhatsApp` — the four the naming policy actually lists — are all **single** tokens and
  all safe. It reverses the first time a script says `Google Docs`, `Adobe Express` or `Canva Pro`.

## Not fixed, deliberately

The mock may not survive the founder's pick, and `Captions` is a separate
concern from this task. Two fixes are known:

1. **Group consecutive Latin/neutral tokens into one pop unit** — the run
   becomes a single atomic object and its inside stays LTR. Fixes both
   `Captions` and the hook text; the grouped words then animate together.
2. **`display: inline` and animate opacity only** — bidi-correct by
   construction, but a transform does not apply to a non-replaced inline, so
   the scale pop is gone.

Nothing in the tree pins this. A test would need a real Chrome layout, which
only `frame-delivery.test.ts` has.

## Related

- [[service-b-hook-animation-mocks-2026-09-06]]
- [[character-guard-covers-only-generated-hook-lines]] — the other burned-text hazard

---
type: decision
status: carried
verified: 2026-08-08
method: "Carried verbatim from CLAUDE.md locked decision #4 as it stood at 83a9a4b (line 27), where it lived from df4291f (2026-07-18) until it moved here on 2026-09-29. The amendment and its numbers were written into CLAUDE.md by commit 6043bb6 (2026-08-08), whose message holds the same measurements; the query that produced them was never recorded, so they cannot be re-measured. The moot note was added by 6f32250 (2026-09-06)."
source: founder
---

# 0065 — VO sync is loose by design (locked decision #4)

**Moot since 2026-09-05.** Service A has no voiceover any more
([[0020-service-a-is-hook-and-steps-only]]). The decision is moot, not disproved: it governs only
the retired "full" format, whose code is still reachable from the CLI. CLAUDE.md keeps decision #4's
number with a one-line pointer here. This note is the record.

## The rule as it stood when it went moot

> VO sync is loose by design: the word budget from demo length is a target, not a cap; time-stretch
> ≤ ~5% (`atempo`) absorbs the rest. Anything past that is an ending, decided by `planAOutro` and
> priced in the advisory before confirm — never a regeneration. No per-moment sync logic.

## The amendment, verbatim (2026-08-08, commit 6043bb6)

> (Amended 2026-08-08: the length-fit regeneration in `handleSynthTts` was removed. It silently
> repointed `audio_renders.scriptId`, so customers approved audio for text they never saw, and it
> converted an overrun that has machinery into an undershoot that has none. Measured before removal:
> it fired 3 times in 14 renders and landed inside its target band 0 of 3 — once converting a 1.15x
> overrun into a 0.69x undershoot, twice spending an extra Claude call and an extra synthesis to
> reach the ending `planAOutro` would have chosen for free.)

6043bb6's message says why the numbers were put in CLAUDE.md: "so a future session has to argue
with the evidence rather than re-add this from a blank context."

## The moot note, verbatim (2026-09-06, commit 6f32250)

> _(Moot since 2026-09-05: Service A has no voiceover any more — see the Service A paragraph above.
> Kept for the record; it governs only the retired "full" format.)_

## The original wording (df4291f, 2026-07-18)

> VO sync is loose by design: word budget from demo length → regenerate tighter once → time-stretch
> ≤ ~5% (`atempo`). No per-moment sync logic.

The 2026-08-08 amendment replaced "regenerate tighter once" with "never a regeneration".

## Related

- [[0020-service-a-is-hook-and-steps-only]] — the decision that made this moot
- [[0030-hook-text-falls-back-to-the-extractor-never-trims]] — cites the 2026-08-08 removal
- [[0017-service-b-single-setting-selfie-talking-head]] — restates the `scriptId` repoint reason
- [[events-table-is-empty]] — the `recordAudioScriptPointerMove` tripwire that confirms the removal
  held
